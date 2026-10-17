import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from '@cyrp/shared';
import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrp-test-'));
const storage = createAudioStorage(tmpRoot);
const { server, close } = createApp({ storage });
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
