import type { PlaybackItem, RoundResult, SoundRef } from '@cyrp/shared';

export interface Recording {
  playerId: string;
  /** Also the stored file id: random, so it reveals nothing about the author. */
  clipId: string;
  url: string;
}

/** Everything about the game in progress. Lives on the room; null in the lobby. */
export interface GameState {
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
  /** Clip ids in (shuffled) playback order. */
  clipOrder: string[];
  playback: { items: PlaybackItem[]; index: number; startsAt: number } | null;
  /** Ballots by player id. */
  votes: Map<string, string[]>;
  roundResults: RoundResult[] | null;
}

export const clipUrl = (code: string, fileId: string) => `/api/rooms/${code}/audio/${fileId}`;
