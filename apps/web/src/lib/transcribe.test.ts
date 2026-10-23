import { describe, expect, it } from 'vitest';
import type { DialogueLine, TranscriptWord as Word } from '@cyrp/shared';
import { fillLineText, suggestLines } from './transcribe';

const words: Word[] = [
  { text: 'You', startMs: 100, endMs: 300 },
  { text: 'talking', startMs: 320, endMs: 700 },
  { text: 'to', startMs: 720, endMs: 800 },
  { text: 'me?', startMs: 820, endMs: 1100 },
  // a long pause: the other character answers
  { text: 'Yes.', startMs: 2000, endMs: 2400 },
];

describe('fillLineText', () => {
  const line = (startMs: number, endMs: number, text = '', wordStartsMs: number[] = []) =>
    ({ startMs, endMs, speaker: 'A', text, wordStartsMs }) satisfies DialogueLine;

  it('gives each line the words heard during it (by midpoint), with their timings', () => {
    const filled = fillLineText([line(0, 750), line(750, 1500)], words);
    expect(filled.map((l) => [l.text, l.wordStartsMs])).toEqual([
      ['You talking', [100, 320]],
      ['to me?', [750, 820]], // "to" starts at 720, before its line: moved to the line's start
    ]);
  });

  it('times a typed text with as many words, and leaves other typed or timed lines alone', () => {
    const typed = [
      line(1800, 2600, 'Yeah.'),
      line(1800, 2600, 'Typed by hand'),
      line(1800, 2600, 'Timed', [1900]),
    ];
    expect(fillLineText(typed, words).map((l) => [l.text, l.wordStartsMs])).toEqual([
      ['Yeah.', [2000]],
      ['Typed by hand', []],
      ['Timed', [1900]],
    ]);
  });
});

describe('suggestLines', () => {
  it('starts a new line at each long pause', () => {
    expect(suggestLines(words, 3000)).toEqual([
      {
        startMs: 100,
        endMs: 1100,
        speaker: 'A',
        text: 'You talking to me?',
        wordStartsMs: [100, 320, 720, 820],
      },
      { startMs: 2000, endMs: 2400, speaker: 'A', text: 'Yes.', wordStartsMs: [2000] },
    ]);
  });

  it('stretches a too-short line to the minimum length, within the sound', () => {
    const blip = [{ text: 'Hm.', startMs: 2800, endMs: 2900 }];
    expect(suggestLines(blip, 3200)).toEqual([
      { startMs: 2800, endMs: 3100, speaker: 'A', text: 'Hm.', wordStartsMs: [2800] },
    ]);
    // No room left before the end: dropped.
    expect(suggestLines(blip, 2950)).toEqual([]);
  });
});
