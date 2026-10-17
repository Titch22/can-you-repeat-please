import { create } from 'zustand';
import type { RoomState } from '@cyrp/shared';
import { loadSession } from './lib/storage';

interface GameStore {
  connected: boolean;
  /** serverTime - clientTime, in ms. */
  clockOffset: number;
  room: RoomState | null;
  playerId: string | null;
  /** True while a saved session is being resumed (avoids flashing the join form on reload). */
  resuming: boolean;
  /** One-off message shown on the home page (kicked, room closed…). */
  notice: string | null;
}

export const useGame = create<GameStore>(() => ({
  connected: false,
  clockOffset: 0,
  room: null,
  playerId: loadSession()?.playerId ?? null,
  resuming: loadSession() !== null,
  notice: null,
}));
