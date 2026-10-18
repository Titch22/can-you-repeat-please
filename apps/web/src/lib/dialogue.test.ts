import { describe, expect, it } from 'vitest';
import type { DialogueLine, Performance } from '@cyrp/shared';
import { encodeWav, lineAt, performanceSegments } from './dialogue';

const lines: DialogueLine[] = [
  { startMs: 0, endMs: 1000, speaker: 'A' },
  { startMs: 1200, endMs: 2000, speaker: 'B' },
  { startMs: 2500, endMs: 3000, speaker: 'A' },
];

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
    expect(performanceSegments(p, lines)).toEqual([
      { url: '/ann', offsetMs: 0, durationMs: 1000, atMs: 0 },
      { url: '/bob', offsetMs: 1200, durationMs: 800, atMs: 1200 },
      { url: '/ann', offsetMs: 2500, durationMs: 500, atMs: 2500 },
    ]);
  });

  it('takes every line from a solo player', () => {
    const p = perf([{ playerId: 'sam', url: '/sam', role: 'both' }]);
    expect(performanceSegments(p, lines).map((s) => s.url)).toEqual(['/sam', '/sam', '/sam']);
  });

  it('leaves the lines of a member who did not record silent', () => {
    const p = perf([{ playerId: 'bob', url: '/bob', role: 'B' }]);
    expect(performanceSegments(p, lines)).toEqual([
      { url: '/bob', offsetMs: 1200, durationMs: 800, atMs: 1200 },
    ]);
  });

  it('plays a classic recording whole', () => {
    const p = perf([{ playerId: 'ann', url: '/ann', role: null }]);
    expect(performanceSegments(p, undefined)).toEqual([
      { url: '/ann', offsetMs: 0, durationMs: 4000, atMs: 0 },
    ]);
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
