import { describe, expect, it } from 'vitest';
import type { SoundRef } from '@cyrp/shared';
import { RoomError } from '../rooms/RoomManager.js';
import { pickSounds, shuffle, tally, validateVote } from './rules.js';

/** Deterministic pseudo-random sequence for repeatable shuffles. */
function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const sound = (id: string): SoundRef => ({ id, label: id, durationMs: 1000, url: `/${id}` });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RoomError ? e.code : 'other';
  }
  return null;
};

describe('shuffle', () => {
  it('returns a permutation without touching the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(input, seeded());
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('pickSounds', () => {
  it('uses every sound once before repeating any', () => {
    const pool = ['a', 'b', 'c'].map(sound);
    const picked = pickSounds(pool, 7, seeded()).map((s) => s.id);
    expect(picked).toHaveLength(7);
    expect(new Set(picked.slice(0, 3)).size).toBe(3);
    expect(new Set(picked.slice(3, 6)).size).toBe(3);
  });

  it('refuses an empty pool', () => {
    expect(code(() => pickSounds([], 3, seeded()))).toBe('NOT_ENOUGH_SOUNDS');
  });
});

describe('validateVote', () => {
  const clips = ['c1', 'c2', 'c3'];

  it('accepts 0 to 2 distinct clips of the round that are not your own', () => {
    expect(code(() => validateVote([], clips, 'c1'))).toBeNull();
    expect(code(() => validateVote(['c2', 'c3'], clips, 'c1'))).toBeNull();
    expect(code(() => validateVote(['c1'], clips, null))).toBeNull();
  });

  it('rejects bad ballots', () => {
    expect(code(() => validateVote(['c1'], clips, 'c1'))).toBe('CANNOT_VOTE_SELF');
    expect(code(() => validateVote(['c1', 'c2', 'c3'], clips, null))).toBe('TOO_MANY_VOTES');
    expect(code(() => validateVote(['c2', 'c2'], clips, null))).toBe('INVALID_PAYLOAD');
    expect(code(() => validateVote(['nope'], clips, null))).toBe('INVALID_PAYLOAD');
  });
});

describe('tally', () => {
  it('counts votes per clip, most voted first, ties in playback order', () => {
    const recordings = [
      { clipId: 'c1', playerId: 'p1', url: '/c1' },
      { clipId: 'c2', playerId: 'p2', url: '/c2' },
      { clipId: 'c3', playerId: 'p3', url: '/c3' },
    ];
    const results = tally(recordings, ['c3', 'c1', 'c2'], [['c1', 'c2'], ['c1'], ['c2', 'ghost']]);
    expect(results.map((r) => [r.clipId, r.playerId, r.votes])).toEqual([
      ['c1', 'p1', 2],
      ['c2', 'p2', 2],
      ['c3', 'p3', 0],
    ]);
  });
});
