import type { RequestHandler } from 'express';
import type { Room, RoomManager, ServerPlayer } from '../rooms/RoomManager.js';

export interface SessionLocals {
  room: Room;
  player: ServerPlayer;
}

/**
 * Guards /api/rooms/:code/* routes: the caller must hold a seat in that room.
 * The token comes from the X-Session-Token header, or `?t=` for <audio src> URLs.
 */
export function requireSession(
  rooms: RoomManager,
): RequestHandler<{ code: string } & Record<string, string>> {
  return (req, res, next) => {
    const token =
      req.get('X-Session-Token') ?? (typeof req.query.t === 'string' ? req.query.t : '');
    const auth = rooms.findBySession(req.params.code.toUpperCase(), token);
    if (!auth) {
      res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
      return;
    }
    Object.assign(res.locals, auth satisfies SessionLocals);
    next();
  };
}
