import { describe, expect, it } from 'vitest';
import type { Performance, SoundRef, Team } from '@cyrp/shared';
import { RoomError } from '../rooms/RoomManager.js';
import {
  buildPerformances,
  mashup,
  pairTeams,
  pickSounds,
  shuffle,
  tally,
  validateVote,
} from './rules.js';

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

describe('mashup', () => {
  it('puts everyone who recorded in one performance, each with their lead', () => {
    const performance = mashup(
      [
        { playerId: 'a', url: '/a', leadMs: 120 },
        { playerId: 'b', url: '/b' },
      ],
      3,
      5000,
    );
    expect(performance).toEqual({
      id: 'mashup-3',
      playerIds: ['a', 'b'],
      parts: [
        { playerId: 'a', url: '/a', role: null, leadMs: 120 },
        { playerId: 'b', url: '/b', role: null, leadMs: 0 },
      ],
      durationMs: 5000,
    });
  });
});

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

const perf = (id: string, playerIds: string[]): Performance => ({
  id,
  playerIds,
  parts: playerIds.map((playerId) => ({ playerId, url: `/${playerId}`, role: null })),
  durationMs: 1000,
});

describe('tally', () => {
  it('counts votes per performance, most voted first, ties in playback order', () => {
    const performances = [perf('c3', ['p3']), perf('c1', ['p1']), perf('c2', ['p2', 'p4'])];
    const results = tally(performances, [['c1', 'c2'], ['c1'], ['c2', 'ghost']]);
    expect(results).toEqual([
      { performanceId: 'c1', playerIds: ['p1'], votes: 2 },
      { performanceId: 'c2', playerIds: ['p2', 'p4'], votes: 2 },
      { performanceId: 'c3', playerIds: ['p3'], votes: 0 },
    ]);
  });
});

describe('pairTeams', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('pairs everyone once, with one A and one B per pair', () => {
    for (let n = 2; n <= 8; n += 2) {
      const teams = pairTeams(ids(n), 1, rng);
      expect(teams).toHaveLength(n / 2);
      expect(teams.flatMap((t) => t.members.map((m) => m.playerId)).sort()).toEqual(ids(n).sort());
      for (const t of teams) expect(t.members.map((m) => m.role).sort()).toEqual(['A', 'B']);
    }
  });

  it('leaves one player alone, voicing both characters, when the count is odd', () => {
    for (const n of [3, 5, 7]) {
      const teams = pairTeams(ids(n), 2, rng);
      expect(teams).toHaveLength((n + 1) / 2);
      const solo = teams.filter((t) => t.members.length === 1);
      expect(solo).toHaveLength(1);
      expect(solo[0]!.members[0]!.role).toBe('both');
    }
  });

  it('gives teams ids unique within the game', () => {
    const ids1 = pairTeams(ids(4), 1, rng).map((t) => t.id);
    const ids2 = pairTeams(ids(4), 2, rng).map((t) => t.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(4);
  });
});

describe('buildPerformances', () => {
  const recordings = ['p1', 'p2', 'p3'].map((p) => ({
    playerId: p,
    clipId: `c-${p}`,
    url: `/${p}`,
  }));

  it('makes one performance per recording in classic mode', () => {
    const perfs = buildPerformances(recordings, null, 2000, () => 0.3);
    expect(perfs.map((p) => p.id).sort()).toEqual(['c-p1', 'c-p2', 'c-p3']);
    expect(perfs.find((p) => p.id === 'c-p2')).toEqual({
      id: 'c-p2',
      playerIds: ['p2'],
      parts: [{ playerId: 'p2', url: '/p2', role: null }],
      durationMs: 2000,
    });
  });

  it('makes one performance per team that recorded, keeping members who did not', () => {
    const teams: Team[] = [
      {
        id: 't1',
        members: [
          { playerId: 'p1', role: 'A' },
          { playerId: 'p4', role: 'B' },
        ],
      },
      { id: 't2', members: [{ playerId: 'p5', role: 'both' }] },
      {
        id: 't3',
        members: [
          { playerId: 'p2', role: 'B' },
          { playerId: 'p3', role: 'A' },
        ],
      },
    ];
    const perfs = buildPerformances(recordings, teams, 2000, () => 0.3);
    expect(perfs.map((p) => p.id).sort()).toEqual(['t1', 't3']); // t2 recorded nothing
    expect(perfs.find((p) => p.id === 't1')).toEqual({
      id: 't1',
      playerIds: ['p1', 'p4'],
      parts: [{ playerId: 'p1', url: '/p1', role: 'A' }],
      durationMs: 2000,
    });
    expect(perfs.find((p) => p.id === 't3')!.parts.map((p) => p.role)).toEqual(['B', 'A']);
  });
});
