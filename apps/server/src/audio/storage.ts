import fs from 'node:fs/promises';
import path from 'node:path';

/** Ephemeral per-room audio storage. Nothing here survives the room or a server restart. */
export function createAudioStorage(rootDir: string) {
  const roomDir = (code: string) => path.join(rootDir, code);

  return {
    roomDir,

    /** Called at startup: nothing from a previous run is kept. */
    async wipeAll() {
      await fs.rm(rootDir, { recursive: true, force: true });
      await fs.mkdir(rootDir, { recursive: true });
    },

    async ensureRoom(code: string) {
      await fs.mkdir(roomDir(code), { recursive: true });
    },

    async deleteRoom(code: string) {
      await fs.rm(roomDir(code), { recursive: true, force: true });
    },
  };
}

export type AudioStorage = ReturnType<typeof createAudioStorage>;
