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

    /** Writes `data` as `name` in the room dir and returns its absolute path. */
    async saveFile(code: string, name: string, data: Buffer) {
      if (path.basename(name) !== name) throw new Error(`invalid file name: ${name}`);
      await fs.mkdir(roomDir(code), { recursive: true });
      const file = path.join(roomDir(code), name);
      await fs.writeFile(file, data);
      return file;
    },

    async deleteFile(file: string) {
      await fs.rm(file, { force: true });
    },
  };
}

export type AudioStorage = ReturnType<typeof createAudioStorage>;
