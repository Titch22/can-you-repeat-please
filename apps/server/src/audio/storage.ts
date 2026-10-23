import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_TMP_BYTES } from '@cyrp/shared';
import { RoomError } from '../rooms/RoomManager.js';

/**
 * Ephemeral per-room audio storage. Nothing here survives the room or a server restart.
 * The total size of all rooms' files is capped (`maxBytes`), so no one can fill the disk.
 */
export function createAudioStorage(rootDir: string, maxBytes = MAX_TMP_BYTES) {
  const roomDir = (code: string) => path.join(rootDir, code);
  /** Size of every stored file, by absolute path. */
  const sizes = new Map<string, number>();
  let used = 0;
  const forget = (file: string) => {
    used -= sizes.get(file) ?? 0;
    sizes.delete(file);
  };

  return {
    roomDir,

    /** Bytes currently stored, all rooms together. */
    get usedBytes() {
      return used;
    },

    /** Called at startup: nothing from a previous run is kept. */
    async wipeAll() {
      await fs.rm(rootDir, { recursive: true, force: true });
      await fs.mkdir(rootDir, { recursive: true });
      sizes.clear();
      used = 0;
    },

    async ensureRoom(code: string) {
      await fs.mkdir(roomDir(code), { recursive: true });
    },

    async deleteRoom(code: string) {
      const dir = roomDir(code) + path.sep;
      for (const file of [...sizes.keys()]) if (file.startsWith(dir)) forget(file);
      await fs.rm(roomDir(code), { recursive: true, force: true });
    },

    /**
     * Writes `data` as `name` in the room dir and returns its absolute path. Throws
     * SERVER_FULL when the server's audio budget is used up.
     */
    async saveFile(code: string, name: string, data: Buffer) {
      if (path.basename(name) !== name) throw new Error(`invalid file name: ${name}`);
      const file = path.join(roomDir(code), name);
      const previous = sizes.get(file) ?? 0;
      if (used - previous + data.length > maxBytes) throw new RoomError('SERVER_FULL');
      // Reserve before writing: concurrent uploads must see each other's bytes.
      used += data.length - previous;
      sizes.set(file, data.length);
      try {
        await fs.mkdir(roomDir(code), { recursive: true });
        await fs.writeFile(file, data);
      } catch (err) {
        forget(file);
        throw err;
      }
      return file;
    },

    async deleteFile(file: string) {
      forget(file);
      await fs.rm(file, { force: true });
    },
  };
}

export type AudioStorage = ReturnType<typeof createAudioStorage>;
