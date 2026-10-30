import {
  isDialogue,
  LIBRARY_ID_PREFIX,
  MAX_RECORDING_MS,
  MIN_PLAYERS,
  MIN_PLAYERS_TEAMS,
  type GameMode,
  type Phase,
  type PlaybackItem,
  type SoundRef,
} from '@cyrp/shared';
import { RoomError, type Room, type RoomManager } from '../rooms/RoomManager.js';
import type { LibraryClient } from '../sounds/library.js';
import {
  buildPerformances,
  mashup,
  pairTeams,
  pickSounds,
  tally,
  validateVote,
  type Rng,
} from './rules.js';
import { clipUrl, type GameState } from './state.js';
import type { Timing } from './timing.js';

export interface GameRunnerDeps {
  rooms: RoomManager;
  timing: Timing;
  library: LibraryClient;
  setVoiceMuted(code: string, muted: boolean): Promise<void>;
  /** Deletes the game's recordings (files on disk and `room.files` entries). */
  discardRecordings(room: Room): void;
  rng?: Rng;
  now?: () => number;
}

/** Dub mode: the longest wait for recordings, so a player who sends none can't stall the game. */
const MAX_DUB_UPLOAD_WAIT_MS = 120_000;

/**
 * Drives games: one timer per room moves it through
 * ROUND_INTRO → REFERENCE → RECORDING → PLAYBACK → VOTING → ROUND_RESULTS (→ next round)
 * → FINAL_RESULTS. Dub mode goes straight from PLAYBACK to the next round: nobody votes.
 * Player actions (uploads, votes, leaving) can end a phase early.
 */
export class GameRunner {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Voice mute changes waiting for the new phase's deadline to be set (see enter()). */
  private pendingMute = new Map<string, boolean>();
  /** Rooms whose start is waiting for the sound library. */
  private starting = new Set<string>();
  private rng: Rng;
  private now: () => number;

  constructor(private deps: GameRunnerDeps) {
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? Date.now;
  }

  // ── Player actions ──────────────────────────────────────────────────────────

  async start(code: string, playerId: string) {
    const { rooms } = this.deps;
    const canStart = () => {
      const room = rooms.getOrThrow(code);
      rooms.requireHost(code, playerId);
      if (room.phase !== 'LOBBY' || this.starting.has(code)) throw new RoomError('WRONG_PHASE');
      const connected = room.players.filter((p) => p.socketId !== null).length;
      if (connected < minPlayers(room.settings.mode)) throw new RoomError('NOT_ENOUGH_PLAYERS');
      return room;
    };
    canStart();
    this.starting.add(code);
    let pool: SoundRef[];
    try {
      pool = await this.soundPool(rooms.getOrThrow(code));
    } finally {
      this.starting.delete(code);
    }
    // The room may have changed while the library answered.
    const room = canStart();
    const mode = room.settings.mode;
    if (mode === 'teams') {
      pool = pool.filter(isDialogue);
      if (pool.length === 0) throw new RoomError('NO_DIALOGUES');
    } else if (mode === 'dub') {
      pool = pool.filter((s) => s.video);
      if (pool.length === 0) throw new RoomError('NO_CLIPS');
    } else {
      pool = pool.filter((s) => !s.video);
    }
    const sounds = pickSounds(pool, room.settings.rounds, this.rng);
    for (const p of room.players) {
      p.isSpectator = false;
      p.score = 0;
    }
    room.game = {
      mode,
      sounds,
      round: 0,
      deadline: null,
      reference: null,
      recording: null,
      recordings: new Map(),
      uploading: new Set(),
      teams: null,
      performances: [],
      playback: null,
      votes: new Map(),
      roundResults: null,
    };
    this.startRound(room);
  }

  vote(code: string, playerId: string, clipIds: string[]) {
    const room = this.deps.rooms.getOrThrow(code);
    const g = room.game;
    if (!g || room.phase !== 'VOTING') throw new RoomError('WRONG_PHASE');
    this.requireParticipant(room, playerId);
    validateVote(
      clipIds,
      g.performances.map((p) => p.id),
      g.performances.find((p) => p.playerIds.includes(playerId))?.id ?? null,
    );
    g.votes.set(playerId, [...clipIds]);
    this.deps.rooms.changed(room);
    if (this.everyone(room, (id) => g.votes.has(id))) this.toRoundResults(room);
  }

  /**
   * First half of a recording upload, before the file is stored: checks the player may submit
   * for this round and reserves their slot. Returns a function releasing it if storing fails.
   */
  beginUpload(room: Room, playerId: string, round: number) {
    const g = room.game;
    if (!g || room.phase !== 'RECORDING' || g.round !== round) throw new RoomError('WRONG_PHASE');
    this.requireParticipant(room, playerId);
    if (g.recordings.has(playerId) || g.uploading.has(playerId)) {
      throw new RoomError('ALREADY_SUBMITTED');
    }
    g.uploading.add(playerId);
    return () => g.uploading.delete(playerId);
  }

  /** Second half: registers the stored file. False if the phase moved on meanwhile. */
  finishUpload(room: Room, playerId: string, fileId: string, leadMs?: number) {
    const g = room.game;
    g?.uploading.delete(playerId);
    if (!g || room.phase !== 'RECORDING' || !g.recording) return false;
    g.recordings.set(playerId, {
      playerId,
      clipId: fileId,
      url: clipUrl(room.code, fileId),
      ...(g.mode === 'dub' ? { leadMs: leadMs ?? 0 } : {}),
    });
    this.deps.rooms.changed(room);
    this.maybeEndRecordingEarly(room);
    return true;
  }

  backToLobby(code: string, playerId: string) {
    const { rooms } = this.deps;
    const room = rooms.getOrThrow(code);
    rooms.requireHost(code, playerId);
    if (room.phase !== 'FINAL_RESULTS') throw new RoomError('WRONG_PHASE');
    this.clearTimer(code);
    this.deps.discardRecordings(room);
    room.game = null;
    room.phase = 'LOBBY';
    for (const p of room.players) p.isSpectator = false;
    rooms.changed(room);
  }

  // ── Room events ─────────────────────────────────────────────────────────────

  /** Players left, disconnected or came back: the game may end, or a phase may end early. */
  onPresenceChanged(room: Room) {
    const g = room.game;
    if (!g || room.phase === 'FINAL_RESULTS') return;
    if (room.players.filter((p) => !p.isSpectator).length < minPlayers(g.mode)) {
      this.toFinal(room);
      return;
    }
    if (room.phase === 'RECORDING') this.maybeEndRecordingEarly(room);
    if (room.phase === 'VOTING' && this.everyone(room, (id) => g.votes.has(id))) {
      this.toRoundResults(room);
    }
  }

  /** The room closed: forget its timer. */
  stop(code: string) {
    this.clearTimer(code);
    this.pendingMute.delete(code);
  }

  // ── Phases ──────────────────────────────────────────────────────────────────

  private startRound(room: Room) {
    const g = this.game(room);
    g.round++;
    // Dub mode: known from the intro on, so clients can load the video ahead of it.
    const sound = g.sounds[g.round - 1]!;
    g.reference = sound.video ? { ...sound, startsAt: 0 } : null;
    g.recording = null;
    g.recordings = new Map();
    g.uploading = new Set();
    g.teams =
      g.mode === 'teams'
        ? pairTeams(
            room.players.filter((p) => !p.isSpectator).map((p) => p.id),
            g.round,
            this.rng,
          )
        : null;
    g.performances = [];
    g.playback = null;
    g.votes = new Map();
    g.roundResults = null;
    this.enter(room, 'ROUND_INTRO');
    this.schedule(room, this.now() + this.deps.timing.introMs, () => this.toReference(room));
  }

  private toReference(room: Room) {
    const g = this.game(room);
    const { timing } = this.deps;
    const sound = g.sounds[g.round - 1]!;
    const startsAt = this.now() + timing.referenceLeadMs;
    g.reference = { ...sound, startsAt };
    this.enter(room, 'REFERENCE');
    this.schedule(room, startsAt + sound.durationMs + timing.referenceTailMs, () =>
      this.toRecording(room),
    );
  }

  private toRecording(room: Room) {
    const g = this.game(room);
    const { timing } = this.deps;
    const startsAt = this.now() + timing.countdownMs;
    const wanted = g.reference!.durationMs + room.settings.extraRecordMs;
    const length = g.mode === 'dub' ? wanted : Math.min(wanted, MAX_RECORDING_MS);
    g.recording = { startsAt, endsAt: startsAt + length };
    this.enter(room, 'RECORDING');
    // A clip's recording can be long to send; the phase still ends as soon as they're all in.
    const longUpload = g.mode === 'dub' ? Math.min(length / 4, MAX_DUB_UPLOAD_WAIT_MS) : 0;
    const lastUpload = Math.max(timing.uploadGraceMs, timing.afterRecordingMs, longUpload);
    this.schedule(room, g.recording.endsAt + lastUpload, () => this.endRecording(room));
  }

  /** Once every recording is in, wait out the "Time's up!" pause, then move on. */
  private maybeEndRecordingEarly(room: Room) {
    const g = this.game(room);
    if (room.phase !== 'RECORDING' || !g.recording || this.now() < g.recording.endsAt) return;
    if (!this.everyone(room, (id) => g.recordings.has(id))) return;
    const at = g.recording.endsAt + this.deps.timing.afterRecordingMs;
    if (this.now() >= at) this.endRecording(room);
    else if (g.deadline !== at) this.schedule(room, at, () => this.endRecording(room));
  }

  private endRecording(room: Room) {
    const g = this.game(room);
    if (g.recordings.size > 0) this.toPlayback(room);
    else if (g.mode === 'dub') this.nextRound(room);
    else this.toRoundResults(room);
  }

  private toPlayback(room: Room) {
    const g = this.game(room);
    const clipMs = g.recording!.endsAt - g.recording!.startsAt;
    const recordings = [...g.recordings.values()];
    g.performances =
      g.mode === 'dub'
        ? [mashup(recordings, g.round, clipMs)]
        : buildPerformances(recordings, g.teams, clipMs, this.rng);
    const ref = g.reference!;
    const items: PlaybackItem[] = [
      ...(room.settings.replayReference
        ? [{ kind: 'reference' as const, url: ref.url, durationMs: ref.durationMs }]
        : []),
      ...g.performances.map((performance) => ({
        kind: 'performance' as const,
        performance,
        durationMs: clipMs,
      })),
    ];
    this.playItem(room, items, 0);
  }

  private playItem(room: Room, items: PlaybackItem[], index: number) {
    const g = this.game(room);
    const { timing } = this.deps;
    const startsAt = this.now() + (index === 0 ? timing.playbackIntroMs : timing.playbackLeadMs);
    g.playback = { items, index, startsAt };
    this.enter(room, 'PLAYBACK');
    this.schedule(room, startsAt + items[index]!.durationMs + timing.playbackGapMs, () =>
      index + 1 < items.length
        ? this.playItem(room, items, index + 1)
        : g.mode === 'dub'
          ? this.nextRound(room)
          : this.toVoting(room),
    );
  }

  private nextRound(room: Room) {
    const g = this.game(room);
    if (g.round < g.sounds.length) this.startRound(room);
    else this.toFinal(room);
  }

  private toVoting(room: Room) {
    this.enter(room, 'VOTING');
    this.schedule(room, this.now() + room.settings.votingMs, () => this.toRoundResults(room));
  }

  private toRoundResults(room: Room) {
    const g = this.game(room);
    const results = tally(g.performances, g.votes.values());
    for (const r of results) {
      for (const player of room.players)
        if (r.playerIds.includes(player.id)) player.score += r.votes;
    }
    g.roundResults = results;
    this.enter(room, 'ROUND_RESULTS');
    this.schedule(room, this.now() + this.deps.timing.resultsMs, () => this.nextRound(room));
  }

  private toFinal(room: Room) {
    this.clearTimer(room.code);
    this.game(room).deadline = null;
    this.enter(room, 'FINAL_RESULTS');
    this.applyVoiceMute(room);
    this.deps.rooms.changed(room);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Switches phase. Voice is muted exactly while in RECORDING; the change is applied once the
   * caller has set the new deadline (schedule/toFinal), because muting broadcasts the room
   * and clients must not see the new phase with the previous phase's deadline.
   */
  private enter(room: Room, phase: Phase) {
    const wasRecording = room.phase === 'RECORDING';
    room.phase = phase;
    const muted = phase === 'RECORDING';
    if (muted !== wasRecording) this.pendingMute.set(room.code, muted);
  }

  private applyVoiceMute(room: Room) {
    const muted = this.pendingMute.get(room.code);
    if (muted === undefined) return;
    this.pendingMute.delete(room.code);
    this.deps
      .setVoiceMuted(room.code, muted)
      .catch((err) => console.error('[game] voice mute failed', err));
  }

  /** Sets the phase deadline, runs `next` at that time, and broadcasts the new state. */
  private schedule(room: Room, at: number, next: () => void) {
    this.clearTimer(room.code);
    this.game(room).deadline = at;
    const timer = setTimeout(
      () => {
        this.timers.delete(room.code);
        // The room may have closed, or the game ended, since this was scheduled.
        if (this.deps.rooms.get(room.code) !== room || !room.game) return;
        next();
      },
      Math.max(0, at - this.now()),
    );
    this.timers.set(room.code, timer);
    this.applyVoiceMute(room);
    this.deps.rooms.changed(room);
  }

  private clearTimer(code: string) {
    clearTimeout(this.timers.get(code));
    this.timers.delete(code);
  }

  private game(room: Room): GameState {
    if (!room.game) throw new Error(`no game in room ${room.code}`);
    return room.game;
  }

  /** True when every connected, non-spectating player satisfies `done`. */
  private everyone(room: Room, done: (playerId: string) => boolean) {
    const active = room.players.filter((p) => !p.isSpectator && p.socketId !== null);
    return active.length > 0 && active.every((p) => done(p.id));
  }

  private requireParticipant(room: Room, playerId: string) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new RoomError('ROOM_NOT_FOUND');
    if (player.isSpectator) throw new RoomError('SPECTATOR');
  }

  /** The sounds the host ticked: library sounds (resolved now) and the room's uploads. */
  private async soundPool(room: Room): Promise<SoundRef[]> {
    const selected = room.settings.selectedSoundIds;
    const libraryIds = selected
      .filter((id) => id.startsWith(LIBRARY_ID_PREFIX))
      .map((id) => id.slice(LIBRARY_ID_PREFIX.length));
    // Library sounds, and the own sounds of the players sharing theirs (if still in the room).
    const owners = room.players.flatMap((p) =>
      p.sharesSounds && p.userId !== null ? [p.userId] : [],
    );
    const fromLibrary = await this.deps.library.resolve(libraryIds, owners);
    const ticked = new Set(selected);
    return [...fromLibrary, ...room.customSounds.filter((s) => ticked.has(s.id))];
  }
}

const minPlayers = (mode: GameMode) => (mode === 'teams' ? MIN_PLAYERS_TEAMS : MIN_PLAYERS);
