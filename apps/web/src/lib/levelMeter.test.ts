import { describe, expect, it } from 'vitest';
import { analyzeRecent } from './levelMeter';

const RATE = 48000;

/** `seconds` of audio, with a short loud beep starting at `beepAt` seconds. */
function withBeep(seconds: number, beepAt: number, beepSeconds = 0.05) {
  const out = new Float32Array(Math.round(seconds * RATE));
  const start = Math.round(beepAt * RATE);
  const end = Math.round((beepAt + beepSeconds) * RATE);
  for (let i = start; i < end && i < out.length; i++) out[i] = 0.5 * Math.sin(i / 10);
  return out;
}

describe('analyzeRecent', () => {
  it('only looks at the audio since the previous read when reads are frequent', () => {
    // 0.7 s buffer, beep ended 0.4 s ago: not part of the last 50 ms.
    const samples = withBeep(0.7, 0.25);
    expect(analyzeRecent(samples, RATE, 0.05).peak).toBeLessThan(0.001);
  });

  it('still catches a short sound when reads are throttled to ~1 per second', () => {
    const samples = withBeep(0.7, 0.25);
    expect(analyzeRecent(samples, RATE, 1).peak).toBeGreaterThan(0.2);
  });

  it('reports the latest frame for display', () => {
    const samples = withBeep(0.7, 0.68, 0.02);
    const { latest, peak } = analyzeRecent(samples, RATE, 0.05);
    expect(latest).toBeGreaterThan(0.2);
    expect(peak).toBeGreaterThanOrEqual(latest);
  });

  it('is silent on silence', () => {
    expect(analyzeRecent(new Float32Array(RATE), RATE, 1)).toEqual({ peak: 0, latest: 0 });
  });
});
