import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { Router, type ErrorRequestHandler } from 'express';
import {
  MAX_CUSTOM_SOUND_MS,
  MAX_UPLOAD_BYTES,
  MIN_CUSTOM_SOUND_MS,
  SoundLabelSchema,
} from '@cyrp/shared';
import { measureDurationMs, sniffAudio } from '../audio/formats.js';
import type { AudioStorage } from '../audio/storage.js';
import type { GameRunner } from '../game/GameRunner.js';
import { clipUrl } from '../game/state.js';
import { RoomError, type RoomManager } from '../rooms/RoomManager.js';
import { requireSession, type SessionLocals } from './auth.js';

const STATUS: Partial<Record<string, number>> = {
  WRONG_PHASE: 409,
  ALREADY_SUBMITTED: 409,
  TOO_MANY_SOUNDS: 409,
  SOUND_TOO_LONG: 422,
  SPECTATOR: 403,
  UNSUPPORTED_FORMAT: 415,
  FILE_TOO_LARGE: 413,
};

export function audioRoutes(rooms: RoomManager, game: GameRunner, storage: AudioStorage) {
  const router = Router();

  // The body is the raw audio blob (Content-Type is ignored: the bytes are sniffed instead).
  router.post(
    '/api/rooms/:code/rounds/:round/recording',
    requireSession(rooms),
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const { room, player } = res.locals as SessionLocals;
      const format = Buffer.isBuffer(req.body) ? sniffAudio(req.body) : null;
      if (!format) throw new RoomError('UNSUPPORTED_FORMAT');

      const release = game.beginUpload(room, player.id, Number(req.params.round));
      const fileId = randomUUID();
      let file: string;
      try {
        file = await storage.saveFile(
          room.code,
          `rec-${req.params.round}-${player.id}.${format.ext}`,
          req.body,
        );
      } catch (err) {
        release();
        throw err;
      }
      room.files.set(fileId, { path: file, mime: format.mime, kind: 'recording' });
      if (!game.finishUpload(room, player.id, fileId)) {
        room.files.delete(fileId);
        await storage.deleteFile(file);
        throw new RoomError('WRONG_PHASE');
      }
      res.json({ ok: true });
    },
  );

  // Custom sound for the room (lobby only). Raw body; ?label=<name shown in the lobby>.
  // Kept as a temp file until it is deleted or the room closes.
  router.post(
    '/api/rooms/:code/sounds',
    requireSession(rooms),
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const { room, player } = res.locals as SessionLocals;
      rooms.assertCanAddSound(room);
      const label = SoundLabelSchema.safeParse(req.query.label);
      if (!label.success) throw new RoomError('INVALID_PAYLOAD');
      const format = Buffer.isBuffer(req.body) ? sniffAudio(req.body) : null;
      if (!format) throw new RoomError('UNSUPPORTED_FORMAT');
      const durationMs = await measureDurationMs(req.body, format.mime);
      if (durationMs === null) throw new RoomError('UNSUPPORTED_FORMAT');
      if (durationMs > MAX_CUSTOM_SOUND_MS) throw new RoomError('SOUND_TOO_LONG');
      if (durationMs < MIN_CUSTOM_SOUND_MS) throw new RoomError('INVALID_PAYLOAD');

      const fileId = randomUUID();
      const file = await storage.saveFile(room.code, `snd-${fileId}.${format.ext}`, req.body);
      const sound = {
        id: fileId,
        label: label.data,
        durationMs,
        url: clipUrl(room.code, fileId),
        uploadedBy: player.id,
      };
      try {
        room.files.set(fileId, { path: file, mime: format.mime, kind: 'sound' });
        rooms.addCustomSound(room, sound); // re-checks phase and cap (concurrent uploads)
      } catch (err) {
        room.files.delete(fileId);
        await storage.deleteFile(file);
        throw err;
      }
      res.json(sound);
    },
  );

  router.get('/api/rooms/:code/audio/:fileId', requireSession(rooms), (req, res) => {
    const { room } = res.locals as SessionLocals;
    const stored = room.files.get(req.params.fileId ?? '');
    if (!stored) {
      res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    res.type(stored.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // ?download=<name>: save as "<name>.<ext>" instead of playing inline.
    if (typeof req.query.download === 'string') {
      res.attachment(`${safeFileName(req.query.download)}${path.extname(stored.path)}`);
    }
    res.sendFile(stored.path);
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof RoomError) {
      res.status(STATUS[err.code] ?? 400).json({ ok: false, error: err.code });
    } else if (err?.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
    } else {
      next(err);
    }
  };
  router.use(onError);

  return router;
}

/** A client-suggested file name, made safe for every OS (the extension is added separately). */
export function safeFileName(name: string) {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return cleaned || 'recording';
}
