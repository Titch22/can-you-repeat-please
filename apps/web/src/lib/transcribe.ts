import {
  fitWordStarts,
  MIN_DIALOGUE_LINE_MS,
  textWords,
  TRANSCRIBE_SAMPLE_RATE,
  type DialogueLine,
  type TranscriptWord as Word,
} from '@cyrp/shared';

/** A silence longer than this starts a new suggested line. */
const LINE_GAP_MS = 600;

/**
 * Gives each line the words heard during it (by word midpoint): its text and their timings when
 * it has no text yet; only the timings when its text has as many words (typed by hand, kept).
 * Lines already timed are left alone.
 */
export function fillLineText(lines: DialogueLine[], words: Word[]): DialogueLine[] {
  return lines.map((line) => {
    if (line.wordStartsMs.length) return line;
    const said = words.filter((w) => {
      const mid = (w.startMs + w.endMs) / 2;
      return mid >= line.startMs && mid < line.endMs;
    });
    const timed = (text: string) => ({
      ...line,
      text,
      wordStartsMs: fitWordStarts(
        said.map((w) => w.startMs),
        line.startMs,
        line.endMs,
      ),
    });
    if (!line.text) return said.length ? timed(said.map((w) => w.text).join(' ')) : line;
    return textWords(line.text).length === said.length ? timed(line.text) : line;
  });
}

/**
 * Lines for a sound that has none: words grouped where the speech pauses, all character A
 * (Whisper can't tell the characters apart; the admin switches them). Lines too short to keep
 * are stretched to the minimum length when there is room, dropped otherwise.
 */
export function suggestLines(words: Word[], durationMs: number): DialogueLine[] {
  const groups: Word[][] = [];
  for (const w of words) {
    const last = groups.at(-1);
    if (last && w.startMs - last.at(-1)!.endMs < LINE_GAP_MS) last.push(w);
    else groups.push([w]);
  }
  const lines: DialogueLine[] = [];
  groups.forEach((g, i) => {
    const startMs = Math.max(g[0]!.startMs, lines.at(-1)?.endMs ?? 0);
    const limit = Math.min(groups[i + 1]?.[0]!.startMs ?? durationMs, durationMs);
    const endMs = Math.min(Math.max(g.at(-1)!.endMs, startMs + MIN_DIALOGUE_LINE_MS), limit);
    if (endMs - startMs < MIN_DIALOGUE_LINE_MS) return;
    lines.push({
      startMs,
      endMs,
      speaker: 'A',
      text: g.map((w) => w.text).join(' '),
      wordStartsMs: fitWordStarts(
        g.map((w) => w.startMs),
        startMs,
        endMs,
      ),
    });
  });
  return lines;
}

/** The sound as the speech recognition wants it: mono, at TRANSCRIBE_SAMPLE_RATE. */
export async function toTranscriptionInput(buffer: AudioBuffer) {
  const rate = TRANSCRIBE_SAMPLE_RATE;
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}
