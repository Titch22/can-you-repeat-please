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

export interface Clip {
  id: string;
  url: string;
}

export interface RoundResult {
  clipId: string;
  playerId: string;
  votes: number;
}

export interface RoomState {
  code: string;
  players: Player[];
  settings: Settings;
  customSounds: SoundRef[];
  phase: Phase;
  deadline: number | null;
  round: number;
  reference: (SoundRef & { startsAt: number }) | null;
  playback: { clips: Clip[]; index: number; startsAt: number } | null;
  myVotes: string[];
  votedPlayerIds: string[];
  roundResults: RoundResult[] | null;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
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
  | 'TOO_MANY_VOTES';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode | string };
