import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  MAX_PLAYERS,
  MAX_ROOMS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_LENGTH,
  ROOM_IDLE_TIMEOUT_MS,
  type ErrorCode,
  type Phase,
  type RoomState,
  type Settings,
  type SoundRef,
} from '@cyrp/shared';
import type { GameState } from '../game/state.js';

export class RoomError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}

export interface ServerPlayer {
  id: string;
  nickname: string;
  color: string;
  sessionToken: string;
  /** null while disconnected (inside the reconnect grace period). */
  socketId: string | null;
  isSpectator: boolean;
  score: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** The account the player is logged in with, if any. */
  userId: number | null;
  /** Logged in and sharing their sounds with the room (the host may pick among them). */
  sharesSounds: boolean;
}

export interface Room {
  code: string;
  /** Ordered by join time; the first player inherits host rights. */
  players: ServerPlayer[];
  hostId: string;
  settings: Settings;
  customSounds: SoundRef[];
  phase: Phase;
  /** Voice chat muted by the game: new voice tokens are minted without publish rights. */
  voiceMuted: boolean;
  /** Game in progress; null in the lobby. */
  game: GameState | null;
  /** Audio stored for this room (recordings, uploads), by file id. */
  files: Map<string, StoredFile>;
  lastActivity: number;
}

export interface StoredFile {
  path: string;
  mime: string;
  kind: 'recording' | 'sound';
}

export type RemoveReason = 'left' | 'kicked' | 'timeout';

export interface RoomManagerHooks {
  onCreated?(room: Room): void;
  onChanged?(room: Room): void;
  onPlayerRemoved?(room: Room, player: ServerPlayer, reason: RemoveReason): void;
  /** Someone disconnected, reconnected or left (the room still exists). */
  onPresenceChanged?(room: Room): void;
  /** Called before the room is forgotten, so `room.players` still lists who to notify. */
  onClosed?(room: Room, reason: 'empty' | 'idle'): void;
}

// No I or O: too easy to confuse with 1 and 0 when reading a code aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private hooks: RoomManagerHooks = {},
    private now: () => number = Date.now,
    private maxRooms = MAX_ROOMS,
  ) {}

  get size() {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Authenticates HTTP requests: the player holding `sessionToken` in room `code`, if any. */
  findBySession(code: string, sessionToken: string) {
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.sessionToken === sessionToken);
    return room && player ? { room, player } : null;
  }

  create(nickname: string, color: string, socketId: string) {
    if (this.rooms.size >= this.maxRooms) throw new RoomError('SERVER_FULL');
    const player = this.newPlayer(nickname, color, socketId, false);
    const room: Room = {
      code: this.newCode(),
      players: [player],
      hostId: player.id,
      settings: { ...DEFAULT_SETTINGS },
      customSounds: [],
      phase: 'LOBBY',
      voiceMuted: false,
      game: null,
      files: new Map(),
      lastActivity: this.now(),
    };
    this.rooms.set(room.code, room);
    this.hooks.onCreated?.(room);
    this.hooks.onChanged?.(room);
    return { room, player };
  }

  join(code: string, nickname: string, color: string, socketId: string) {
    const room = this.getOrThrow(code);
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('ROOM_FULL');
    const lower = nickname.toLowerCase();
    if (room.players.some((p) => p.nickname.toLowerCase() === lower)) {
      throw new RoomError('NICKNAME_TAKEN');
    }
    const player = this.newPlayer(nickname, color, socketId, room.phase !== 'LOBBY');
    room.players.push(player);
    this.touch(room);
    return { room, player };
  }

  resume(code: string, sessionToken: string, socketId: string) {
    const room = this.getOrThrow(code);
    const player = room.players.find((p) => p.sessionToken === sessionToken);
    if (!player) throw new RoomError('SESSION_EXPIRED');
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.socketId = socketId;
    this.touch(room);
    this.hooks.onPresenceChanged?.(room);
    return { room, player };
  }

  /** Starts the reconnect grace period. Ignored if the player already resumed on another socket. */
  disconnect(code: string, playerId: string, socketId: string) {
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player || player.socketId !== socketId) return;
    player.socketId = null;
    player.graceTimer = setTimeout(() => this.remove(room, player, 'timeout'), RECONNECT_GRACE_MS);
    this.hooks.onChanged?.(room);
    this.hooks.onPresenceChanged?.(room);
  }

  leave(code: string, playerId: string) {
    const room = this.getOrThrow(code);
    const player = room.players.find((p) => p.id === playerId);
    if (player) this.remove(room, player, 'left');
  }

  kick(code: string, hostId: string, targetId: string) {
    const room = this.getOrThrow(code);
    this.assertHost(room, hostId);
    if (targetId === hostId) throw new RoomError('INVALID_PAYLOAD');
    const target = room.players.find((p) => p.id === targetId);
    if (!target) throw new RoomError('INVALID_PAYLOAD');
    this.remove(room, target, 'kicked');
  }

  updateSettings(code: string, playerId: string, patch: Partial<Settings>) {
    const room = this.getOrThrow(code);
    this.assertHost(room, playerId);
    if (room.phase !== 'LOBBY') throw new RoomError('WRONG_PHASE');
    room.settings = { ...room.settings, ...patch };
    this.touch(room);
  }

  /** Records the game-wide voice mute. Applying it to LiveKit is the caller's job. */
  setVoiceMuted(code: string, muted: boolean) {
    const room = this.getOrThrow(code);
    room.voiceMuted = muted;
    this.touch(room);
    return room;
  }

  /** Throws unless one more sound may be uploaded now (lobby only, room-wide cap). */
  assertCanAddSound(room: Room) {
    if (room.phase !== 'LOBBY') throw new RoomError('WRONG_PHASE');
    if (room.customSounds.length >= MAX_CUSTOM_SOUNDS_PER_ROOM) {
      throw new RoomError('TOO_MANY_SOUNDS');
    }
  }

  addCustomSound(room: Room, sound: SoundRef & { uploadedBy: string }) {
    this.assertCanAddSound(room);
    room.customSounds.push(sound);
    this.touch(room);
  }

  /** Removes an uploaded sound (its uploader or the host, in the lobby). Returns it. */
  removeCustomSound(code: string, playerId: string, soundId: string) {
    const room = this.getOrThrow(code);
    const sound = room.customSounds.find((s) => s.id === soundId);
    if (!sound) throw new RoomError('INVALID_PAYLOAD');
    if (sound.uploadedBy !== playerId && room.hostId !== playerId) throw new RoomError('NOT_HOST');
    if (room.phase !== 'LOBBY') throw new RoomError('WRONG_PHASE');
    room.customSounds = room.customSounds.filter((s) => s !== sound);
    room.settings = {
      ...room.settings,
      selectedSoundIds: room.settings.selectedSoundIds.filter((id) => id !== soundId),
    };
    this.touch(room);
    return sound;
  }

  /**
   * Shares (or stops sharing) the player's own sounds with the room. `userId`: the account
   * they're logged in with now; sharing needs one.
   */
  setSharing(code: string, playerId: string, userId: number | null, share: boolean) {
    const room = this.getOrThrow(code);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new RoomError('ROOM_NOT_FOUND');
    if (share && userId === null) throw new RoomError('NOT_LOGGED_IN');
    player.userId = userId;
    player.sharesSounds = share;
    this.touch(room);
  }

  requireHost(code: string, playerId: string) {
    this.assertHost(this.getOrThrow(code), playerId);
  }

  getOrThrow(code: string) {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    return room;
  }

  /** Records activity and broadcasts the room after an outside change (e.g. by the game). */
  changed(room: Room) {
    if (this.rooms.get(room.code) === room) this.touch(room);
  }

  /** Closes rooms with no activity for ROOM_IDLE_TIMEOUT_MS. Run periodically. */
  sweepIdle() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      // A long Dub mode clip changes nothing for a while, but its phase is still running.
      if ((room.game?.deadline ?? 0) > now) continue;
      if (now - room.lastActivity > ROOM_IDLE_TIMEOUT_MS) this.close(room, 'idle');
    }
  }

  closeAll() {
    for (const room of [...this.rooms.values()]) this.close(room, 'idle');
  }

  /** Snapshot sent to one player. Per-viewer because some fields (votes) are private. */
  toState(room: Room, viewerId: string): RoomState {
    return {
      code: room.code,
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        isHost: p.id === room.hostId,
        connected: p.socketId !== null,
        isSpectator: p.isSpectator,
        score: p.score,
        sharesSounds: p.sharesSounds,
      })),
      settings: room.settings,
      sounds: room.customSounds,
      phase: room.phase,
      voiceMuted: room.voiceMuted,
      ...this.gameView(room, viewerId),
    };
  }

  private gameView(room: Room, viewerId: string) {
    const g = room.game;
    const showPerformances = ['PLAYBACK', 'VOTING', 'ROUND_RESULTS'].includes(room.phase);
    return {
      deadline: g?.deadline ?? null,
      round: g?.round ?? 0,
      reference: g?.reference ?? null,
      recording: g?.recording ?? null,
      submittedPlayerIds: g ? [...g.recordings.keys()] : [],
      playback: g?.playback ?? null,
      teams: g?.teams ?? null,
      performances: g && showPerformances ? g.performances : [],
      myPerformanceId: g?.performances.find((p) => p.playerIds.includes(viewerId))?.id ?? null,
      myVotes: g?.votes.get(viewerId) ?? [],
      votedPlayerIds: g ? [...g.votes.keys()] : [],
      roundResults: g?.roundResults ?? null,
      mashups: g?.mashups ?? [],
    } satisfies Partial<RoomState>;
  }

  private remove(room: Room, player: ServerPlayer, reason: RemoveReason) {
    if (player.graceTimer) clearTimeout(player.graceTimer);
    room.players = room.players.filter((p) => p !== player);
    this.hooks.onPlayerRemoved?.(room, player, reason);
    if (room.players.length === 0) {
      this.close(room, 'empty');
      return;
    }
    if (room.hostId === player.id) room.hostId = room.players[0]!.id;
    this.touch(room);
    this.hooks.onPresenceChanged?.(room);
  }

  private close(room: Room, reason: 'empty' | 'idle') {
    for (const p of room.players) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.rooms.delete(room.code);
    this.hooks.onClosed?.(room, reason);
  }

  private touch(room: Room) {
    room.lastActivity = this.now();
    this.hooks.onChanged?.(room);
  }

  private assertHost(room: Room, playerId: string) {
    if (room.hostId !== playerId) throw new RoomError('NOT_HOST');
  }

  private newPlayer(nickname: string, color: string, socketId: string, isSpectator: boolean) {
    return {
      id: randomUUID(),
      nickname,
      color,
      sessionToken: randomBytes(16).toString('base64url'),
      socketId,
      isSpectator,
      score: 0,
      graceTimer: null,
      userId: null,
      sharesSounds: false,
    } satisfies ServerPlayer;
  }

  private newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++)
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
