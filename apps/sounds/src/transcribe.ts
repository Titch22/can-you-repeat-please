import path from 'node:path';
import type { TranscriptLanguage, TranscriptWord } from '@cyrp/shared';

/** Multilingual (French and English clips), exported with the attention heads word timings need. */
const MODEL = 'onnx-community/whisper-base_timestamped';
/** Frees the model's memory when nobody transcribed for this long. */
const IDLE_UNLOAD_MS = 5 * 60_000;

export type Transcriber = (
  samples: Float32Array,
  language: TranscriptLanguage,
) => Promise<TranscriptWord[]>;

type Chunk = { text: string; timestamp: [number, number | null] };

/**
 * Whisper's word chunks (seconds) as words (ms). A chunk without a leading space, or starting
 * with an apostrophe or a hyphen, continues the previous word: French elisions come as
 * "c" + " 'est", "j" + " 'y".
 */
export function toWords(chunks: Chunk[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const { text, timestamp } of chunks) {
    const [startMs, endMs] = timestamp.map((s) => Math.round((s ?? timestamp[0]) * 1000));
    const last = words.at(-1);
    if (last && (!/^\s/.test(text) || /^\s*['’-]/.test(text))) {
      last.text += text.trim();
      last.endMs = endMs!;
    } else if (text.trim()) {
      words.push({ text: text.trim(), startMs: startMs!, endMs: endMs! });
    }
  }
  return words;
}

/**
 * Speech to text with word timings (Whisper, on the CPU). The model is downloaded once into
 * `dataDir/models` (~80 MB), loaded on the first request (~800 MB of memory) and unloaded when
 * idle. Requests run one at a time: each takes a few seconds of CPU.
 */
export function createTranscriber(dataDir: string): Transcriber {
  type Asr = Awaited<ReturnType<typeof load>>;
  let asr: Promise<Asr> | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load() {
    // Loaded on demand: the library service starts (and serves) without it.
    const { env, pipeline } = await import('@huggingface/transformers');
    // Everything it downloads goes to the data volume (its default, inside node_modules, isn't
    // writable in the container).
    env.cacheDir = path.join(dataDir, 'models');
    return pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  }

  const run = async (samples: Float32Array, language: TranscriptLanguage) => {
    clearTimeout(idle);
    asr ??= load();
    try {
      const model = await asr;
      const result = await model(samples, {
        return_timestamps: 'word',
        language,
        task: 'transcribe',
      });
      const { chunks = [] } = Array.isArray(result) ? result[0]! : result;
      return toWords(chunks as Chunk[]);
    } catch (err) {
      asr = null; // a failed download or load: retry next time
      throw err;
    } finally {
      const loaded = asr;
      idle = setTimeout(() => {
        if (asr !== loaded) return;
        asr = null;
        void loaded?.then((m) => m.dispose()).catch(() => {});
      }, IDLE_UNLOAD_MS);
      idle.unref();
    }
  };

  return (samples, language) => {
    const next = queue.then(() => run(samples, language));
    queue = next.catch(() => {});
    return next;
  };
}
