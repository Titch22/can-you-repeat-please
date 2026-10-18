import {
  MAX_VOTES_PER_PLAYER,
  type Performance,
  type RoundResult,
  type SoundRef,
  type Team,
} from '@cyrp/shared';
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

/**
 * Throws the matching RoomError if `clipIds` (performance ids) is not a valid ballot for the
 * player whose own performance is `ownClipId`.
 */
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

/** Votes received by each performance, most voted first (ties keep playback order). */
export function tally(
  performances: readonly Performance[],
  ballots: Iterable<readonly string[]>,
): RoundResult[] {
  const counts = new Map<string, number>(performances.map((p) => [p.id, 0]));
  for (const ballot of ballots) {
    for (const id of ballot) if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  return performances
    .map((p) => ({ performanceId: p.id, playerIds: p.playerIds, votes: counts.get(p.id)! }))
    .sort((a, b) => b.votes - a.votes);
}

/**
 * Teams mode: random pairs, each member voicing one character (A or B, at random). With an
 * odd number of players, the last one is alone and voices both.
 */
export function pairTeams(playerIds: readonly string[], round: number, rng: Rng): Team[] {
  const shuffled = shuffle(playerIds, rng);
  const teams: Team[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const [first, second] = [shuffled[i]!, shuffled[i + 1]];
    const id = `team-${round}-${teams.length + 1}`;
    if (second === undefined) {
      teams.push({ id, members: [{ playerId: first, role: 'both' }] });
    } else {
      const [a, b] = rng() < 0.5 ? [first, second] : [second, first];
      teams.push({
        id,
        members: [
          { playerId: a, role: 'A' },
          { playerId: b, role: 'B' },
        ],
      });
    }
  }
  return teams;
}

/**
 * What gets played and voted on, in a random order. Classic: one performance per recording.
 * Teams: one per team with at least one recording (a member who didn't record is still part of
 * it, and scores with their team; their lines are just silent).
 */
export function buildPerformances(
  recordings: readonly { playerId: string; clipId: string; url: string }[],
  teams: readonly Team[] | null,
  durationMs: number,
  rng: Rng,
): Performance[] {
  const performances: Performance[] = teams
    ? teams.flatMap((team) => {
        const parts = team.members.flatMap((m) => {
          const rec = recordings.find((r) => r.playerId === m.playerId);
          return rec ? [{ playerId: m.playerId, url: rec.url, role: m.role }] : [];
        });
        if (parts.length === 0) return [];
        return [{ id: team.id, playerIds: team.members.map((m) => m.playerId), parts, durationMs }];
      })
    : recordings.map((r) => ({
        id: r.clipId,
        playerIds: [r.playerId],
        parts: [{ playerId: r.playerId, url: r.url, role: null }],
        durationMs,
      }));
  return shuffle(performances, rng);
}
