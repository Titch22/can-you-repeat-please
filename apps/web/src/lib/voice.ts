import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';
import { create } from 'zustand';
import { audioContext, unlockAudio } from './audio';
import { useDevices } from './devices';
import { getMicStream, onMicChange } from './mic';
import {
  isMeasured,
  isSpeaking,
  onSpeakingChange,
  unwatchAll,
  unwatchLevel,
  watchLevel,
} from './speaking';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface PeerVoice {
  speaking: boolean;
  micOn: boolean;
}

interface VoiceStore {
  status: VoiceStatus;
  /** The player's own mute toggle. */
  micWanted: boolean;
  /** Whether the mic is actually being published right now. */
  micOn: boolean;
  /** LiveKit publish permission; revoked by the server while the game records. */
  canPublish: boolean;
  /** Mic permission denied or no input device. */
  micBlocked: boolean;
  /** Browser autoplay policy blocks audio until the user clicks something. */
  audioBlocked: boolean;
  /** Keyed by player id (the LiveKit identity), including the local player. */
  peers: Record<string, PeerVoice>;
  /** Per-player playback volume, 0–1. */
  volumes: Record<string, number>;
  /** Voice turned down so game sounds stay audible (reference and playback phases). */
  ducked: boolean;
}

const DUCKED_FACTOR = 0.25;

export const useVoice = create<VoiceStore>(() => ({
  status: 'idle',
  micWanted: true,
  micOn: false,
  canPublish: true,
  micBlocked: false,
  audioBlocked: false,
  peers: {},
  volumes: {},
  ducked: false,
}));

function effectiveVolume(identity: string) {
  const { volumes, ducked } = useVoice.getState();
  return (volumes[identity] ?? 1) * (ducked ? DUCKED_FACTOR : 1);
}

function applyVolumes() {
  for (const p of room?.remoteParticipants.values() ?? []) p.setVolume(effectiveVolume(p.identity));
}

let room: Room | null = null;
/**
 * Our mic track, built from the shared mic stream (see mic.ts). Muted or unpublished, never
 * stopped, so LiveKit never asks the browser for the mic again.
 */
let micTrack: LocalAudioTrack | null = null;
/**
 * Mic boost for voice: shared mic → gain (micBoost) → limiter → the track we publish.
 * Without auto gain on the mic (see mic.ts), quiet mics need it. Recordings stay raw: they're
 * loudness-normalized at playback anyway.
 */
let boost: { source: MediaStreamAudioSourceNode; gain: GainNode } | null = null;

/**
 * The track to publish for `stream`: boosted through Web Audio, or, while the browser hasn't
 * allowed audio yet (a suspended context would only output silence), a plain clone that gets
 * swapped for the boosted track once audio is unlocked.
 */
function voiceTrackFor(stream: MediaStream): MediaStreamTrack {
  boost?.source.disconnect();
  boost = null;
  const ctx = audioContext();
  if (ctx.state !== 'running') {
    ctx.addEventListener('statechange', upgradeWhenUnlocked);
    return stream.getAudioTracks()[0]!.clone();
  }
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = useDevices.getState().micBoost;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  const out = ctx.createMediaStreamDestination();
  source.connect(gain).connect(limiter).connect(out);
  boost = { source, gain };
  return out.stream.getAudioTracks()[0]!;
}

function upgradeWhenUnlocked() {
  const ctx = audioContext();
  if (ctx.state !== 'running') return;
  ctx.removeEventListener('statechange', upgradeWhenUnlocked);
  if (micTrack && !boost) {
    void getMicStream().then((stream) => {
      micQueue = micQueue.then(() => replaceMic(stream)).catch(() => {});
    });
  }
}

// Moving the boost slider just changes the gain: no new track.
useDevices.subscribe((state, prev) => {
  if (state.micBoost !== prev.micBoost && boost) {
    boost.gain.gain.setTargetAtTime(state.micBoost, audioContext().currentTime, 0.02);
  }
});

/** Bumped on every connect/disconnect so a stale async connect can tell it lost the race. */
let generation = 0;

function audioContainer() {
  let el = document.getElementById('voice-audio');
  if (!el) {
    el = document.createElement('div');
    el.id = 'voice-audio';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

/** Recomputes who is speaking / has their mic on from the LiveKit room. */
onSpeakingChange(() => refresh());

function refresh() {
  if (!room) return;
  const peers: Record<string, PeerVoice> = {};
  for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
    const micOn = p.isMicrophoneEnabled;
    // Our own measurement when we have one (see speaking.ts), LiveKit's otherwise. A muted or
    // unpublished mic never counts: our own track keeps capturing during the game mute.
    const speaking = micOn && (isMeasured(p.identity) ? isSpeaking(p.identity) : p.isSpeaking);
    peers[p.identity] = { speaking, micOn };
  }
  useVoice.setState({ peers, micOn: room.localParticipant.isMicrophoneEnabled });
}

let micQueue: Promise<void> = Promise.resolve();

/** Publishes, mutes or unpublishes the mic to match "player wants it" AND "server allows it". */
function applyMic() {
  // Serialized: two quick toggles must not publish the track twice.
  micQueue = micQueue.then(syncMic, syncMic);
  return micQueue;
}

/**
 * The player picked another mic: swap the track under the published voice track (no
 * republish, no new prompt), keeping the mute state. Queued with syncMic.
 */
onMicChange((stream) => {
  micQueue = micQueue
    .then(() => replaceMic(stream))
    .catch((err) => {
      console.warn('[voice] switching mic failed', err);
    });
});

async function replaceMic(stream: MediaStream) {
  const r = room;
  if (!r || !micTrack) return; // not created yet: syncMic will use the new stream
  const previous = micTrack.mediaStreamTrack;
  const muted = micTrack.isMuted;
  await micTrack.replaceTrack(voiceTrackFor(stream), true);
  if (muted) micTrack.mediaStreamTrack.enabled = false;
  if (previous !== micTrack.mediaStreamTrack) previous.stop();
  watchLevel(r.localParticipant.identity, micTrack.mediaStreamTrack);
  refresh();
}

async function syncMic() {
  const r = room;
  if (!r) return;
  const { micWanted, canPublish } = useVoice.getState();
  const published = !!r.localParticipant.getTrackPublication(Track.Source.Microphone);
  try {
    if (!canPublish) {
      // The server revokes publishing during recording; unpublish without stopping the track.
      if (micTrack && published) await r.localParticipant.unpublishTrack(micTrack, false);
    } else if (micWanted) {
      if (!micTrack) {
        // Never the shared track itself: muting voice must not silence the recorder.
        micTrack = new LocalAudioTrack(voiceTrackFor(await getMicStream()), undefined, true);
      }
      if (!published) {
        await r.localParticipant.publishTrack(micTrack, { source: Track.Source.Microphone });
        watchLevel(r.localParticipant.identity, micTrack.mediaStreamTrack);
      } else if (micTrack.isMuted) {
        await micTrack.unmute();
      }
    } else if (micTrack && published && !micTrack.isMuted) {
      await micTrack.mute();
    }
    useVoice.setState({ micBlocked: false });
  } catch (err) {
    console.warn('[voice] microphone unavailable', err);
    useVoice.setState({ micBlocked: true });
  }
  refresh();
}

function wire(r: Room) {
  const attach = (track: RemoteTrack, identity: string) => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.dataset.identity = identity;
    audioContainer().appendChild(el);
    r.remoteParticipants.get(identity)?.setVolume(effectiveVolume(identity));
    watchLevel(identity, track.mediaStreamTrack);
  };

  r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    attach(track, participant.identity);
    refresh();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
    track.detach().forEach((el) => el.remove());
    if (track.kind === Track.Kind.Audio) unwatchLevel(participant.identity);
    refresh();
  });
  for (const event of [
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.LocalTrackPublished,
    RoomEvent.LocalTrackUnpublished,
    RoomEvent.ActiveSpeakersChanged,
  ] as const) {
    r.on(event, refresh);
  }
  r.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    useVoice.setState({ audioBlocked: !r.canPlaybackAudio }),
  );
  r.on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
    if (participant !== r.localParticipant) return;
    useVoice.setState({ canPublish: participant.permissions?.canPublish ?? true });
    void applyMic();
  });
  r.on(RoomEvent.MediaDevicesError, () => useVoice.setState({ micBlocked: true }));
  r.on(RoomEvent.ConnectionStateChanged, (state) => {
    const status: Partial<Record<ConnectionState, VoiceStatus>> = {
      [ConnectionState.Connected]: 'connected',
      [ConnectionState.Reconnecting]: 'reconnecting',
      [ConnectionState.SignalReconnecting]: 'reconnecting',
    };
    if (status[state]) useVoice.setState({ status: status[state] });
  });
}

export async function connectVoice(code: string, sessionToken: string) {
  await disconnectVoice();
  const gen = ++generation;
  useVoice.setState({ status: 'connecting' });
  try {
    const res = await fetch(`/api/rooms/${code}/voice-token`, {
      method: 'POST',
      headers: { 'X-Session-Token': sessionToken },
    });
    if (!res.ok) throw new Error(`voice token request failed (${res.status})`);
    const { url, token } = (await res.json()) as { url: string; token: string };
    if (gen !== generation) return;

    const r = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Keep our mic track alive when the server unpublishes it (game mute).
      stopLocalTrackOnUnpublish: false,
      // Play voices through Web Audio on our shared context: per-player volume can then go
      // above 100% (an <audio> element caps at 1), and one click unlocks voices and game sounds.
      webAudioMix: { audioContext: audioContext() },
    });
    room = r;
    wire(r);
    await r.connect(url, token);
    if (gen !== generation) return void r.disconnect();

    useVoice.setState({
      status: 'connected',
      canPublish: r.localParticipant.permissions?.canPublish ?? true,
      audioBlocked: !r.canPlaybackAudio,
    });
    await applyMic();
  } catch (err) {
    if (gen !== generation) return; // superseded by a newer connect/disconnect: not a failure
    console.warn('[voice] connection failed', err);
    useVoice.setState({ status: 'error' });
  }
}

export async function disconnectVoice() {
  generation++;
  const r = room;
  room = null;
  useVoice.setState({ status: 'idle', micOn: false, peers: {}, audioBlocked: false });
  if (r) await r.disconnect();
  unwatchAll();
  // Only our voice track: the shared mic itself stays open until the player leaves the room
  // (endSession), so a voice reconnect never asks the browser for the mic again.
  micTrack?.stop();
  micTrack = null;
  boost?.source.disconnect();
  boost = null;
  document.getElementById('voice-audio')?.replaceChildren();
}

export function setMicWanted(micWanted: boolean) {
  useVoice.setState({ micWanted });
  void applyMic();
}

export function setPeerVolume(identity: string, volume: number) {
  useVoice.setState((s) => ({ volumes: { ...s.volumes, [identity]: volume } }));
  room?.remoteParticipants.get(identity)?.setVolume(effectiveVolume(identity));
}

export function setDucked(ducked: boolean) {
  if (useVoice.getState().ducked === ducked) return;
  useVoice.setState({ ducked });
  applyVolumes();
}

/** Must run from a click handler when the browser blocked autoplay. */
export async function enableAudio() {
  await Promise.all([room?.startAudio(), unlockAudio()]);
  useVoice.setState({ audioBlocked: room ? !room.canPlaybackAudio : false });
}

/**
 * Socket notice that the game muted voice. Going quiet right away avoids the gap before
 * LiveKit revokes publishing; unmuting waits for the permission change (see wire()).
 */
export function onGameMute(muted: boolean) {
  if (!muted || !room) return;
  useVoice.setState({ canPublish: false });
  void applyMic();
}
