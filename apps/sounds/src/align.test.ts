import { describe, expect, it } from 'vitest';
import { ctcAlign, tokenize } from './align.js';

/** Log-probabilities: in each frame, the given token is likely and the others are not. */
function emissions(likely: number[], vocab: number) {
  const out = new Float32Array(likely.length * vocab).fill(Math.log(0.05));
  likely.forEach((token, t) => (out[t * vocab + token] = Math.log(0.9)));
  return out;
}

describe('ctcAlign', () => {
  it('finds the frame where each token starts', () => {
    // blank=0, a=1, b=2: "a" heard at frames 2-3, "b" at 6-7.
    const e = emissions([0, 0, 1, 1, 0, 0, 2, 2], 3);
    expect(ctcAlign(e, 8, 3, [1, 2], 0)).toEqual([2, 6]);
  });

  it('needs a blank between two repeated tokens', () => {
    const e = emissions([0, 0, 1, 0, 1, 0], 3);
    expect(ctcAlign(e, 6, 3, [1, 1], 0)).toEqual([2, 4]);
    // One frame can't hold two tokens.
    expect(ctcAlign(emissions([1], 3), 1, 3, [1, 2], 0)).toBeNull();
  });
});

describe('tokenize', () => {
  it('maps letters to the model, skipping what it does not know, one separator between words', () => {
    const vocab = { '<pad>': 0, '|': 1, a: 2, ç: 3, "'": 4, c: 5, e: 6 };
    expect(tokenize('Ça 21 c’e', vocab)).toEqual({
      tokens: [3, 2, 1, 5, 4, 6],
      firstToken: [0, null, 3], // "21": no letter the model knows
    });
  });

  it('falls back to the model case, and to letters without accents', () => {
    expect(tokenize('Ça', { '<pad>': 0, '|': 1, C: 2, A: 3 }).tokens).toEqual([2, 3]);
  });
});
