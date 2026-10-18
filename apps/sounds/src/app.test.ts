import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibrarySound, TagCount } from '@cyrp/shared';
import { createSoundsApp } from './app.js';
import { importDir } from './importDir.js';
import { Library, slugify } from './library.js';

const TOKEN = 'test-admin-token';

/** A playable mono 16-bit PCM WAV of `seconds`; `pitch` makes otherwise identical files differ. */
function wav(seconds: number, pitch = 440) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * pitch * i) / rate) * 8000), 44 + i * 2);
  }
  return b;
}

let dir: string;
let library: Library;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-sounds-'));
  library = new Library(dir, 'https://sounds.test');
  const app = createSoundsApp({ library, adminToken: TOKEN, clientOrigin: ['http://game.test'] });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  library.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const upload = (body: Buffer, query: string, token = TOKEN) =>
  fetch(`${base}/v1/sounds?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new Uint8Array(body),
  });
const json = async <T>(res: Response) => (await res.json()) as T;
const list = async (query = '') => json<LibrarySound[]>(await fetch(`${base}/v1/sounds?${query}`));

describe('sounds API', () => {
  it('refuses writes without the admin token', async () => {
    expect((await upload(wav(1), 'label=A', 'wrong')).status).toBe(401);
    const noAuth = await fetch(`${base}/v1/sounds?label=A`, {
      method: 'POST',
      body: new Uint8Array(wav(1)),
    });
    expect(noAuth.status).toBe(401);
    expect((await fetch(`${base}/v1/sounds/x`, { method: 'DELETE' })).status).toBe(401);
    const check = (token: string) =>
      fetch(`${base}/v1/admin`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await check('wrong')).status).toBe(401);
    expect((await check(TOKEN)).status).toBe(200);
    expect(await list()).toEqual([]);
  });

  it('uploads, then filters by any tag, duration and label', async () => {
    const goat = await json<LibrarySound>(
      await upload(wav(1, 300), 'label=Screaming%20goat&tag=animal&tag=Meme'),
    );
    expect(goat).toEqual({
      id: 'screaming-goat',
      label: 'Screaming goat',
      durationMs: 1000,
      tags: ['animal', 'meme'],
      lines: [],
      url: expect.stringMatching(/^https:\/\/sounds\.test\/files\/[0-9a-f]{64}\.wav$/),
    });
    await upload(wav(3, 400), 'label=Long%20moo&tag=animal');
    await upload(wav(0.5, 500), 'label=Bruh&tag=meme,classic');

    const labels = (sounds: LibrarySound[]) => sounds.map((s) => s.label);
    expect(labels(await list())).toEqual(['Bruh', 'Long moo', 'Screaming goat']);
    expect(labels(await list('tag=classic'))).toEqual(['Bruh']);
    expect(labels(await list('tag=classic&tag=animal'))).toEqual([
      'Bruh',
      'Long moo',
      'Screaming goat',
    ]);
    expect(labels(await list('tag=animal&maxMs=2000'))).toEqual(['Screaming goat']);
    expect(labels(await list('minMs=2000'))).toEqual(['Long moo']);
    expect(labels(await list('q=MOO'))).toEqual(['Long moo']);
    expect(labels(await list('q=%25'))).toEqual([]);
    expect((await fetch(`${base}/v1/sounds?minMs=abc`)).status).toBe(400);

    expect(await json<TagCount[]>(await fetch(`${base}/v1/tags`))).toEqual([
      { name: 'animal', count: 2 },
      { name: 'classic', count: 1 },
      { name: 'meme', count: 2 },
    ]);
  });

  it('serves files with immutable caching and CORS', async () => {
    const sound = await json<LibrarySound>(await upload(wav(1), 'label=A'));
    const file = await fetch(`${base}${new URL(sound.url).pathname}`, {
      headers: { Origin: 'http://game.test' },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(file.headers.get('access-control-allow-origin')).toBe('http://game.test');
    expect(Buffer.from(await file.arrayBuffer()).equals(wav(1))).toBe(true);
    expect((await fetch(`${base}/files/../library.db`)).status).toBe(404);
  });

  it('validates uploads like room uploads', async () => {
    const err = async (res: Response) => [res.status, (await json<{ error: string }>(res)).error];
    expect(await err(await upload(Buffer.from('not audio at all'), 'label=A'))).toEqual([
      415,
      'UNSUPPORTED_FORMAT',
    ]);
    expect(await err(await upload(wav(21), 'label=A'))).toEqual([422, 'SOUND_TOO_LONG']);
    expect(await err(await upload(wav(1), 'label='))).toEqual([400, 'INVALID_PAYLOAD']);
    expect(await err(await upload(wav(1), 'label=A&tag=no%2Fslash'))).toEqual([
      400,
      'INVALID_PAYLOAD',
    ]);
  });

  it('detects duplicates by content and keeps ids unique', async () => {
    const first = await json<LibrarySound>(await upload(wav(1), 'label=Same'));
    const again = await upload(wav(1), 'label=Other');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: 'DUPLICATE', sound: first });

    const second = await json<LibrarySound>(await upload(wav(1, 600), 'label=Same'));
    expect(second.id).toMatch(/^same-[0-9a-f]{6}$/);
  });

  it('edits labels and tags, looks up by ids, and deletes with the file', async () => {
    const a = await json<LibrarySound>(await upload(wav(1), 'label=A&tag=old'));
    const edit = await fetch(`${base}/v1/sounds/${a.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Renamed', tags: ['new', 'other'] }),
    });
    expect(await edit.json()).toMatchObject({ id: 'a', label: 'Renamed', tags: ['new', 'other'] });

    const setLines = (lines: unknown) =>
      fetch(`${base}/v1/sounds/${a.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
    const lines = [
      { startMs: 0, endMs: 400, speaker: 'A' },
      { startMs: 400, endMs: 1000, speaker: 'B' },
    ];
    expect(await (await setLines(lines)).json()).toMatchObject({ id: 'a', lines });
    // Overlapping, too short, or past the end of the 1s sound.
    for (const bad of [
      [lines[1], lines[0]],
      [{ startMs: 0, endMs: 100, speaker: 'A' }],
      [{ startMs: 500, endMs: 1500, speaker: 'B' }],
      [{ startMs: 0, endMs: 500, speaker: 'C' }],
    ]) {
      expect((await setLines(bad)).status).toBe(400);
    }

    const lookup = await fetch(`${base}/v1/sounds/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['a', 'gone'] }),
    });
    expect(await json<LibrarySound[]>(lookup)).toMatchObject([{ id: 'a', lines }]);

    const files = () => fs.readdirSync(path.join(dir, 'files'));
    expect(files()).toHaveLength(1);
    const del = () =>
      fetch(`${base}/v1/sounds/a`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
    expect(files()).toEqual([]);
    expect(await json<TagCount[]>(await fetch(`${base}/v1/tags`))).toEqual([]);
  });
});

describe('importDir', () => {
  it('imports a folder with its manifest ids, skipping duplicates and bad files', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-seed-'));
    fs.writeFileSync(path.join(src, 'goat.wav'), wav(1, 300));
    fs.writeFileSync(path.join(src, 'copy.wav'), wav(1, 300));
    fs.writeFileSync(path.join(src, 'broken.mp3'), 'nope');
    fs.writeFileSync(
      path.join(src, 'manifest.json'),
      JSON.stringify({
        sounds: [
          { id: 'the-goat', file: 'goat.wav', label: 'The goat' },
          { id: 'copy', file: 'copy.wav', label: 'Copy' },
          { id: 'broken', file: 'broken.mp3', label: 'Broken' },
        ],
      }),
    );
    const report = await importDir(library, src, ['meme']);
    expect(report).toEqual({
      added: ['the-goat'],
      skipped: [
        { file: 'copy.wav', reason: 'DUPLICATE' },
        { file: 'broken.mp3', reason: 'UNSUPPORTED_FORMAT' },
      ],
    });
    expect(library.get('the-goat')).toMatchObject({ label: 'The goat', tags: ['meme'] });
    fs.rmSync(src, { recursive: true, force: true });
  });
});

describe('slugify', () => {
  it('makes readable ids', () => {
    expect(slugify('Screaming Goat!')).toBe('screaming-goat');
    expect(slugify('Zoé – Cha-ching')).toBe('zoe-cha-ching');
    expect(slugify('!!!')).toBe('');
  });
});
