import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomError } from '../rooms/RoomManager.js';
import { createAudioStorage } from './storage.js';

const roots: string[] = [];
const newStorage = (maxBytes: number) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-storage-'));
  roots.push(root);
  return createAudioStorage(root, maxBytes);
};
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const refused = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof RoomError ? e.code : String(e);
  }
  return null;
};

describe('audio storage budget', () => {
  it('refuses files past the budget, and frees space on delete and room close', async () => {
    const storage = newStorage(10);
    const a = await storage.saveFile('ABCD', 'a.wav', Buffer.alloc(6));
    expect(await refused(storage.saveFile('WXYZ', 'b.wav', Buffer.alloc(5)))).toBe('SERVER_FULL');
    expect(storage.usedBytes).toBe(6);

    await storage.deleteFile(a);
    expect(storage.usedBytes).toBe(0);
    await storage.saveFile('ABCD', 'c.wav', Buffer.alloc(4));
    await storage.saveFile('WXYZ', 'd.wav', Buffer.alloc(5));
    expect(storage.usedBytes).toBe(9);

    await storage.deleteRoom('ABCD');
    expect(storage.usedBytes).toBe(5);
    // Overwriting a file only counts the difference.
    await storage.saveFile('WXYZ', 'd.wav', Buffer.alloc(10));
    expect(storage.usedBytes).toBe(10);
  });
});
