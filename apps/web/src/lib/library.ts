import { create } from 'zustand';
import {
  toSoundRef,
  type LibraryErrorCode,
  type LibrarySound,
  type LibrarySoundPatch,
  type SoundRef,
  type TranscriptLanguage,
  type TranscriptWord,
} from '@cyrp/shared';

/**
 * The sound library service (apps/sounds). In development the web dev server proxies
 * /sounds-api to it; production builds point VITE_SOUNDS_URL at its own domain.
 */
export const SOUNDS_URL = (import.meta.env.VITE_SOUNDS_URL ?? '/sounds-api').replace(/\/$/, '');

/** A library sound as the lobby uses it: a SoundRef with a `lib:` id, plus its tags. */
export type LibraryRef = SoundRef & { tags: string[] };

export async function fetchLibrary(init?: RequestInit): Promise<LibrarySound[]> {
  const res = await fetch(`${SOUNDS_URL}/v1/sounds`, init);
  if (!res.ok) throw new Error(`library ${res.status}`);
  return (await res.json()) as LibrarySound[];
}

interface LibraryStore {
  sounds: LibraryRef[] | null;
  error: boolean;
  /** Fetches the whole library (it's small: metadata only). Filtering happens client side. */
  load(): Promise<void>;
}

export const useLibrary = create<LibraryStore>((set) => ({
  sounds: null,
  error: false,
  async load() {
    set({ error: false });
    try {
      set({ sounds: (await fetchLibrary()).map(toSoundRef) });
    } catch {
      set({ error: true });
    }
  },
}));

// ── Admin ───────────────────────────────────────────────────────────────────────

export type AdminResult<T> =
  { ok: true; value: T } | { ok: false; error: LibraryErrorCode | 'NETWORK'; sound?: LibrarySound };

async function adminCall<T>(
  token: string,
  path: string,
  init: RequestInit,
): Promise<AdminResult<T>> {
  try {
    const res = await fetch(`${SOUNDS_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: LibraryErrorCode;
      sound?: LibrarySound;
    };
    if (res.ok) return { ok: true, value: body as T };
    return {
      ok: false,
      error: body.error ?? (res.status === 413 ? 'FILE_TOO_LARGE' : 'NETWORK'),
      sound: body.sound,
    };
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
}

export const adminUpload = (token: string, file: Blob, label: string, tags: string[]) => {
  const query = new URLSearchParams({ label });
  for (const t of tags) query.append('tag', t);
  return adminCall<LibrarySound>(token, `/v1/sounds?${query}`, { method: 'POST', body: file });
};

export const adminUpdate = (token: string, id: string, patch: LibrarySoundPatch) =>
  adminCall<LibrarySound>(token, `/v1/sounds/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

/** Sets the dialogue's background (the scene without the voices), or removes it with null. */
export const adminSetBackground = (token: string, id: string, file: Blob | null) =>
  adminCall<LibrarySound>(token, `/v1/sounds/${encodeURIComponent(id)}/background`, {
    method: file ? 'PUT' : 'DELETE',
    body: file,
  });

/** Speech to text on the sounds service: `samples` from toTranscriptionInput (transcribe.ts). */
export const adminTranscribe = (
  token: string,
  samples: Float32Array<ArrayBuffer>,
  language: TranscriptLanguage,
) =>
  adminCall<TranscriptWord[]>(token, `/v1/transcribe?language=${language}`, {
    method: 'POST',
    body: samples,
  });

/** Base64 of `bytes` (in chunks: spreading a whole sound into one call overflows the stack). */
function base64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Word timings by forced alignment on the sounds service: when each word of each line's text
 * starts ([] for a line it couldn't align). `samples` from toTranscriptionInput (transcribe.ts).
 */
export const adminAlign = (
  token: string,
  samples: Float32Array,
  language: TranscriptLanguage,
  lines: { startMs: number; endMs: number; text: string }[],
) =>
  adminCall<{ wordStartsMs: number[][] }>(token, '/v1/align', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language,
      samples: base64(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)),
      lines,
    }),
  });

export const adminDelete = (token: string, id: string) =>
  adminCall<{ ok: true }>(token, `/v1/sounds/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** True if the token is accepted. */
export async function adminCheckToken(token: string) {
  return (await adminCall<{ ok: true }>(token, '/v1/admin', { method: 'GET' })).ok;
}

export const LIBRARY_ERROR_TEXT: Record<LibraryErrorCode | 'NETWORK', string> = {
  UNAUTHORIZED: 'Wrong admin token.',
  NOT_FOUND: 'That sound no longer exists.',
  INVALID_PAYLOAD: 'Invalid name or tags.',
  FILE_TOO_LARGE: 'File too large (2 MB max).',
  UNSUPPORTED_FORMAT: 'Not a supported audio file.',
  SOUND_TOO_LONG: 'Too long (20 seconds max).',
  DUPLICATE: 'Already in the library.',
  LENGTH_MISMATCH: 'The background must be as long as the sound itself.',
  TRANSCRIPTION_FAILED: 'The speech recognition failed (see the sounds service logs).',
  RATE_LIMITED: 'Too many attempts from this address: wait a minute.',
  NETWORK: 'The sound library is unreachable.',
};
