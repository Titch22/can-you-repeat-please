import { ConnectionState, Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { create } from 'zustand';

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
}

export const useVoice = create<VoiceStore>(() => ({
  status: 'idle',
  micWanted: true,
  micOn: false,
  canPublish: true,
  micBlocked: false,
  audioBlocked: false,
  peers: {},
  volumes: {},
}));

let room: Room | null = null;
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
function refresh() {
  if (!room) return;
  const peers: Record<string, PeerVoice> = {};
  for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
    peers[p.identity] = { speaking: p.isSpeaking, micOn: p.isMicrophoneEnabled };
  }
  useVoice.setState({ peers, micOn: room.localParticipant.isMicrophoneEnabled });
}

/** Publishes or unpublishes the mic to match "player wants it" AND "server allows it". */
async function applyMic() {
  const r = room;
  if (!r) return;
  const { micWanted, canPublish } = useVoice.getState();
  try {
    await r.localParticipant.setMicrophoneEnabled(micWanted && canPublish);
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
    r.remoteParticipants.get(identity)?.setVolume(useVoice.getState().volumes[identity] ?? 1);
  };

  r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    attach(track, participant.identity);
    refresh();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
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

    const r = new Room({ adaptiveStream: true, dynacast: true });
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
  document.getElementById('voice-audio')?.replaceChildren();
}

export function setMicWanted(micWanted: boolean) {
  useVoice.setState({ micWanted });
  void applyMic();
}

export function setPeerVolume(identity: string, volume: number) {
  useVoice.setState((s) => ({ volumes: { ...s.volumes, [identity]: volume } }));
  room?.remoteParticipants.get(identity)?.setVolume(volume);
}

/** Must run from a click handler when the browser blocked autoplay. */
export async function enableAudio() {
  await room?.startAudio();
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
