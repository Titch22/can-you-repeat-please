import type {
  GameMode,
  Performance,
  PlaybackItem,
  RoundResult,
  SoundRef,
  Team,
} from '@cyrp/shared';

export interface Recording {
  playerId: string;
  /** Also the stored file id (random). */
  clipId: string;
  url: string;
  /** Dub mode: ms of the recording before the clip starts. */
  leadMs?: number;
}

/** Everything about the game in progress. Lives on the room; null in the lobby. */
export interface GameState {
  /** The room's mode when the game started. */
  mode: GameMode;
  /** One sound per round, picked at start. */
  sounds: SoundRef[];
  round: number;
  deadline: number | null;
  reference: (SoundRef & { startsAt: number }) | null;
  recording: { startsAt: number; endsAt: number } | null;
  /** By player id. */
  recordings: Map<string, Recording>;
  /** Players whose upload is in flight (guards against double submissions). */
  uploading: Set<string>;
  /** This round's teams (Teams mode); null in classic mode. */
  teams: Team[] | null;
  /** What gets played back and voted on, in (shuffled) playback order. */
  performances: Performance[];
  playback: { items: PlaybackItem[]; index: number; startsAt: number } | null;
  /** Ballots by player id. */
  votes: Map<string, string[]>;
  roundResults: RoundResult[] | null;
}

export const clipUrl = (code: string, fileId: string) => `/api/rooms/${code}/audio/${fileId}`;
