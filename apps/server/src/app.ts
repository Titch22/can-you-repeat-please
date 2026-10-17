import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  TimeSyncPayload,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@cyrp/shared';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/sounds/default', express.static(config.paths.defaultSounds));

  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: config.clientOrigin },
  });

  io.on('connection', (socket) => {
    socket.on('time:sync', (payload, cb) => {
      const parsed = TimeSyncPayload.safeParse(payload);
      if (!parsed.success) return cb({ ok: false, error: 'INVALID_PAYLOAD' });
      cb({ ok: true, clientTime: parsed.data.clientTime, serverTime: Date.now() });
    });
  });

  return { app, server, io };
}
