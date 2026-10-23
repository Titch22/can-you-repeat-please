import { LibrarySoundSchema, toSoundRef, type SoundRef } from '@cyrp/shared';
import { RoomError } from '../rooms/RoomManager.js';

/** Resolves the library sounds a room selected (apps/sounds). */
export interface LibraryClient {
  /**
   * The sounds with these library ids (without the `lib:` prefix), as `lib:`-prefixed
   * SoundRefs. Unknown ids are left out. Throws LIBRARY_UNAVAILABLE if the service can't answer.
   */
  resolve(ids: string[]): Promise<SoundRef[]>;
}

export function createLibraryClient(baseUrl: string, timeoutMs = 5000): LibraryClient {
  return {
    async resolve(ids) {
      if (ids.length === 0) return [];
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/sounds/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return LibrarySoundSchema.array()
          .parse(await res.json())
          .map(toSoundRef);
      } catch (err) {
        console.error('[library] lookup failed', err);
        throw new RoomError('LIBRARY_UNAVAILABLE');
      }
    },
  };
}
