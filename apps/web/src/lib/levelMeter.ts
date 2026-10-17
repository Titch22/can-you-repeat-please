/**
 * Live level of an audio stream, robust to timer throttling.
 *
 * Meters are read on a timer. In a background tab browsers slow timers down to ~1 per second,
 * and reading only the latest few ms then misses short sounds (a quick "bruh", a beep). So the
 * analyser keeps ~0.7 s of audio, and each read looks at everything since the previous read
 * (cut into 20 ms frames): every 50 ms when visible, so it stays responsive, and up to 0.7 s
 * back when throttled.
 */

/** RMS level above which a voice counts as sound (speech is ~0.05–0.2, room noise < 0.01). */
export const THRESHOLD = 0.02;
const FRAME_SECONDS = 0.02;
const ANALYSER_SIZE = 32768; // ~0.7 s at 48 kHz: the longest look-back when throttled

/**
 * Loudest 20 ms frame within the last `seconds` of `samples`, and the RMS of the most recent
 * frame (for display).
 */
export function analyzeRecent(samples: Float32Array, sampleRate: number, seconds: number) {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const span = Math.min(samples.length, Math.max(frame, Math.round(sampleRate * seconds)));
  let peak = 0;
  let latest = 0;
  for (let end = samples.length; end - frame >= samples.length - span; end -= frame) {
    let sum = 0;
    for (let i = end - frame; i < end; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / frame);
    if (end === samples.length) latest = rms;
    if (rms > peak) peak = rms;
  }
  return { peak, latest };
}

export interface LevelMeter {
  /** Level of the latest frame, and the loudest frame since the previous read. */
  read(): { latest: number; peak: number };
  disconnect(): void;
}

export function createLevelMeter(ctx: AudioContext, stream: MediaStream): LevelMeter {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let lastRead = performance.now();
  return {
    read() {
      const now = performance.now();
      const since = (now - lastRead) / 1000;
      lastRead = now;
      analyser.getFloatTimeDomainData(samples);
      return analyzeRecent(samples, ctx.sampleRate, since);
    },
    disconnect() {
      source.disconnect();
    },
  };
}
