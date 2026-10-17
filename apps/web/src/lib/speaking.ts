import { audioContext } from './audio';

/**
 * Who is speaking, measured in the browser from each voice track's audio level.
 *
 * LiveKit's own detection runs on the server and updates about twice a second with smoothing,
 * so the "speaking" ring lit up late and lingered. Measuring locally reacts within ~50 ms.
 */

/** RMS level above which a voice counts as speaking (speech is ~0.05–0.2, room noise < 0.01). */
const THRESHOLD = 0.02;
/** Keep "speaking" this long after the last loud sample, so it doesn't flicker between words. */
const HOLD_MS = 300;
const TICK_MS = 50;

interface Meter {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  lastLoud: number;
}

const meters = new Map<string, Meter>();
const speaking = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let onChange: (() => void) | null = null;

/** Called whenever someone starts or stops speaking. */
export function onSpeakingChange(listener: () => void) {
  onChange = listener;
}

export function watchLevel(id: string, track: MediaStreamTrack) {
  unwatchLevel(id);
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  meters.set(id, { source, analyser, samples: new Float32Array(analyser.fftSize), lastLoud: 0 });
  timer ??= setInterval(tick, TICK_MS);
}

export function unwatchLevel(id: string) {
  meters.get(id)?.source.disconnect();
  meters.delete(id);
  if (speaking.delete(id)) onChange?.();
  if (meters.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function unwatchAll() {
  for (const id of [...meters.keys()]) unwatchLevel(id);
}

/**
 * Whether `id`'s level is being measured. False until the browser lets audio run (a click on
 * the page): a suspended audio context only yields silence.
 */
export function isMeasured(id: string) {
  return meters.has(id) && audioContext().state === 'running';
}

export const isSpeaking = (id: string) => speaking.has(id);

function tick() {
  const now = performance.now();
  let changed = false;
  for (const [id, m] of meters) {
    m.analyser.getFloatTimeDomainData(m.samples);
    let sum = 0;
    for (const v of m.samples) sum += v * v;
    if (Math.sqrt(sum / m.samples.length) > THRESHOLD) m.lastLoud = now;
    const speakingNow = now - m.lastLoud < HOLD_MS;
    if (speakingNow !== speaking.has(id)) {
      changed = true;
      if (speakingNow) speaking.add(id);
      else speaking.delete(id);
    }
  }
  if (changed) onChange?.();
}
