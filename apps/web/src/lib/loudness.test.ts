import { describe, expect, it } from 'vitest';
import { MAX_GAIN, TARGET_RMS, gatedRms, normalizationGain } from './loudness';

const RATE = 8000;

function sine(seconds: number, amplitude: number, freq = 440) {
  return Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / RATE),
  );
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const scaled = (s: Float32Array, gain: number) => s.map((v) => v * gain);
const db = (ratio: number) => 20 * Math.log10(ratio);

describe('normalizationGain', () => {
  it('brings quiet and loud sounds to the same loudness', () => {
    const quiet = sine(1, 0.05); // needs ~2.8x: below the cap
    const loud = sine(1, 0.9);
    const quietOut = gatedRms([scaled(quiet, normalizationGain([quiet], RATE))], RATE);
    const loudOut = gatedRms([scaled(loud, normalizationGain([loud], RATE))], RATE);
    expect(Math.abs(db(quietOut / loudOut))).toBeLessThan(0.1);
    expect(loudOut).toBeCloseTo(TARGET_RMS, 3);
  });

  it('ignores silence around and inside the sound', () => {
    const tone = sine(0.5, 0.3);
    const padded = concat(silence(2), tone, silence(1), tone, silence(3));
    expect(normalizationGain([padded], RATE)).toBeCloseTo(normalizationGain([tone], RATE), 2);
  });

  it('leaves pure silence alone', () => {
    expect(normalizationGain([silence(1)], RATE)).toBe(1);
  });

  it('caps the boost for very quiet sounds (mic noise)', () => {
    // -43 dBFS: above the silence gate, would need ~14x.
    expect(normalizationGain([sine(1, 0.01)], RATE)).toBe(MAX_GAIN);
  });

  it('treats sound below the -50 dBFS gate as silence', () => {
    expect(normalizationGain([sine(1, 0.004)], RATE)).toBe(1);
  });

  it('handles very short clips', () => {
    const gain = normalizationGain([sine(0.3, 0.5)], RATE);
    expect(gain).toBeGreaterThan(0.2);
    expect(gain).toBeLessThan(0.4); // 0.5-amplitude sine: RMS ≈ 0.354 → gain ≈ 0.28
  });

  it('mixes stereo down to mono', () => {
    const left = sine(1, 0.4);
    expect(normalizationGain([left, left], RATE)).toBeCloseTo(normalizationGain([left], RATE), 5);
  });
});
