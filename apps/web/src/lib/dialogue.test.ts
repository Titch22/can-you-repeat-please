import { describe, expect, it } from 'vitest';
import { fitWordStarts, type DialogueLine, type Performance } from '@cyrp/shared';
import {
  encodeWav,
  evenWordStarts,
  lineAt,
  moveWordStart,
  performanceSegments,
  saidSoFar,
  withText,
  wordAt,
} from './dialogue';

const lines: DialogueLine[] = [
  { startMs: 0, endMs: 1000, speaker: 'A', text: 'One', wordStartsMs: [] },
  { startMs: 1200, endMs: 2000, speaker: 'B', text: 'Two', wordStartsMs: [] },
  { startMs: 2500, endMs: 3000, speaker: 'A', text: '', wordStartsMs: [] },
];

const scene = { url: '/original', lines };

const perf = (parts: Performance['parts']): Performance => ({
  id: 't1',
  playerIds: parts.map((p) => p.playerId),
  parts,
  durationMs: 4000,
});

describe('performanceSegments', () => {
  it('stitches a pair: each line from the recording of whoever voices it', () => {
    const p = perf([
      { playerId: 'bob', url: '/bob', role: 'B' },
      { playerId: 'ann', url: '/ann', role: 'A' },
    ]);
    expect(performanceSegments(p, scene)).toEqual([
      { url: '/ann', offsetMs: 0, durationMs: 1000, atMs: 0 },
      { url: '/bob', offsetMs: 1200, durationMs: 800, atMs: 1200 },
      { url: '/ann', offsetMs: 2500, durationMs: 500, atMs: 2500 },
    ]);
  });

  it('takes every line from a solo player', () => {
    const p = perf([{ playerId: 'sam', url: '/sam', role: 'both' }]);
    expect(performanceSegments(p, scene).map((s) => s.url)).toEqual(['/sam', '/sam', '/sam']);
  });

  it('leaves the lines of a member who did not record silent', () => {
    const p = perf([{ playerId: 'bob', url: '/bob', role: 'B' }]);
    expect(performanceSegments(p, scene)).toEqual([
      { url: '/bob', offsetMs: 1200, durationMs: 800, atMs: 1200 },
    ]);
  });

  it('plays the background under the voices, at the original’s level', () => {
    const p = perf([{ playerId: 'bob', url: '/bob', role: 'B' }]);
    expect(performanceSegments(p, { ...scene, backgroundUrl: '/bg' })).toEqual([
      { url: '/bg', offsetMs: 0, durationMs: 4000, atMs: 0, gainUrl: '/original' },
      { url: '/bob', offsetMs: 1200, durationMs: 800, atMs: 1200 },
    ]);
  });

  it('plays a dub mashup’s voices together, each lined up with the clip', () => {
    const team: Performance = {
      id: 'mashup-1',
      playerIds: ['a', 'b', 'c'],
      parts: [
        { playerId: 'a', url: '/a', role: null, leadMs: 200 }, // started before the clip
        { playerId: 'b', url: '/b', role: null, leadMs: -150 }, // started after it
        { playerId: 'c', url: '/c', role: null, leadMs: 0 },
      ],
      durationMs: 5000,
    };
    expect(performanceSegments(team, { url: '', lines: [] })).toEqual([
      { url: '/a', offsetMs: 200, atMs: 0, durationMs: 5000 },
      { url: '/b', offsetMs: 0, atMs: 150, durationMs: 5000 },
      { url: '/c', offsetMs: 0, atMs: 0, durationMs: 5000 },
    ]);
  });

  it('plays a classic recording whole', () => {
    const p = perf([{ playerId: 'ann', url: '/ann', role: null }]);
    expect(performanceSegments(p, undefined)).toEqual([
      { url: '/ann', offsetMs: 0, durationMs: 4000, atMs: 0 },
    ]);
  });
});

const line = (text: string, wordStartsMs: number[] = []): DialogueLine => ({
  startMs: 1000,
  endMs: 2000,
  speaker: 'A',
  text,
  wordStartsMs,
});

describe('saidSoFar', () => {
  it('without word timings, splits the text at the fraction of the line elapsed', () => {
    const untimed = line('Ça va ?');
    expect(saidSoFar(untimed, 500)).toEqual(['', 'Ça va ?']);
    expect(saidSoFar(untimed, 1500)).toEqual(['Ça v', 'a ?']);
    expect(saidSoFar(untimed, 2500)).toEqual(['Ça va ?', '']);
  });

  it('follows the word timings: each word fills up until the next one starts', () => {
    const timed = line('Ça va bien', [1000, 1200, 1800]);
    expect(saidSoFar(timed, 900)).toEqual(['', 'Ça va bien']);
    expect(saidSoFar(timed, 1100)).toEqual(['Ç', 'a va bien']);
    expect(saidSoFar(timed, 1500)).toEqual(['Ça v', 'a bien']);
    expect(saidSoFar(timed, 1900)).toEqual(['Ça va bi', 'en']);
    expect(saidSoFar(timed, 2000)).toEqual(['Ça va bien', '']);
  });

  it('falls back to an even pace when the timings no longer match the words', () => {
    expect(saidSoFar(line('Ça va ?', [1000]), 1500)).toEqual(['Ça v', 'a ?']);
  });
});

describe('word timing', () => {
  it('spreads untimed words by character, like the untimed karaoke', () => {
    expect(evenWordStarts({ ...line('ab cd'), startMs: 0, endMs: 1000 })).toEqual([0, 600]);
  });

  it('moves one word, its neighbours giving way, within the line', () => {
    const timed = line('ab cd ef', [1000, 1300, 1600]);
    expect(moveWordStart(timed, 1, 1700)).toEqual([1000, 1700, 1700]);
    expect(moveWordStart(timed, 2, 1100)).toEqual([1000, 1100, 1100]);
    expect(moveWordStart(timed, 0, 500)).toEqual([1000, 1300, 1600]);
    // An untimed line starts from the even pace.
    expect(moveWordStart(line('ab cd'), 1, 1800)).toEqual([1000, 1800]);
  });

  it('keeps timings inside the line and in order', () => {
    expect(fitWordStarts([50, 40, 2000], 100, 1000)).toEqual([100, 100, 999]);
  });

  describe('carries the timings over a text edit', () => {
    const timed = line('Tous les allemandes sont nazis', [1000, 1200, 1400, 1700, 1800]);
    const startsAfter = (text: string) => withText(timed, text).wordStartsMs;

    it('keeps them through typo, case and punctuation fixes', () => {
      expect(startsAfter('Tous les Allemands sont nazis.')).toEqual([1000, 1200, 1400, 1700, 1800]);
    });

    it('places an added word between its neighbours', () => {
      // "ne" typed between "allemandes" (1400) and "sont" (1700); "pas" between "sont" and "nazis".
      expect(startsAfter('Tous les allemandes ne sont pas nazis')).toEqual([
        1000, 1200, 1400, 1550, 1700, 1750, 1800,
      ]);
      // Before the first word: from the line's start up to the old first word.
      expect(startsAfter('Non, tous les allemandes sont nazis')).toEqual([
        1000, 1000, 1200, 1400, 1700, 1800,
      ]);
      // After the last word: until the line's end.
      expect(startsAfter('Tous les allemandes sont nazis monsieur')).toEqual([
        1000, 1200, 1400, 1700, 1800, 1900,
      ]);
    });

    it('drops the timings of removed words, and spreads replacements over the old ones', () => {
      expect(startsAfter('Tous allemandes sont nazis')).toEqual([1000, 1400, 1700, 1800]);
      // "les allemandes" replaced by two words: they take the old starts one for one.
      expect(startsAfter('Tous ces gens-là sont nazis')).toEqual([1000, 1200, 1400, 1700, 1800]);
      // ...by four: spread from where "les" started until "sont".
      expect(startsAfter('Tous ces gens du nord sont nazis')).toEqual([
        1000, 1200, 1325, 1450, 1575, 1700, 1800,
      ]);
    });

    it('leaves an untimed line untimed', () => {
      expect(withText(line('ab cd'), 'ab cd ef').wordStartsMs).toEqual([]);
    });
  });

  it('finds the word being said', () => {
    const timed = line('ab cd ef', [1000, 1300, 1600]);
    expect(wordAt(timed, 900)).toBe(-1);
    expect(wordAt(timed, 1350)).toBe(1);
    expect(wordAt(timed, 2000)).toBe(-1);
  });
});

describe('lineAt', () => {
  it('finds the current and next lines', () => {
    expect(lineAt(lines, 500)).toEqual({ current: lines[0], next: lines[1] });
    expect(lineAt(lines, 1100)).toEqual({ current: null, next: lines[1] });
    expect(lineAt(lines, 2999)).toEqual({ current: lines[2], next: null });
    expect(lineAt(lines, 3500)).toEqual({ current: null, next: null });
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit PCM WAV header and clamped samples', async () => {
    const samples = new Float32Array([0, 1, -1, 2]);
    const blob = encodeWav({
      numberOfChannels: 1,
      sampleRate: 8000,
      length: samples.length,
      getChannelData: () => samples,
    });
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (at: number) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
    expect([ascii(0), ascii(8), ascii(36)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});
