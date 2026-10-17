import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { AudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { RoomManager, type Room } from './rooms/RoomManager.js';
import { registerRoomHandlers, type GameServer } from './sockets/roomHandlers.js';

export interface AppDeps {
  storage: AudioStorage;
}

export function createApp({ storage }: AppDeps) {
  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/sounds/default', express.static(config.paths.defaultSounds));

  const server = http.createServer(app);
  const io: GameServer = new Server(server, {
    cors: { origin: config.clientOrigin },
  });

  /** Forgets a socket's room membership so its later disconnect doesn't touch the room. */
  const detach = (socketId: string | null) => {
    const socket = socketId ? io.sockets.sockets.get(socketId) : undefined;
    if (socket) socket.data = {};
  };

  const broadcast = (room: Room) => {
    for (const p of room.players) {
      if (p.socketId) io.to(p.socketId).emit('room:state', rooms.toState(room, p.id));
    }
  };

  const rooms = new RoomManager({
    onCreated: (room) => {
      storage.ensureRoom(room.code).catch((err) => console.error('[storage] mkdir failed', err));
    },
    onChanged: broadcast,
    onPlayerRemoved: (_room, player, reason) => {
      if (reason === 'kicked' && player.socketId) {
        io.to(player.socketId).emit('room:kicked', { reason: 'You were kicked by the host.' });
      }
      detach(player.socketId);
    },
    onClosed: (room) => {
      for (const p of room.players) {
        if (p.socketId) io.to(p.socketId).emit('room:closed');
        detach(p.socketId);
      }
      storage.deleteRoom(room.code).catch((err) => console.error('[storage] cleanup failed', err));
    },
  });

  registerRoomHandlers(io, rooms);

  const sweep = setInterval(() => rooms.sweepIdle(), 60_000);
  sweep.unref();

  const close = () => {
    clearInterval(sweep);
    rooms.closeAll();
    io.close();
  };

  return { app, server, io, rooms, close };
}
