import {
  fitWordStarts,
  textWords,
  type DialogueLine,
  type Performance,
  type Role,
  type SoundRef,
  type Speaker,
} from '@cyrp/shared';

/** A piece of a recording to play: `durationMs` of `url` from `offsetMs`, at `atMs` in the scene. */
export interface Segment {
  url: string;
  offsetMs: number;
  durationMs: number;
  atMs: number;
  /** Play at the loudness gain of this sound instead of its own (see loudness.ts). */
  gainUrl?: string;
}

/** Whether a player with `role` voices `speaker`'s lines. */
export const speaks = (role: Role | null | undefined, speaker: Speaker) =>
  role === 'both' || role === speaker;

/**
 * How to play a performance. Everyone records over the whole scene, so a team's performance is
 * stitched: during each line, the recording of whoever voices that line (same timecodes as the
 * original). Lines nobody recorded stay silent. Under them plays the scene's background (without
 * the voices) if it has one, at the original's level so it keeps the film's balance. Classic
 * performances play whole.
 */
export function performanceSegments(
  performance: Performance,
  reference: Pick<SoundRef, 'url' | 'lines' | 'backgroundUrl'> | null | undefined,
): Segment[] {
  const lines = reference?.lines;
  const whole = performance.parts.every((p) => p.role === null) || !lines?.length;
  if (whole) {
    return performance.parts.map((p) => ({
      url: p.url,
      offsetMs: 0,
      durationMs: performance.durationMs,
      atMs: 0,
    }));
  }
  const background: Segment[] = reference?.backgroundUrl
    ? [
        {
          url: reference.backgroundUrl,
          offsetMs: 0,
          durationMs: performance.durationMs,
          atMs: 0,
          gainUrl: reference.url,
        },
      ]
    : [];
  const voices = lines.flatMap((line) => {
    const part = performance.parts.find((p) => speaks(p.role, line.speaker));
    return part
      ? [
          {
            url: part.url,
            offsetMs: line.startMs,
            durationMs: line.endMs - line.startMs,
            atMs: line.startMs,
          },
        ]
      : [];
  });
  return [...background, ...voices];
}

/** The line spoken at `ms` into the scene (if any), and the next one to come. */
export function lineAt(lines: DialogueLine[], ms: number) {
  const current = lines.find((l) => ms >= l.startMs && ms < l.endMs) ?? null;
  const next = lines.find((l) => l.startMs > ms) ?? null;
  return { current, next };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The first `fraction` of `s`, by code point: never splits an accented letter or an emoji. */
const head = (s: string, fraction: number) => {
  const chars = Array.from(s);
  return chars.slice(0, Math.round(fraction * chars.length)).join('');
};

/**
 * Karaoke: `line`'s text split into what is already said `ms` into the scene and what is left.
 * Follows the line's word timings (each word fills up until the next starts); without them,
 * an even pace from the line's start to its end.
 */
export function saidSoFar(line: DialogueLine, ms: number): [said: string, rest: string] {
  const { text, startMs, endMs } = line;
  let cut: number;
  const words = [...text.matchAll(/\S+/g)];
  const starts = line.wordStartsMs;
  if (starts.length && starts.length === words.length) {
    let i = -1; // the word being said: the last one started (starts are in order)
    while (i + 1 < starts.length && starts[i + 1]! <= ms) i++;
    if (i < 0) cut = 0;
    else if (ms >= endMs) cut = text.length;
    else {
      const until = starts[i + 1] ?? endMs;
      const word = words[i]!;
      cut = word.index + head(word[0], clamp01((ms - starts[i]!) / (until - starts[i]!))).length;
    }
  } else {
    cut = head(text, clamp01((ms - startMs) / (endMs - startMs))).length;
  }
  return [text.slice(0, cut), text.slice(cut)];
}

/** Word starts at an even pace through the line (by character), like the untimed karaoke. */
export function evenWordStarts({ text, startMs, endMs }: DialogueLine) {
  return [...text.matchAll(/\S+/g)].map((w) =>
    Math.round(startMs + (w.index / text.length) * (endMs - startMs)),
  );
}

/**
 * The line's word starts with word `index` moved to `ms` (untimed lines start from an even
 * pace). Neighbours give way to keep the order: earlier words start no later, later no earlier.
 */
export function moveWordStart(line: DialogueLine, index: number, ms: number) {
  const starts = line.wordStartsMs.length ? line.wordStartsMs : evenWordStarts(line);
  const t = Math.min(line.endMs - 1, Math.max(line.startMs, Math.round(ms)));
  return starts.map((s, k) => (k < index ? Math.min(s, t) : k > index ? Math.max(s, t) : t));
}

/** The index of the word being said at `ms` (by its timings, or an even pace), -1 before. */
export function wordAt(line: DialogueLine, ms: number) {
  const starts = line.wordStartsMs.length ? line.wordStartsMs : evenWordStarts(line);
  let i = -1;
  while (i + 1 < starts.length && starts[i + 1]! <= ms) i++;
  return ms < line.endMs ? i : -1;
}

/** A word as compared between two versions of a line: case and punctuation don't count. */
const wordKey = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || w;

/** Pairs [oldIndex, newIndex] of the words both texts share, in order (longest common subsequence). */
function sharedWords(before: string[], after: string[]): [number, number][] {
  const a = before.map(wordKey);
  const b = after.map(wordKey);
  // best[i][j]: shared words between a[i..] and b[j..]
  const best = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      best[i]![j] =
        a[i] === b[j] ? best[i + 1]![j + 1]! + 1 : Math.max(best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * The line with `text`, carrying its word timings over the edit: words kept keep their start,
 * a word replaced by one other word (a typo fix) takes its start, and the other new words are
 * spread over the gap where they were typed. An untimed line stays untimed.
 */
export function withText(line: DialogueLine, text: string): DialogueLine {
  const before = textWords(line.text);
  const after = textWords(text);
  const old = line.wordStartsMs;
  if (!old.length || old.length !== before.length || !after.length) {
    return { ...line, text, wordStartsMs: [] };
  }
  const starts: number[] = [];
  // Between two shared words (or the line's edges): the old and the new words in that gap.
  const anchors: [number, number][] = [
    [-1, -1],
    ...sharedWords(before, after),
    [before.length, after.length],
  ];
  for (let k = 1; k < anchors.length; k++) {
    const [oldFrom, newFrom] = anchors[k - 1]!;
    const [oldTo, newTo] = anchors[k]!;
    const gapOld = old.slice(oldFrom + 1, oldTo);
    const gapNew = newTo - newFrom - 1;
    if (gapNew === gapOld.length) starts.push(...gapOld);
    else if (gapNew > 0) {
      const to = old[oldTo] ?? line.endMs;
      // From the first replaced word, or just after the previous word (or the line's start).
      const [from, first] = gapOld.length
        ? [gapOld[0]!, 0]
        : oldFrom >= 0
          ? [old[oldFrom]!, 1]
          : [line.startMs, 0];
      const slots = gapNew + first;
      for (let n = 0; n < gapNew; n++) {
        starts.push(Math.round(from + ((to - from) * (n + first)) / slots));
      }
    }
    if (newTo < after.length) starts.push(old[oldTo]!);
  }
  return { ...line, text, wordStartsMs: fitWordStarts(starts, line.startMs, line.endMs) };
}

/** 16-bit PCM WAV of an AudioBuffer (what a stitched team performance is downloaded as). */
export function encodeWav(
  buffer: Pick<AudioBuffer, 'numberOfChannels' | 'sampleRate' | 'length' | 'getChannelData'>,
): Blob {
  const channels = buffer.numberOfChannels;
  const bytes = 44 + buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (at: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, buffer.length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (const channel of data) {
      const s = Math.max(-1, Math.min(1, channel[i]!));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
