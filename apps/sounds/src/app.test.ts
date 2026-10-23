import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RateLimiter,
  type LibrarySound,
  type TagCount,
  type TranscriptLanguage,
} from '@cyrp/shared';
import { createSoundsApp } from './app.js';
import { importDir } from './importDir.js';
import { Library, slugify } from './library.js';
import { toWords } from './transcribe.js';

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
let limits: { failedAuth: RateLimiter; upload: RateLimiter };
const align = vi.fn(async (_samples: Float32Array, _language: TranscriptLanguage, lines) =>
  (lines as { startMs: number }[]).map((l) => [l.startMs]),
);
const transcribe = vi.fn(async (samples: Float32Array, _language: TranscriptLanguage) => [
  { text: `${samples.length} samples`, startMs: 0, endMs: 100 },
]);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-sounds-'));
  library = new Library(dir, 'https://sounds.test');
  limits = { failedAuth: new RateLimiter(5, 60_000), upload: new RateLimiter(1000, 1) };
  const app = createSoundsApp({
    library,
    adminToken: TOKEN,
    clientOrigin: ['http://game.test'],
    transcribe,
    align,
    limits,
  });
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
  it('locks an address out after repeated wrong tokens', async () => {
    const check = (token: string) =>
      fetch(`${base}/v1/admin`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await check(TOKEN)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await check('nope')).status).toBe(401);
    // Even the right token is refused from that address for a while.
    expect((await check(TOKEN)).status).toBe(429);
  });

  it('sends security headers and keeps the health check minimal', async () => {
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

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
    expect(await (await check(TOKEN)).json()).toEqual({ ok: true, sounds: 0 });
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
      backgroundUrl: null,
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
    expect(labels(await list('limit=2'))).toEqual(['Bruh', 'Long moo']);
    expect((await fetch(`${base}/v1/sounds?limit=5000`)).status).toBe(400);
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
      {
        startMs: 0,
        endMs: 400,
        speaker: 'A',
        text: 'You talking to me?',
        wordStartsMs: [0, 100, 200, 250],
      },
      { startMs: 400, endMs: 1000, speaker: 'B', text: '', wordStartsMs: [] },
    ];
    expect(await (await setLines(lines)).json()).toMatchObject({ id: 'a', lines });
    // Text and word timings are optional in the payload (stored as '' and []).
    const withoutText = [lines[0], { startMs: 400, endMs: 1000, speaker: 'B' }];
    expect(await (await setLines(withoutText)).json()).toMatchObject({ lines });
    // Overlapping, too short, or past the end of the 1s sound.
    for (const bad of [
      [lines[1], lines[0]],
      [{ startMs: 0, endMs: 100, speaker: 'A' }],
      [{ startMs: 500, endMs: 1500, speaker: 'B' }],
      [{ startMs: 0, endMs: 500, speaker: 'C' }],
      // Word timings: not one per word, out of order, outside the line.
      [{ startMs: 0, endMs: 500, speaker: 'A', text: 'two words', wordStartsMs: [0] }],
      [{ startMs: 0, endMs: 500, speaker: 'A', text: 'two words', wordStartsMs: [200, 100] }],
      [{ startMs: 0, endMs: 500, speaker: 'A', text: 'two words', wordStartsMs: [0, 500] }],
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

  it('sets, replaces and removes a dialogue background, keeping files still in use', async () => {
    const scene = await json<LibrarySound>(await upload(wav(2, 500), 'label=Scene'));
    const other = await json<LibrarySound>(await upload(wav(2, 600), 'label=Other'));
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const put = (id: string, body: Buffer) =>
      fetch(`${base}/v1/sounds/${id}/background`, {
        method: 'PUT',
        headers: auth,
        body: new Uint8Array(body),
      });
    const files = () => fs.readdirSync(path.join(dir, 'files')).length;

    expect(scene.backgroundUrl).toBeNull();
    expect((await put(scene.id, wav(1, 700))).status).toBe(422); // not as long as the scene
    expect((await put('missing', wav(2, 700))).status).toBe(404);
    const withBackground = await json<LibrarySound>(await put(scene.id, wav(2, 700)));
    expect(withBackground.backgroundUrl).toMatch(
      /^https:\/\/sounds\.test\/files\/[0-9a-f]{64}\.wav$/,
    );
    expect(files()).toBe(3);

    // Replaced by the same audio as "Other": the first background goes, the file is shared.
    const shared = await json<LibrarySound>(await put(scene.id, wav(2, 600)));
    expect(shared.backgroundUrl).toBe(other.url);
    expect(files()).toBe(2);
    // Removing the background keeps the file: "Other" still uses it.
    const removed = await fetch(`${base}/v1/sounds/${scene.id}/background`, {
      method: 'DELETE',
      headers: auth,
    });
    expect((await json<LibrarySound>(removed)).backgroundUrl).toBeNull();
    expect(files()).toBe(2);

    // Deleting a sound deletes its background too.
    await put(scene.id, wav(2, 700));
    expect(files()).toBe(3);
    await fetch(`${base}/v1/sounds/${scene.id}`, { method: 'DELETE', headers: auth });
    expect(files()).toBe(1);
  });
});

describe('transcription', () => {
  const post = (body: Uint8Array<ArrayBuffer>, query = 'language=french', token = TOKEN) =>
    fetch(`${base}/v1/transcribe?${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  const samples = (n: number) => new Uint8Array(new Float32Array(n).fill(0.25).buffer);

  it('hands the samples and the language to the speech recognition', async () => {
    transcribe.mockClear();
    const res = await post(samples(16_000));
    expect(await res.json()).toEqual([{ text: '16000 samples', startMs: 0, endMs: 100 }]);
    const [received, language] = transcribe.mock.calls[0]!;
    expect(language).toBe('french');
    expect(received[0]).toBe(0.25);
  });

  it('refuses bad input, and reports a failed recognition', async () => {
    expect((await post(samples(10), 'language=german')).status).toBe(400);
    expect((await post(new Uint8Array(7))).status).toBe(400); // not whole float32s
    expect((await post(samples(10), 'language=french', 'wrong')).status).toBe(401);
    transcribe.mockRejectedValueOnce(new Error('model download failed'));
    const failed = await post(samples(10));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, error: 'TRANSCRIPTION_FAILED' });
  });

  it('glues word pieces: French elisions and hyphens', () => {
    expect(
      toWords([
        { text: ' Mais', timestamp: [11.68, 11.8] },
        { text: ' c', timestamp: [12.1, 12.1] },
        { text: " 'est", timestamp: [12.1, 12.32] },
        { text: ' go', timestamp: [12.4, 12.5] },
        { text: '-wat?', timestamp: [12.5, null] },
      ]),
    ).toEqual([
      { text: 'Mais', startMs: 11680, endMs: 11800 },
      { text: "c'est", startMs: 12100, endMs: 12320 },
      { text: 'go-wat?', startMs: 12400, endMs: 12500 },
    ]);
  });
});

describe('alignment', () => {
  const post = (body: unknown, token = TOKEN) =>
    fetch(`${base}/v1/align`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const samples = Buffer.from(new Float32Array(16_000).fill(0.5).buffer).toString('base64');
  const lines = [
    { startMs: 0, endMs: 500, text: 'Ça va ?' },
    { startMs: 600, endMs: 900, text: 'Oui.' },
  ];

  it('hands the decoded samples, the language and the lines to the aligner', async () => {
    align.mockClear();
    const res = await post({ language: 'french', samples, lines });
    expect(await res.json()).toEqual({ wordStartsMs: [[0], [600]] });
    const [received, language, sent] = align.mock.calls[0]!;
    expect([received.length, received[0], language, sent]).toEqual([16_000, 0.5, 'french', lines]);
  });

  it('refuses bad input, and reports a failed alignment', async () => {
    expect((await post({ language: 'french', samples, lines }, 'wrong')).status).toBe(401);
    expect((await post({ language: 'german', samples, lines })).status).toBe(400);
    expect((await post({ language: 'french', samples: 'not base64!', lines })).status).toBe(400);
    expect((await post({ language: 'french', samples: 'AAA=', lines })).status).toBe(400); // 2 bytes
    align.mockRejectedValueOnce(new Error('model download failed'));
    expect((await post({ language: 'french', samples, lines })).status).toBe(503);
  });
});

describe('Library', () => {
  it('upgrades a database made before line texts and backgrounds', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-old-'));
    const db = new DatabaseSync(path.join(old, 'library.db'));
    db.exec(`
      CREATE TABLE sounds (id TEXT PRIMARY KEY, label TEXT NOT NULL, duration_ms INTEGER NOT NULL,
        file TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sound_lines (sound_id TEXT NOT NULL, idx INTEGER NOT NULL,
        start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, speaker TEXT NOT NULL,
        PRIMARY KEY (sound_id, idx));
      INSERT INTO sounds VALUES ('a', 'A', 1000, 'abc.wav', 'audio/wav', 10, 0);
      INSERT INTO sound_lines VALUES ('a', 0, 0, 500, 'A');
    `);
    db.close();
    const upgraded = new Library(old, 'https://sounds.test');
    expect(upgraded.get('a')).toMatchObject({
      backgroundUrl: null,
      lines: [{ startMs: 0, endMs: 500, speaker: 'A', text: '', wordStartsMs: [] }],
    });
    upgraded.close();
    fs.rmSync(old, { recursive: true, force: true });
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
