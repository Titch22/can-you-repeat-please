import type { z } from 'zod';
import type { PhaseSchema, SettingsSchema } from './schemas.js';

export type Phase = z.infer<typeof PhaseSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export interface Player {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  isSpectator: boolean;
  score: number;
}

export interface SoundRef {
  id: string;
  label: string;
  durationMs: number;
  url: string;
  uploadedBy?: string;
}

/** One entry of the playback queue: the reference again, then each recording, anonymously. */
export interface PlaybackItem {
  kind: 'reference' | 'clip';
  /** Set for clips; what votes refer to. */
  clipId: string | null;
  url: string;
  durationMs: number;
}

export interface RoundResult {
  clipId: string;
  playerId: string;
  /** Votes received this round. */
  votes: number;
  url: string;
}

export interface RoomState {
  code: string;
  players: Player[];
  settings: Settings;
  customSounds: SoundRef[];
  phase: Phase;
  /** True while voice chat is muted by the game (recording phase). */
  voiceMuted: boolean;
  /** End of the current phase, server epoch ms. Null when the phase has no time limit. */
  deadline: number | null;
  /** 1-based; 0 in the lobby. */
  round: number;
  /** The sound to imitate, played for everyone at `startsAt`. */
  reference: (SoundRef & { startsAt: number }) | null;
  /** Recording window (after the 3-2-1 countdown). */
  recording: { startsAt: number; endsAt: number } | null;
  /** Players whose recording arrived this round. */
  submittedPlayerIds: string[];
  /** Playback queue; item `index` starts at `startsAt`. */
  playback: { items: PlaybackItem[]; index: number; startsAt: number } | null;
  /** Clips of this round, in playback order (anonymous until results). */
  clips: { id: string; url: string; durationMs: number }[];
  /** The viewer's own clip this round, which they can't vote for. */
  myClipId: string | null;
  myVotes: string[];
  /** Who has voted (not what they voted for). */
  votedPlayerIds: string[];
  roundResults: RoundResult[] | null;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'INTERNAL'
  | 'ROOM_FULL'
  | 'NOT_HOST'
  | 'WRONG_PHASE'
  | 'INVALID_PAYLOAD'
  | 'NICKNAME_TAKEN'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'TOO_MANY_SOUNDS'
  | 'ALREADY_SUBMITTED'
  | 'CANNOT_VOTE_SELF'
  | 'TOO_MANY_VOTES'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_ENOUGH_SOUNDS'
  | 'SPECTATOR';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };
