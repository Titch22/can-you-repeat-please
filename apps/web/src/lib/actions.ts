import type { Ack, ErrorCode, Settings, SoundRef } from '@cyrp/shared';
import { useGame } from '../store';
import { socket } from './socket';
import { releaseMic } from './mic';
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
  void releaseMic();
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

export const startGame = () => call(socket.timeout(TIMEOUT_MS).emitWithAck('game:start', {}));

export const castVote = (clipIds: string[]) =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('game:vote', { clipIds }));

export const backToLobby = () =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('game:backToLobby', {}));

/** Uploads a custom sound for the room (raw body; the server checks format and length). */
export async function uploadSound(
  code: string,
  file: Blob,
  label: string,
): Promise<{ ok: true; sound: SoundRef } | { ok: false; error: ErrorCode }> {
  try {
    const res = await fetch(`/api/rooms/${code}/sounds?label=${encodeURIComponent(label)}`, {
      method: 'POST',
      headers: { 'X-Session-Token': loadSession()?.sessionToken ?? '' },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { error?: ErrorCode } & SoundRef;
    if (res.ok) return { ok: true, sound: body };
    return { ok: false, error: body.error ?? (res.status === 413 ? 'FILE_TOO_LARGE' : 'INTERNAL') };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}

export const deleteSound = (soundId: string) =>
  call(socket.timeout(TIMEOUT_MS).emitWithAck('room:deleteSound', { soundId }));
