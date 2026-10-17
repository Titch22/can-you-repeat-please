import type { Ack, Settings } from '@cyrp/shared';
import { useGame } from '../store';
import { socket } from './socket';
import { loadSession, saveSession, type Profile } from './storage';

const TIMEOUT_MS = 5000;

/** Turns an ack timeout (server unreachable) into a regular error ack. */
async function call<T>(request: Promise<Ack<T>>): Promise<Ack<T>> {
  try {
    return await request;
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function createRoom(profile: Profile) {
  const ack = await call(socket.timeout(TIMEOUT_MS).emitWithAck('room:create', profile));
  if (ack.ok) {
    saveSession({ code: ack.code, playerId: ack.playerId, sessionToken: ack.sessionToken });
    useGame.setState({ playerId: ack.playerId, notice: null });
  }
  return ack;
}

export async function joinRoom(code: string, profile: Profile) {
  const ack = await call(socket.timeout(TIMEOUT_MS).emitWithAck('room:join', { code, ...profile }));
  if (ack.ok) {
    saveSession({ code, playerId: ack.playerId, sessionToken: ack.sessionToken });
    useGame.setState({ playerId: ack.playerId, notice: null });
  }
  return ack;
}

/** Called on every (re)connect: puts the player back in their seat if the session is still valid. */
export async function resumeSession() {
  const session = loadSession();
  if (!session) return useGame.setState({ resuming: false });
  useGame.setState({ resuming: true });
  const ack = await call(
    socket.timeout(TIMEOUT_MS).emitWithAck('room:resume', {
      code: session.code,
      sessionToken: session.sessionToken,
    }),
  );
  if (ack.ok) {
    useGame.setState({ playerId: ack.playerId, resuming: false });
  } else {
    saveSession(null);
    useGame.setState({ room: null, playerId: null, resuming: false });
  }
}

/** Local cleanup after leaving, being kicked, or the room closing. */
export function endSession(notice: string | null = null) {
  saveSession(null);
  useGame.setState({ room: null, playerId: null, resuming: false, notice });
}

export async function leaveRoom() {
  await call(socket.timeout(TIMEOUT_MS).emitWithAck('room:leave', {}));
  endSession();
}

export const updateSettings = (patch: Partial<Settings>) =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('room:updateSettings', patch));

export const kickPlayer = (playerId: string) =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('room:kick', { playerId }));

/** Dev-only: lets the host test the recording mute before the game loop exists. */
export const debugSetVoiceMuted = (muted: boolean) =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('debug:setVoiceMuted', { muted }));
