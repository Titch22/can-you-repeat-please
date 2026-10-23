import fs from 'node:fs/promises';
import path from 'node:path';
import {
  fitWordStarts,
  textWords,
  TRANSCRIBE_SAMPLE_RATE,
  type TranscriptLanguage,
} from '@cyrp/shared';

/**
 * Letter-level speech models (wav2vec2, CTC) per language: the ones WhisperX aligns with.
 * French: jonatasgrosman/wav2vec2-large-xlsr-53-french as ONNX (int8, ~355 MB).
 */
const MODELS: Record<TranscriptLanguage, { id: string; dtype: 'int8' | 'q8' }> = {
  french: { id: 'XDcobra/wav2vec2-large-xlsr-53-french-ONNX', dtype: 'int8' },
  english: { id: 'Xenova/wav2vec2-base-960h', dtype: 'q8' },
};
/** Frees a model's memory when nobody aligned for this long. */
const IDLE_UNLOAD_MS = 5 * 60_000;
/** Lines are searched slightly beyond their edges: they're marked by hand, roughly. */
const LINE_PAD_MS = 150;
/** The models' "nothing new here" token, and their word separator. */
const BLANK = '<pad>';
const SPACE = '|';

export interface AlignLine {
  startMs: number;
  endMs: number;
  text: string;
}
/** When each word of each line starts (ms); [] for a line that couldn't be aligned. */
export type Aligner = (
  samples: Float32Array,
  language: TranscriptLanguage,
  lines: AlignLine[],
) => Promise<number[][]>;

/**
 * CTC forced alignment (Viterbi): the most likely frame at which each of `tokens` starts,
 * given per-frame log-probabilities `emissions` (`frames` × `vocab`). Null if the tokens can't
 * fit in that many frames.
 */
export function ctcAlign(
  emissions: Float32Array,
  frames: number,
  vocab: number,
  tokens: number[],
  blank: number,
): number[] | null {
  const states = 2 * tokens.length + 1; // blank, token, blank, token, …, blank
  const label = (s: number) => (s % 2 ? tokens[(s - 1) / 2]! : blank);
  // A path may skip the blank between two different tokens (not between repeats).
  const canSkip = (s: number) => s % 2 === 1 && s > 1 && label(s) !== label(s - 2);
  let score = new Float64Array(states).fill(-Infinity);
  score[0] = emissions[blank]!;
  if (states > 1) score[1] = emissions[label(1)]!;
  const from = new Uint8Array(frames * states); // 0: stay, 1: from s-1, 2: from s-2
  for (let t = 1; t < frames; t++) {
    const next = new Float64Array(states).fill(-Infinity);
    for (let s = 0; s < states; s++) {
      let best = score[s]!;
      let step = 0;
      if (s > 0 && score[s - 1]! > best) [best, step] = [score[s - 1]!, 1];
      if (canSkip(s) && score[s - 2]! > best) [best, step] = [score[s - 2]!, 2];
      if (best === -Infinity) continue;
      next[s] = best + emissions[t * vocab + label(s)]!;
      from[t * states + s] = step;
    }
    score = next;
  }
  // The path ends on the last token or the blank after it.
  let s = states > 1 && score[states - 2]! > score[states - 1]! ? states - 2 : states - 1;
  if (score[s] === -Infinity) return null;
  const starts = new Array<number>(tokens.length);
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2) starts[(s - 1) / 2] = t; // earliest frame seen so far for that token
    s -= from[t * states + s]!;
  }
  return starts;
}

/** Log-softmax of each frame of `logits` (`frames` × `vocab`), in place. */
function logSoftmax(logits: Float32Array, frames: number, vocab: number) {
  for (let t = 0; t < frames; t++) {
    const row = logits.subarray(t * vocab, (t + 1) * vocab);
    const max = Math.max(...row);
    let sum = 0;
    for (const x of row) sum += Math.exp(x - max);
    const log = max + Math.log(sum);
    for (let v = 0; v < vocab; v++) row[v] = row[v]! - log;
  }
}

/**
 * A line's text as model tokens, and the index of each word's first token (null for a word
 * with no letter the model knows, e.g. a number). Letters are matched as they are, then in the
 * model's case, then without accents (English models have none).
 */
export function tokenize(text: string, vocab: Record<string, number>) {
  const idOf = (ch: string) =>
    vocab[ch] ??
    vocab[ch.toLowerCase()] ??
    vocab[ch.toUpperCase()] ??
    vocab[ch.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()] ??
    vocab[ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()];
  const tokens: number[] = [];
  const firstToken: (number | null)[] = [];
  textWords(text).forEach((word, i) => {
    const space = vocab[SPACE];
    if (i > 0 && tokens.length && space !== undefined && tokens.at(-1) !== space) {
      tokens.push(space);
    }
    const ids = Array.from(word.replace(/’/g, "'"), idOf).filter((id) => id !== undefined);
    firstToken.push(ids.length ? tokens.length : null);
    tokens.push(...ids);
  });
  return { tokens, firstToken };
}

/** Fills the words that got no time (no known letter) between their neighbours. */
function fillGaps(starts: (number | null)[], startMs: number, endMs: number) {
  return starts.map((t, i) => {
    if (t !== null) return t;
    let before = startMs;
    for (let j = 0; j < i; j++) before = starts[j] ?? before;
    const after = starts.slice(i + 1).find((x) => x !== null) ?? endMs;
    return Math.round((before + after) / 2);
  });
}

/**
 * Word timings by forced alignment: the language's letter model runs once over the whole
 * sound, then each line's known text is aligned within the line (a little beyond its edges).
 * Models are downloaded once into `dataDir/models`, loaded on demand (the French one takes
 * ~650 MB of memory) and unloaded when idle. Requests run one at a time.
 */
export function createAligner(dataDir: string): Aligner {
  const cacheDir = path.join(dataDir, 'models');
  type Loaded = Awaited<ReturnType<typeof load>>;
  const loaded = new Map<TranscriptLanguage, Promise<Loaded>>();
  const idle = new Map<TranscriptLanguage, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();

  async function load(language: TranscriptLanguage) {
    const { AutoFeatureExtractor, AutoModelForCTC, env } =
      await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    const { id, dtype } = MODELS[language];
    const [extractor, model, vocab] = await Promise.all([
      AutoFeatureExtractor.from_pretrained(id),
      AutoModelForCTC.from_pretrained(id, { dtype }),
      vocabOf(id),
    ]);
    return { extractor, model, vocab };
  }

  /** The model's letters (its vocab.json, kept next to the model files). */
  async function vocabOf(id: string): Promise<Record<string, number>> {
    const file = path.join(cacheDir, id, 'vocab.json');
    const cached = await fs.readFile(file, 'utf8').catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, number>;
    const res = await fetch(`https://huggingface.co/${id}/resolve/main/vocab.json`);
    if (!res.ok) throw new Error(`vocab.json of ${id}: HTTP ${res.status}`);
    const text = await res.text();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return JSON.parse(text) as Record<string, number>;
  }

  const run = async (samples: Float32Array, language: TranscriptLanguage, lines: AlignLine[]) => {
    clearTimeout(idle.get(language));
    if (!loaded.has(language)) loaded.set(language, load(language));
    const current = loaded.get(language)!;
    try {
      const { extractor, model, vocab } = await current;
      const { logits } = await model(await extractor(samples));
      const [, frames, size] = logits.dims as [number, number, number];
      const emissions = logits.data as Float32Array;
      logSoftmax(emissions, frames, size);
      const frameMs = (samples.length / TRANSCRIBE_SAMPLE_RATE) * (1000 / frames);
      const blank = vocab[BLANK]!;

      return lines.map(({ startMs, endMs, text }) => {
        const { tokens, firstToken } = tokenize(text, vocab);
        if (!tokens.length) return [];
        const f0 = Math.max(0, Math.floor((startMs - LINE_PAD_MS) / frameMs));
        const f1 = Math.min(frames, Math.ceil((endMs + LINE_PAD_MS) / frameMs));
        const window = emissions.subarray(f0 * size, f1 * size);
        const at = ctcAlign(window, f1 - f0, size, tokens, blank);
        if (!at) return [];
        const starts = firstToken.map((k) =>
          k === null ? null : Math.round((f0 + at[k]!) * frameMs),
        );
        return fitWordStarts(fillGaps(starts, startMs, endMs), startMs, endMs);
      });
    } catch (err) {
      loaded.delete(language); // a failed download or load: retry next time
      throw err;
    } finally {
      const timer = setTimeout(() => {
        if (loaded.get(language) !== current) return;
        loaded.delete(language);
        void current.then((m) => m.model.dispose()).catch(() => {});
      }, IDLE_UNLOAD_MS);
      timer.unref();
      idle.set(language, timer);
    }
  };

  return (samples, language, lines) => {
    const next = queue.then(() => run(samples, language, lines));
    queue = next.catch(() => {});
    return next;
  };
}
