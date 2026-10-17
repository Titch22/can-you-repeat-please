import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@cyrp/shared';

/** Single shared connection. In dev, Vite proxies /socket.io to the game server. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

/**
 * Estimates serverTime - clientTime by pinging a few times and keeping the median,
 * so countdowns and synced playback use the server clock.
 */
export async function measureClockOffset(samples = 5): Promise<number> {
  const offsets: number[] = [];
  for (let i = 0; i < samples; i++) {
    const sent = Date.now();
    const ack = await socket.emitWithAck('time:sync', { clientTime: sent });
    if (!ack.ok) continue;
    const received = Date.now();
    offsets.push(ack.serverTime - (sent + received) / 2);
  }
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)] ?? 0;
}
