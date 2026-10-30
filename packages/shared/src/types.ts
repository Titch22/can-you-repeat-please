import type { z } from 'zod';
import { LIBRARY_ID_PREFIX, TEAM_TAG } from './constants.js';
import type {
  AddClipPayload,
  DialogueLineSchema,
  GameModeSchema,
  LibrarySoundPatchSchema,
  LibrarySoundSchema,
  PhaseSchema,
  SettingsSchema,
  SpeakerSchema,
  TagCountSchema,
  TranscriptLanguageSchema,
} from './schemas.js';

export type Phase = z.infer<typeof PhaseSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type GameMode = z.infer<typeof GameModeSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type DialogueLine = z.infer<typeof DialogueLineSchema>;
export type AddClip = z.infer<typeof AddClipPayload>;
/** A team member's role: one character, or both for a player alone in their team. */
export type Role = Speaker | 'both';

export interface Player {
  id: string;
  nickname: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  isSpectator: boolean;
  score: number;
  /** Logged in and sharing their sounds: the host can pick among them. */
  sharesSounds: boolean;
}

export interface SoundRef {
  id: string;
  label: string;
  durationMs: number;
  url: string;
  /** Set for sounds uploaded in the lobby: the uploader's player id. */
  uploadedBy?: string;
  /** Library sounds: their tags. */
  tags?: string[];
  /** Library dialogues (Teams mode): who speaks when. */
  lines?: DialogueLine[];
  /** Library dialogues: the scene without the voices, if the admin added one. */
  backgroundUrl?: string | null;
  /** Dub mode clips: `durationMs` of this YouTube video from `startMs`. They have no `url`. */
  video?: { youtubeId: string; startMs: number };
}

/** A Teams mode dialogue: tagged "team", with lines for both characters. */
export function isDialogue(sound: { tags?: string[]; lines?: DialogueLine[] }): boolean {
  const lines = sound.lines ?? [];
  return (
    !!sound.tags?.includes(TEAM_TAG) &&
    lines.some((l) => l.speaker === 'A') &&
    lines.some((l) => l.speaker === 'B')
  );
}

/** One round's team (Teams mode): a pair, or a player alone voicing both characters. */
export interface Team {
  id: string;
  members: { playerId: string; role: Role }[];
}

/**
 * What players vote for. Classic: one player's recording. Teams: a team's recordings, stitched
 * by the dialogue's lines when played (each part's `role` says whose lines it covers). Dub: the
 * one mashup of everyone's recordings, played but not voted on.
 */
export interface Performance {
  /** Vote target: the recording's id (classic) or the team's id (teams). */
  id: string;
  playerIds: string[];
  parts: {
    playerId: string;
    url: string;
    role: Role | null;
    /** Dub mode: ms of the recording before the clip starts (negative: it started after). */
    leadMs?: number;
  }[];
  durationMs: number;
}

/** One entry of the playback queue: the reference again, then each performance. */
export type PlaybackItem =
  | { kind: 'reference'; url: string; durationMs: number }
  | { kind: 'performance'; performance: Performance; durationMs: number };

export interface RoundResult {
  performanceId: string;
  playerIds: string[];
  /** Votes received this round (each player of the performance scores them). */
  votes: number;
}

export interface RoomState {
  code: string;
  players: Player[];
  settings: Settings;
  /** The room's uploads (`uploadedBy` set). Library sounds come from the sounds service. */
  sounds: SoundRef[];
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
  /** This round's teams (Teams mode, from the round intro on); null in classic mode. */
  teams: Team[] | null;
  /** Performances of this round, in (shuffled) playback order. */
  performances: Performance[];
  /** The viewer's own performance this round (theirs or their team's): they can't vote for it. */
  myPerformanceId: string | null;
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
  | 'SOUND_TOO_LONG'
  | 'ALREADY_SUBMITTED'
  | 'CANNOT_VOTE_SELF'
  | 'TOO_MANY_VOTES'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_ENOUGH_SOUNDS'
  | 'LIBRARY_UNAVAILABLE'
  | 'NO_DIALOGUES'
  | 'NO_CLIPS'
  | 'SERVER_FULL'
  | 'RATE_LIMITED'
  | 'SPECTATOR'
  | 'NOT_LOGGED_IN';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export type LibrarySound = z.infer<typeof LibrarySoundSchema>;
export type TranscriptLanguage = z.infer<typeof TranscriptLanguageSchema>;
/** A word heard by the speech recognition, with when it is said (ms from the start). */
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** A library sound as rooms use it: a SoundRef with a `lib:` id (see LIBRARY_ID_PREFIX). */
export const toSoundRef = (s: LibrarySound): SoundRef & { tags: string[] } => ({
  id: `${LIBRARY_ID_PREFIX}${s.id}`,
  label: s.label,
  durationMs: s.durationMs,
  url: s.url,
  tags: s.tags,
  lines: s.lines,
  backgroundUrl: s.backgroundUrl,
});
export type TagCount = z.infer<typeof TagCountSchema>;
export type LibrarySoundPatch = z.infer<typeof LibrarySoundPatchSchema>;

/** Errors of the sounds service (apps/sounds), as `{ ok: false, error }` bodies. */
export type LibraryErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_PAYLOAD'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'SOUND_TOO_LONG'
  | 'DUPLICATE'
  | 'LENGTH_MISMATCH'
  | 'TRANSCRIPTION_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'DOWNLOAD_FAILED'
  | 'RATE_LIMITED';

/** GET /api/account: who is logged in, and whether sign-up needs a code. */
export interface AccountInfo {
  user: { username: string; isAdmin: boolean } | null;
  signup: 'open' | 'code';
}

/** Errors of the account routes, as `{ ok: false, error }` bodies. */
export type AccountErrorCode =
  | 'INVALID_PAYLOAD'
  | 'USERNAME_TAKEN'
  | 'BAD_CREDENTIALS'
  | 'INVALID_CODE'
  | 'NOT_LOGGED_IN'
  | 'NOT_ADMIN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED';

/** GET /v1/my/sounds: a user's own sounds (or the shared library, for admins), and their quota. */
export interface MySounds {
  sounds: LibrarySound[];
  usedBytes: number;
  /** Null for the shared library (no quota). */
  quotaBytes: number | null;
}

/** GET /api/rooms/:code/shared-sounds: the sounds of the players sharing theirs. */
export interface SharedSounds {
  playerId: string;
  sounds: SoundRef[];
}
