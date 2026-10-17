import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  KickPayload,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomResumePayload,
  SetVoiceMutedPayload,
  TimeSyncPayload,
  UpdateSettingsPayload,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@cyrp/shared';
import { RoomError, type RoomManager } from '../rooms/RoomManager.js';

export interface SocketData {
  code?: string;
  playerId?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const Empty = z.object({});

/** Validates the payload, runs `fn`, and turns its result or RoomError into an ack. */
function handler<S extends z.ZodType, R extends object>(
  schema: S,
  fn: (data: z.infer<S>) => R | void | Promise<R | void>,
) {
  return async (payload: unknown, cb: (ack: Ack<R>) => void) => {
    if (typeof cb !== 'function') return;
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) return cb({ ok: false, error: 'INVALID_PAYLOAD' });
    try {
      cb({ ok: true, ...((await fn(parsed.data)) ?? {}) } as Ack<R>);
    } catch (err) {
      if (err instanceof RoomError) return cb({ ok: false, error: err.code });
      console.error('[socket] handler failed', err);
      cb({ ok: false, error: 'INTERNAL' });
    }
  };
}

export interface HandlerDeps {
  setVoiceMuted(code: string, muted: boolean): Promise<void>;
  /** Registers debug-only events. */
  debug: boolean;
}

export function registerRoomHandlers(io: GameServer, rooms: RoomManager, deps: HandlerDeps) {
  io.on('connection', (socket: GameSocket) => {
    const membership = () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) throw new RoomError('ROOM_NOT_FOUND');
      return { code, playerId };
    };

    /** A socket is in at most one room: leave the previous one before entering another. */
    const leaveCurrent = () => {
      const { code, playerId } = socket.data;
      socket.data = {};
      if (code && playerId && rooms.get(code)) rooms.leave(code, playerId);
    };

    socket.on(
      'room:create',
      handler(RoomCreatePayload, ({ nickname, color }) => {
        leaveCurrent();
        const { room, player } = rooms.create(nickname, color, socket.id);
        socket.data = { code: room.code, playerId: player.id };
        return { code: room.code, playerId: player.id, sessionToken: player.sessionToken };
      }),
    );

    socket.on(
      'room:join',
      handler(RoomJoinPayload, ({ code, nickname, color }) => {
        if (socket.data.code !== code) leaveCurrent();
        const { player } = rooms.join(code, nickname, color, socket.id);
        socket.data = { code, playerId: player.id };
        return { playerId: player.id, sessionToken: player.sessionToken };
      }),
    );

    socket.on(
      'room:resume',
      handler(RoomResumePayload, ({ code, sessionToken }) => {
        if (socket.data.code !== code) leaveCurrent();
        const { player } = rooms.resume(code, sessionToken, socket.id);
        socket.data = { code, playerId: player.id };
        return { playerId: player.id };
      }),
    );

    socket.on(
      'room:leave',
      handler(Empty, () => {
        membership();
        leaveCurrent();
      }),
    );

    socket.on(
      'room:updateSettings',
      handler(UpdateSettingsPayload, (patch) => {
        const { code, playerId } = membership();
        rooms.updateSettings(code, playerId, patch);
      }),
    );

    socket.on(
      'room:kick',
      handler(KickPayload, ({ playerId: targetId }) => {
        const { code, playerId } = membership();
        rooms.kick(code, playerId, targetId);
      }),
    );

    if (deps.debug) {
      socket.on(
        'debug:setVoiceMuted',
        handler(SetVoiceMutedPayload, async ({ muted }) => {
          const { code, playerId } = membership();
          rooms.requireHost(code, playerId);
          await deps.setVoiceMuted(code, muted);
        }),
      );
    }

    socket.on(
      'time:sync',
      handler(TimeSyncPayload, ({ clientTime }) => ({ clientTime, serverTime: Date.now() })),
    );

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (code && playerId) rooms.disconnect(code, playerId, socket.id);
    });
  });
}
