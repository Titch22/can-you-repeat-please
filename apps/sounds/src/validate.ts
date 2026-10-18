import { measureDurationMs, sniffAudio, type AudioFormat } from '@cyrp/audio';
import {
  MAX_CUSTOM_SOUND_MS,
  MAX_UPLOAD_BYTES,
  MIN_CUSTOM_SOUND_MS,
  type LibraryErrorCode,
} from '@cyrp/shared';

export class LibraryError extends Error {
  constructor(public code: LibraryErrorCode) {
    super(code);
  }
}

/** Same rules as room uploads: ≤2 MB, 0.2–20 s, format recognised from the bytes. */
export async function checkAudio(
  data: Buffer,
): Promise<{ format: AudioFormat; durationMs: number }> {
  if (data.length > MAX_UPLOAD_BYTES) throw new LibraryError('FILE_TOO_LARGE');
  const format = sniffAudio(data);
  if (!format) throw new LibraryError('UNSUPPORTED_FORMAT');
  const durationMs = await measureDurationMs(data, format.mime);
  if (durationMs === null) throw new LibraryError('UNSUPPORTED_FORMAT');
  if (durationMs > MAX_CUSTOM_SOUND_MS) throw new LibraryError('SOUND_TOO_LONG');
  if (durationMs < MIN_CUSTOM_SOUND_MS) throw new LibraryError('INVALID_PAYLOAD');
  return { format, durationMs };
}
