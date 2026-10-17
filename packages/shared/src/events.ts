import type { z } from 'zod';
import type {
  DeleteSoundPayload,
  KickPayload,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomResumePayload,
  TimeSyncPayload,
  UpdateSettingsPayload,
  VotePayload,
} from './schemas.js';
import type { Ack, RoomState } from './types.js';

type Cb<T = object> = (ack: Ack<T>) => void;

export interface ClientToServerEvents {
  'room:create': (
    p: z.infer<typeof RoomCreatePayload>,
    cb: Cb<{ code: string; playerId: string; sessionToken: string }>,
  ) => void;
  'room:join': (
    p: z.infer<typeof RoomJoinPayload>,
    cb: Cb<{ playerId: string; sessionToken: string }>,
  ) => void;
  'room:resume': (p: z.infer<typeof RoomResumePayload>, cb: Cb<{ playerId: string }>) => void;
  'room:leave': (p: object, cb: Cb) => void;
  'room:updateSettings': (p: z.infer<typeof UpdateSettingsPayload>, cb: Cb) => void;
  'room:kick': (p: z.infer<typeof KickPayload>, cb: Cb) => void;
  'room:deleteSound': (p: z.infer<typeof DeleteSoundPayload>, cb: Cb) => void;
  'game:start': (p: object, cb: Cb) => void;
  'game:vote': (p: z.infer<typeof VotePayload>, cb: Cb) => void;
  'game:backToLobby': (p: object, cb: Cb) => void;
  'time:sync': (
    p: z.infer<typeof TimeSyncPayload>,
    cb: Cb<{ clientTime: number; serverTime: number }>,
  ) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:kicked': (p: { reason: string }) => void;
  'room:closed': () => void;
  'voice:mute': (p: { muted: boolean }) => void;
  error: (p: { message: string }) => void;
}
