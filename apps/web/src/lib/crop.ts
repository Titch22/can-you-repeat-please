import { MAX_CUSTOM_SOUND_MS, MAX_UPLOAD_BYTES, MIN_CUSTOM_SOUND_MS } from '@cyrp/shared';

/** The part of a sound to keep, in ms from its start. */
export interface Crop {
  startMs: number;
  endMs: number;
}

const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** The whole sound. */
export const initialCrop = (durationMs: number): Crop => ({ startMs: 0, endMs: durationMs });

/**
 * `crop` with `moved` (its start or end) set to `ms`, kept inside the sound and at least 0.2 s
 * long. Any length is allowed while editing: `fits` says when it can be added.
 */
export function moveCrop(crop: Crop, durationMs: number, moved: keyof Crop, ms: number): Crop {
  const at = Math.round(ms);
  return moved === 'startMs'
    ? { ...crop, startMs: clamp(at, 0, Math.max(0, crop.endMs - MIN_CUSTOM_SOUND_MS)) }
    : {
        ...crop,
        endMs: clamp(at, Math.min(durationMs, crop.startMs + MIN_CUSTOM_SOUND_MS), durationMs),
      };
}

/** `crop` shifted by `deltaMs`, same length, stopping at the sound's edges. */
export function shiftCrop(crop: Crop, durationMs: number, deltaMs: number): Crop {
  const length = crop.endMs - crop.startMs;
  const startMs = clamp(Math.round(crop.startMs + deltaMs), 0, Math.max(0, durationMs - length));
  return { startMs, endMs: startMs + length };
}

/** True when the kept part is short enough to be added (20 s max). */
export const fits = (crop: Crop) => crop.endMs - crop.startMs <= MAX_CUSTOM_SOUND_MS;

/** True when the whole file is kept and already fits: upload it as it is (an mp3 stays small). */
export const keepsOriginal = (fileBytes: number, durationMs: number, crop: Crop) =>
  crop.startMs === 0 &&
  crop.endMs >= durationMs &&
  durationMs <= MAX_CUSTOM_SOUND_MS &&
  fileBytes <= MAX_UPLOAD_BYTES;
