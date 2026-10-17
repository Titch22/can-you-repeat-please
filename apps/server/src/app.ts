import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { AudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { RoomManager, type Room } from './rooms/RoomManager.js';
import { voiceRoutes } from './routes/voice.js';
import { registerRoomHandlers, type GameServer } from './sockets/roomHandlers.js';
import type { VoiceService } from './voice/livekit.js';

export interface AppDeps {
  storage: AudioStorage;
  voice: VoiceService;
  debug?: boolean;
}

export function createApp({ storage, voice, debug = config.debug }: AppDeps) {
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
    onPlayerRemoved: (room, player, reason) => {
      if (reason === 'kicked' && player.socketId) {
        io.to(player.socketId).emit('room:kicked', { reason: 'You were kicked by the host.' });
      }
      detach(player.socketId);
      // Their voice token stays valid until it expires: cut them off from voice explicitly.
      void voice.removeParticipant(room.code, player.id);
    },
    onClosed: (room) => {
      for (const p of room.players) {
        if (p.socketId) io.to(p.socketId).emit('room:closed');
        detach(p.socketId);
      }
      void voice.closeRoom(room.code);
      storage.deleteRoom(room.code).catch((err) => console.error('[storage] cleanup failed', err));
    },
  });

  /**
   * Game-wide voice mute (recording phase). Muting tells clients first so they go quiet
   * instantly, then revokes publishing in LiveKit as enforcement. Unmuting restores
   * permissions first, so clients can republish their mic as soon as they hear about it.
   */
  const setVoiceMuted = async (code: string, muted: boolean) => {
    const notify = (room: Room) => {
      for (const p of room.players) {
        if (p.socketId) io.to(p.socketId).emit('voice:mute', { muted });
      }
    };
    if (muted) {
      notify(rooms.setVoiceMuted(code, true));
      await voice.setPublishAllowed(code, false);
    } else {
      await voice.setPublishAllowed(code, true);
      notify(rooms.setVoiceMuted(code, false));
    }
  };

  app.use(voiceRoutes(rooms, voice));
  registerRoomHandlers(io, rooms, { setVoiceMuted, debug });

  const sweep = setInterval(() => rooms.sweepIdle(), 60_000);
  sweep.unref();

  const close = () => {
    clearInterval(sweep);
    rooms.closeAll();
    io.close();
  };

  return { app, server, io, rooms, close, setVoiceMuted };
}
