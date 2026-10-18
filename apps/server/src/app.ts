import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { AudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { GameRunner } from './game/GameRunner.js';
import type { Timing } from './game/timing.js';
import { RoomManager, type Room } from './rooms/RoomManager.js';
import { audioRoutes } from './routes/audio.js';
import type { LibraryClient } from './sounds/library.js';
import { voiceRoutes } from './routes/voice.js';
import { registerRoomHandlers, type GameServer } from './sockets/roomHandlers.js';
import type { VoiceService } from './voice/livekit.js';

export interface AppDeps {
  storage: AudioStorage;
  voice: VoiceService;
  library: LibraryClient;
  timing: Timing;
  debug?: boolean;
}

export function createApp({ storage, voice, library, timing, debug = config.debug }: AppDeps) {
  const app = express();
  // Behind one reverse proxy (nginx) in production: trust its X-Forwarded-* headers.
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

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

  const rooms = new RoomManager(
    {
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
      onPresenceChanged: (room) => game.onPresenceChanged(room),
      onClosed: (room) => {
        game.stop(room.code);
        for (const p of room.players) {
          if (p.socketId) io.to(p.socketId).emit('room:closed');
          detach(p.socketId);
        }
        void voice.closeRoom(room.code);
        storage
          .deleteRoom(room.code)
          .catch((err) => console.error('[storage] cleanup failed', err));
      },
    },
    Date.now,
  );

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
      if (rooms.get(code)) notify(rooms.setVoiceMuted(code, false));
    }
  };

  const game = new GameRunner({
    rooms,
    timing,
    library,
    setVoiceMuted,
    discardRecordings: (room) => {
      for (const [id, file] of room.files) {
        if (file.kind !== 'recording') continue;
        room.files.delete(id);
        storage.deleteFile(file.path).catch((err) => console.error('[storage] delete failed', err));
      }
    },
  });

  app.use(voiceRoutes(rooms, voice));
  app.use(audioRoutes(rooms, game, storage));
  const deleteSound = (code: string, playerId: string, soundId: string) => {
    const sound = rooms.removeCustomSound(code, playerId, soundId);
    const room = rooms.getOrThrow(code);
    const file = room.files.get(sound.id);
    room.files.delete(sound.id);
    if (file)
      storage.deleteFile(file.path).catch((err) => console.error('[storage] delete failed', err));
  };

  registerRoomHandlers(io, rooms, { game, setVoiceMuted, deleteSound, debug });
  serveWebApp(app);

  const sweep = setInterval(() => rooms.sweepIdle(), 60_000);
  sweep.unref();

  const close = () => {
    clearInterval(sweep);
    rooms.closeAll();
    io.close();
  };

  return { app, server, io, rooms, game, close, setVoiceMuted };
}

/**
 * Serves the built web app, if there is one (production). Client-side routes like /r/ABCD
 * get index.html; unknown /api paths still 404.
 */
function serveWebApp(app: express.Express) {
  const dist = config.paths.webDist;
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) return;
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
