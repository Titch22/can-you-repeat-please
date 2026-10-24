import { LibrarySoundSchema, toSoundRef, type SoundRef } from '@cyrp/shared';
import { signSoundsToken } from '@cyrp/shared/soundsToken';
import { z } from 'zod';
import { RoomError } from '../rooms/RoomManager.js';

/** The sound library service (apps/sounds), as the game uses it. */
export interface LibraryClient {
  /**
   * The sounds with these library ids (without the `lib:` prefix), as `lib:`-prefixed
   * SoundRefs: shared library sounds, and `owners`' own sounds (the accounts sharing theirs).
   * Unknown ids are left out. Throws LIBRARY_UNAVAILABLE if the service can't answer.
   */
  resolve(ids: string[], owners?: number[]): Promise<SoundRef[]>;
  /** An account's own sounds, as `lib:`-prefixed SoundRefs. */
  userSounds(userId: number): Promise<SoundRef[]>;
}

/**
 * A token for the sounds service: `userId`'s (an account), or the game server's own (0, admin).
 * Short-lived: browsers fetch a new one when it runs out.
 */
export const soundsToken = (secret: string, userId: number, admin: boolean, ttlMs = 3600_000) =>
  signSoundsToken({ sub: userId, admin, exp: Date.now() + ttlMs }, secret);

export function createLibraryClient(
  baseUrl: string,
  secret: string,
  timeoutMs = 5000,
): LibraryClient {
  const base = baseUrl.replace(/\/$/, '');
  const call = async <T>(path: string, schema: z.ZodType<T>, token: string, body?: unknown) => {
    try {
      const res = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return schema.parse(await res.json());
    } catch (err) {
      console.error(`[library] ${path} failed`, err);
      throw new RoomError('LIBRARY_UNAVAILABLE');
    }
  };

  return {
    async resolve(ids, owners = []) {
      if (ids.length === 0) return [];
      const sounds = await call(
        '/v1/sounds/lookup',
        LibrarySoundSchema.array(),
        soundsToken(secret, 0, true),
        { ids, owners },
      );
      return sounds.map(toSoundRef);
    },
    async userSounds(userId) {
      const { sounds } = await call(
        '/v1/my/sounds',
        z.object({ sounds: LibrarySoundSchema.array() }),
        soundsToken(secret, userId, false),
      );
      return sounds.map(toSoundRef);
    },
  };
}
