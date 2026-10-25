import { describe, expect, it } from 'vitest';
import { fits, initialCrop, keepsOriginal, moveCrop, shiftCrop } from './crop';

describe('crop', () => {
  it('starts with the whole sound, which can be added only up to 20 seconds', () => {
    expect(initialCrop(90_000)).toEqual({ startMs: 0, endMs: 90_000 });
    expect(fits(initialCrop(90_000))).toBe(false);
    expect(fits(initialCrop(20_000))).toBe(true);
  });

  it('moves either edge anywhere in the sound, keeping at least 0.2 seconds', () => {
    const whole = initialCrop(300_000);
    // The end of a long video: move the start, any distance.
    expect(moveCrop(whole, 300_000, 'startMs', 290_000)).toEqual({
      startMs: 290_000,
      endMs: 300_000,
    });
    const crop = { startMs: 10_000, endMs: 15_000 };
    expect(moveCrop(crop, 25_000, 'endMs', 40_000)).toEqual({ startMs: 10_000, endMs: 25_000 });
    expect(moveCrop(crop, 90_000, 'endMs', 5_000)).toEqual({ startMs: 10_000, endMs: 10_200 });
    expect(moveCrop(crop, 90_000, 'startMs', 16_000)).toEqual({ startMs: 14_800, endMs: 15_000 });
    expect(moveCrop(crop, 90_000, 'startMs', -500)).toEqual({ startMs: 0, endMs: 15_000 });
  });

  it('moves the whole selection, same length, inside the sound', () => {
    const crop = { startMs: 10_000, endMs: 15_000 };
    expect(shiftCrop(crop, 60_000, 20_000)).toEqual({ startMs: 30_000, endMs: 35_000 });
    expect(shiftCrop(crop, 60_000, -30_000)).toEqual({ startMs: 0, endMs: 5_000 });
    expect(shiftCrop(crop, 60_000, 90_000)).toEqual({ startMs: 55_000, endMs: 60_000 });
  });

  it('keeps the original file only when it is whole and fits', () => {
    const whole = { startMs: 0, endMs: 4_000 };
    expect(keepsOriginal(100_000, 4_000, whole)).toBe(true);
    expect(keepsOriginal(100_000, 4_000, { startMs: 500, endMs: 4_000 })).toBe(false);
    expect(keepsOriginal(3_000_000, 4_000, whole)).toBe(false); // over 2 MB
    expect(keepsOriginal(100_000, 30_000, { startMs: 0, endMs: 20_000 })).toBe(false);
  });
});
