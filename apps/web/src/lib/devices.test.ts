import { describe, expect, it } from 'vitest';
import { clampBoost, clampVolume, pickInput } from './devices';

const mics = [{ deviceId: 'headset' }, { deviceId: 'webcam' }];

describe('pickInput', () => {
  it('keeps the saved mic while it is plugged in', () => {
    expect(pickInput('headset', mics)).toBe('headset');
  });

  it('falls back to the default when the saved mic is gone', () => {
    expect(pickInput('usb-mic', mics)).toBeUndefined();
  });

  it('uses the default when nothing was saved', () => {
    expect(pickInput(null, mics)).toBeUndefined();
  });
});

describe('clampBoost', () => {
  it('keeps values between 1 and 4', () => {
    expect(clampBoost(2.5)).toBe(2.5);
    expect(clampBoost('3')).toBe(3);
    expect(clampBoost(9)).toBe(4);
    expect(clampBoost(0.2)).toBe(1);
  });

  it('defaults to 1 for missing or invalid values', () => {
    expect(clampBoost(undefined)).toBe(1);
    expect(clampBoost('loud')).toBe(1);
    expect(clampBoost(NaN)).toBe(1);
  });
});

describe('clampVolume', () => {
  it('keeps a saved volume within 0–100%, full volume when missing or invalid', () => {
    expect(clampVolume('0.4')).toBe(0.4);
    expect(clampVolume('0')).toBe(0); // muted stays muted
    expect(clampVolume('7')).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(null)).toBe(1);
    expect(clampVolume('')).toBe(1);
    expect(clampVolume('loud')).toBe(1);
  });
});
