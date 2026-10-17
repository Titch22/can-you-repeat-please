import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@cyrp/shared';
import { createApp } from './app.js';

describe('server smoke test', () => {
  const { server, io } = createApp();
  let baseUrl: string;
  let socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    socket = ioClient(baseUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', resolve));
  });

  afterAll(() => {
    socket.disconnect();
    io.close();
  });

  it('answers the health check', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers time:sync with the server time', async () => {
    const ack = await socket.emitWithAck('time:sync', { clientTime: 123 });
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.clientTime).toBe(123);
      expect(Math.abs(ack.serverTime - Date.now())).toBeLessThan(1000);
    }
  });

  it('rejects an invalid time:sync payload', async () => {
    // @ts-expect-error deliberately invalid
    const ack = await socket.emitWithAck('time:sync', { clientTime: 'nope' });
    expect(ack).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });
});
