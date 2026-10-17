import { MAX_VOTES_PER_PLAYER, type RoundResult, type SoundRef } from '@cyrp/shared';
import { RoomError } from '../rooms/RoomManager.js';

export type Rng = () => number;

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * One sound per round. No sound repeats until the whole pool has been used, so a pool
 * smaller than the round count still works.
 */
export function pickSounds(pool: readonly SoundRef[], rounds: number, rng: Rng): SoundRef[] {
  if (pool.length === 0) throw new RoomError('NOT_ENOUGH_SOUNDS');
  const picked: SoundRef[] = [];
  while (picked.length < rounds) picked.push(...shuffle(pool, rng));
  return picked.slice(0, rounds);
}

/** Throws the matching RoomError if `clipIds` is not a valid ballot for `ownClipId`'s owner. */
export function validateVote(
  clipIds: readonly string[],
  roundClipIds: readonly string[],
  ownClipId: string | null,
) {
  if (clipIds.length > MAX_VOTES_PER_PLAYER) throw new RoomError('TOO_MANY_VOTES');
  if (new Set(clipIds).size !== clipIds.length) throw new RoomError('INVALID_PAYLOAD');
  for (const id of clipIds) {
    if (!roundClipIds.includes(id)) throw new RoomError('INVALID_PAYLOAD');
    if (id === ownClipId) throw new RoomError('CANNOT_VOTE_SELF');
  }
}

/** Votes received by each clip, most voted first (ties keep playback order). */
export function tally(
  recordings: readonly { clipId: string; playerId: string; url: string }[],
  clipOrder: readonly string[],
  ballots: Iterable<readonly string[]>,
): RoundResult[] {
  const counts = new Map<string, number>(clipOrder.map((id) => [id, 0]));
  for (const ballot of ballots) {
    for (const id of ballot) if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  const byClip = new Map(recordings.map((r) => [r.clipId, r]));
  return clipOrder
    .map((clipId) => {
      const r = byClip.get(clipId)!;
      return { clipId, playerId: r.playerId, url: r.url, votes: counts.get(clipId)! };
    })
    .sort((a, b) => b.votes - a.votes);
}
