/**
 * Loudness normalization for game sounds (default pack, uploads, recordings), which vary a lot:
 * the default pack alone spans ~29 dB.
 *
 * Loudness here is a gated RMS: the signal is cut into 50 ms windows and only windows above
 * -50 dBFS count, so silence and pauses don't drag it down and very short clips still work.
 * A simplified LUFS (no K-weighting), good enough to even out meme clips and voices.
 */

/** Target gated RMS: -20 dBFS. */
export const TARGET_RMS = 0.1;
/** Never boost more than +15.6 dB, so a near-silent recording doesn't become loud mic noise. */
export const MAX_GAIN = 6;
export const MIN_GAIN = 0.1;
const WINDOW_SECONDS = 0.05;
/** -50 dBFS: windows quieter than this are silence and don't count. */
const GATE_RMS = 10 ** (-50 / 20);

/** Gated RMS of the (mono mix of the) channels, or 0 if everything is below the gate. */
export function gatedRms(channels: Float32Array[], sampleRate: number): number {
  const length = Math.min(...channels.map((c) => c.length));
  if (!channels.length || length === 0) return 0;
  const window = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  let energy = 0;
  let counted = 0;
  for (let start = 0; start < length; start += window) {
    const end = Math.min(length, start + window);
    let sum = 0;
    for (let i = start; i < end; i++) {
      let v = 0;
      for (const c of channels) v += c[i]!;
      v /= channels.length;
      sum += v * v;
    }
    const meanSquare = sum / (end - start);
    if (Math.sqrt(meanSquare) >= GATE_RMS) {
      energy += meanSquare;
      counted++;
    }
  }
  return counted ? Math.sqrt(energy / counted) : 0;
}

/** Gain bringing the sound to TARGET_RMS, clamped to [MIN_GAIN, MAX_GAIN]; 1 for silence. */
export function normalizationGain(channels: Float32Array[], sampleRate: number): number {
  const rms = gatedRms(channels, sampleRate);
  if (rms === 0) return 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / rms));
}
