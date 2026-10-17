import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomState, ServerToClientEvents, SoundRef } from '@cyrp/shared';
import { FAST_TIMING } from './game/timing.js';
import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import type { VoiceService } from './voice/livekit.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-test-'));
const storage = createAudioStorage(tmpRoot);
const voice = {
  publicUrl: 'ws://voice.test',
  createToken: vi.fn(async (code: string, who: { identity: string }, canPublish: boolean) =>
    JSON.stringify({ code, identity: who.identity, canPublish }),
  ),
  setPublishAllowed: vi.fn(async () => {}),
  removeParticipant: vi.fn(async () => {}),
  closeRoom: vi.fn(async () => {}),
} satisfies VoiceService;
const sounds: SoundRef[] = [
  { id: 'default:beep', label: 'Beep', durationMs: 1000, url: '/sounds/default/beep.wav' },
];
const { server, close } = createApp({
  storage,
  voice,
  defaultSounds: sounds,
  timing: FAST_TIMING,
  debug: true,
});
let baseUrl: string;
const clients: Client[] = [];

async function connect() {
  const socket: Client = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.on('connect', resolve));
  return socket;
}

/** Resolves with the next room:state matching `predicate`. */
function nextState(socket: Client, predicate: (s: RoomState) => boolean = () => true) {
  return new Promise<RoomState>((resolve) => {
    const listener = (s: RoomState) => {
      if (!predicate(s)) return;
      socket.off('room:state', listener);
      resolve(s);
    };
    socket.on('room:state', listener);
  });
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

afterAll(() => {
  close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('server', () => {
  it('answers the health check', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers time:sync and rejects invalid payloads', async () => {
    const socket = await connect();
    const ack = await socket.emitWithAck('time:sync', { clientTime: 123 });
    expect(ack).toMatchObject({ ok: true, clientTime: 123 });
    // @ts-expect-error deliberately invalid
    const bad = await socket.emitWithAck('time:sync', { clientTime: 'nope' });
    expect(bad).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });
});

describe('rooms over sockets', () => {
  it('creates, joins, and broadcasts state to everyone', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);

    const bob = await connect();
    const aliceSeesBob = nextState(alice, (s) => s.players.length === 2);
    const joined = await bob.emitWithAck('room:join', {
      code: created.code.toLowerCase(),
      nickname: 'Bob',
      color: '#00ff00',
    });
    expect(joined.ok).toBe(true);
    const state = await aliceSeesBob;
    expect(state.players.map((p) => [p.nickname, p.isHost])).toEqual([
      ['Alice', true],
      ['Bob', false],
    ]);
  });

  it('rejects settings changes from non-hosts', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    const bob = await connect();
    await bob.emitWithAck('room:join', { code: created.code, nickname: 'Bob', color: '#00ff00' });

    expect(await bob.emitWithAck('room:updateSettings', { rounds: 3 })).toEqual({
      ok: false,
      error: 'NOT_HOST',
    });
    const bobSeesUpdate = nextState(bob, (s) => s.settings.rounds === 3);
    expect(await alice.emitWithAck('room:updateSettings', { rounds: 3 })).toEqual({ ok: true });
    await bobSeesUpdate;
  });

  it('notifies a kicked player', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    const bob = await connect();
    const joined = await bob.emitWithAck('room:join', {
      code: created.code,
      nickname: 'Bob',
      color: '#00ff00',
    });
    if (!joined.ok) throw new Error(joined.error);

    const kicked = new Promise((resolve) => bob.on('room:kicked', resolve));
    await alice.emitWithAck('room:kick', { playerId: joined.playerId });
    await kicked;
    expect(await bob.emitWithAck('room:updateSettings', { rounds: 3 })).toMatchObject({
      ok: false,
      error: 'ROOM_NOT_FOUND',
    });
  });

  it('resumes a session on a new socket', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    alice.disconnect();

    const again = await connect();
    const state = nextState(again);
    const resumed = await again.emitWithAck('room:resume', {
      code: created.code,
      sessionToken: created.sessionToken,
    });
    expect(resumed).toEqual({ ok: true, playerId: created.playerId });
    expect((await state).players[0]).toMatchObject({ nickname: 'Alice', connected: true });
  });

  it('deletes the room audio dir when the last player leaves', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    const dir = storage.roomDir(created.code);
    await waitFor(() => fs.existsSync(dir));

    await alice.emitWithAck('room:leave', {});
    await waitFor(() => !fs.existsSync(dir));
  });
});

describe('voice', () => {
  async function roomWithTwo() {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    const bob = await connect();
    const joined = await bob.emitWithAck('room:join', {
      code: created.code,
      nickname: 'Bob',
      color: '#00ff00',
    });
    if (!joined.ok) throw new Error(joined.error);
    return { alice, bob, created, joined };
  }

  const tokenRequest = (code: string, sessionToken?: string) =>
    fetch(`${baseUrl}/api/rooms/${code}/voice-token`, {
      method: 'POST',
      headers: sessionToken ? { 'X-Session-Token': sessionToken } : {},
    });

  it('mints a voice token only for players of the room', async () => {
    const { created } = await roomWithTwo();
    expect((await tokenRequest(created.code)).status).toBe(401);
    expect((await tokenRequest(created.code, 'forged')).status).toBe(401);

    const res = await tokenRequest(created.code.toLowerCase(), created.sessionToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; token: string };
    expect(body.url).toBe('ws://voice.test');
    expect(JSON.parse(body.token)).toEqual({
      code: created.code,
      identity: created.playerId,
      canPublish: true,
    });
  });

  it('mutes everyone: clients first, then LiveKit; and mints muted tokens meanwhile', async () => {
    const { alice, bob, created, joined } = await roomWithTwo();
    voice.setPublishAllowed.mockClear();

    expect(await bob.emitWithAck('debug:setVoiceMuted', { muted: true })).toEqual({
      ok: false,
      error: 'NOT_HOST',
    });

    const bobMuted = new Promise((resolve) => bob.on('voice:mute', resolve));
    const bobState = nextState(bob, (s) => s.voiceMuted);
    expect(await alice.emitWithAck('debug:setVoiceMuted', { muted: true })).toEqual({ ok: true });
    expect(await bobMuted).toEqual({ muted: true });
    await bobState;
    expect(voice.setPublishAllowed).toHaveBeenLastCalledWith(created.code, false);

    const res = await tokenRequest(created.code, joined.sessionToken);
    expect(JSON.parse(((await res.json()) as { token: string }).token).canPublish).toBe(false);

    const bobUnmuted = new Promise((resolve) => bob.on('voice:mute', resolve));
    await alice.emitWithAck('debug:setVoiceMuted', { muted: false });
    expect(await bobUnmuted).toEqual({ muted: false });
    expect(voice.setPublishAllowed).toHaveBeenLastCalledWith(created.code, true);
  });

  it('removes kicked players from voice and closes the voice room with the room', async () => {
    const { alice, created, joined } = await roomWithTwo();
    await alice.emitWithAck('room:kick', { playerId: joined.playerId });
    expect(voice.removeParticipant).toHaveBeenCalledWith(created.code, joined.playerId);

    await alice.emitWithAck('room:leave', {});
    expect(voice.closeRoom).toHaveBeenCalledWith(created.code);
  });
});

describe('recordings over HTTP', () => {
  const wav = (bytes = 2000) => {
    const b = Buffer.alloc(44 + bytes);
    b.write('RIFF', 0, 'latin1');
    b.write('WAVE', 8, 'latin1');
    return b;
  };
  const upload = (code: string, round: number, token: string, body: Buffer) =>
    fetch(`${baseUrl}/api/rooms/${code}/rounds/${round}/recording`, {
      method: 'POST',
      headers: { 'X-Session-Token': token, 'Content-Type': 'audio/wav' },
      body: new Uint8Array(body),
    });

  it('accepts one valid recording per player and serves it to room members only', async () => {
    const alice = await connect();
    const created = await alice.emitWithAck('room:create', { nickname: 'Alice', color: '#ff0000' });
    if (!created.ok) throw new Error(created.error);
    const bob = await connect();
    const joined = await bob.emitWithAck('room:join', {
      code: created.code,
      nickname: 'Bob',
      color: '#00ff00',
    });
    if (!joined.ok) throw new Error(joined.error);

    expect((await upload(created.code, 1, created.sessionToken, wav())).status).toBe(409);

    const recording = nextState(alice, (s) => s.phase === 'RECORDING');
    expect(await alice.emitWithAck('game:start', {})).toEqual({ ok: true });
    const state = await recording;

    const bad = await upload(
      created.code,
      1,
      created.sessionToken,
      Buffer.from('<html>nope</html>'),
    );
    expect([bad.status, await bad.json()]).toEqual([
      415,
      { ok: false, error: 'UNSUPPORTED_FORMAT' },
    ]);
    expect((await upload(created.code, 1, created.sessionToken, wav(3_000_000))).status).toBe(413);
    expect((await upload(created.code, 1, 'forged', wav())).status).toBe(401);

    expect((await upload(created.code, 1, created.sessionToken, wav())).status).toBe(200);
    const again = await upload(created.code, 1, created.sessionToken, wav());
    expect([again.status, await again.json()]).toEqual([
      409,
      { ok: false, error: 'ALREADY_SUBMITTED' },
    ]);

    // Bob uploads after the window closed: the last upload starts playback right away.
    await new Promise((r) => setTimeout(r, Math.max(0, state.recording!.endsAt - Date.now() + 50)));
    const playback = nextState(alice, (s) => s.phase === 'PLAYBACK');
    expect((await upload(created.code, 1, joined.sessionToken, wav())).status).toBe(200);
    const { clips, myClipId } = await playback;
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.id)).toContain(myClipId);

    const url = `${baseUrl}${clips[0]!.url}`;
    expect((await fetch(url)).status).toBe(401);
    const res = await fetch(`${url}?t=${joined.sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^audio\/wav/);
    expect((await res.arrayBuffer()).byteLength).toBe(2044);
  }, 15_000);
});
