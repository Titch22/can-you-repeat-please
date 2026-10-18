import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_IDLE_TIMEOUT_MS,
} from '@cyrp/shared';
import { RoomError, RoomManager, type RoomManagerHooks } from './RoomManager.js';

function setup() {
  const hooks = {
    onCreated: vi.fn(),
    onChanged: vi.fn(),
    onPlayerRemoved: vi.fn(),
    onClosed: vi.fn(),
  } satisfies RoomManagerHooks;
  const rooms = new RoomManager(hooks, () => Date.now());
  const { room, player: host } = rooms.create('Alice', '#ff0000', 's-alice');
  return { rooms, hooks, room, host };
}

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RoomError) return err.code;
    throw err;
  }
  return null;
};

describe('RoomManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates a room with a 4-letter code and the creator as host', () => {
    const { rooms, room, host, hooks } = setup();
    expect(room.code).toMatch(/^[A-Z]{4}$/);
    expect(room.hostId).toBe(host.id);
    expect(rooms.toState(room, host.id).players).toEqual([
      expect.objectContaining({ nickname: 'Alice', isHost: true, connected: true }),
    ]);
    expect(hooks.onCreated).toHaveBeenCalledWith(room);
  });

  it('lets players join until the room is full', () => {
    const { rooms, room } = setup();
    for (let i = 1; i < MAX_PLAYERS; i++) rooms.join(room.code, `P${i}`, '#00ff00', `s${i}`);
    expect(errorCode(() => rooms.join(room.code, 'Late', '#00ff00', 'late'))).toBe('ROOM_FULL');
  });

  it('rejects unknown rooms and duplicate nicknames (case-insensitive)', () => {
    const { rooms, room } = setup();
    expect(errorCode(() => rooms.join('ZZZZ', 'Bob', '#00ff00', 's'))).toBe('ROOM_NOT_FOUND');
    expect(errorCode(() => rooms.join(room.code, 'alice', '#00ff00', 's'))).toBe('NICKNAME_TAKEN');
  });

  it('gives host rights to the earliest remaining player when the host leaves', () => {
    const { rooms, room, host } = setup();
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's-bob');
    rooms.join(room.code, 'Carol', '#0000ff', 's-carol');
    rooms.leave(room.code, host.id);
    expect(room.hostId).toBe(bob.id);
  });

  it('closes the room when the last player leaves', () => {
    const { rooms, room, host, hooks } = setup();
    rooms.leave(room.code, host.id);
    expect(rooms.get(room.code)).toBeUndefined();
    expect(hooks.onClosed).toHaveBeenCalledWith(room, 'empty');
  });

  it('keeps a disconnected player during the grace period and lets them resume', () => {
    const { rooms, room } = setup();
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's-bob');
    rooms.disconnect(room.code, bob.id, 's-bob');
    expect(rooms.toState(room, bob.id).players[1]?.connected).toBe(false);

    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    rooms.resume(room.code, bob.sessionToken, 's-bob-2');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(room.players).toContain(bob);
    expect(bob.socketId).toBe('s-bob-2');
  });

  it('removes a disconnected player once the grace period expires', () => {
    const { rooms, room, hooks } = setup();
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's-bob');
    rooms.disconnect(room.code, bob.id, 's-bob');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(room.players).not.toContain(bob);
    expect(hooks.onPlayerRemoved).toHaveBeenCalledWith(room, bob, 'timeout');
    expect(errorCode(() => rooms.resume(room.code, bob.sessionToken, 's'))).toBe('SESSION_EXPIRED');
  });

  it('ignores a disconnect from a stale socket after the player resumed elsewhere', () => {
    const { rooms, room, host } = setup();
    rooms.resume(room.code, host.sessionToken, 's-alice-new-tab');
    rooms.disconnect(room.code, host.id, 's-alice');
    expect(host.socketId).toBe('s-alice-new-tab');
  });

  it('only lets the host kick, and not themselves', () => {
    const { rooms, room, host, hooks } = setup();
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's-bob');
    expect(errorCode(() => rooms.kick(room.code, bob.id, host.id))).toBe('NOT_HOST');
    expect(errorCode(() => rooms.kick(room.code, host.id, host.id))).toBe('INVALID_PAYLOAD');
    rooms.kick(room.code, host.id, bob.id);
    expect(room.players).not.toContain(bob);
    expect(hooks.onPlayerRemoved).toHaveBeenCalledWith(room, bob, 'kicked');
  });

  it('only lets the host update settings', () => {
    const { rooms, room, host } = setup();
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's-bob');
    expect(errorCode(() => rooms.updateSettings(room.code, bob.id, { rounds: 3 }))).toBe(
      'NOT_HOST',
    );
    rooms.updateSettings(room.code, host.id, { rounds: 3 });
    expect(room.settings.rounds).toBe(3);
    expect(room.settings.selectedSoundIds).toEqual([]); // no sound ticked by default
  });

  it('closes idle rooms on sweep', () => {
    const { rooms, room, hooks } = setup();
    vi.advanceTimersByTime(ROOM_IDLE_TIMEOUT_MS - 1);
    rooms.sweepIdle();
    expect(rooms.get(room.code)).toBe(room);
    vi.advanceTimersByTime(2);
    rooms.sweepIdle();
    expect(rooms.get(room.code)).toBeUndefined();
    expect(hooks.onClosed).toHaveBeenCalledWith(room, 'idle');
  });
});

describe('RoomManager custom sounds', () => {
  const upload = (id: string, by: string) => ({
    id,
    label: id,
    durationMs: 1000,
    url: `/api/x/${id}`,
    uploadedBy: by,
  });

  it('lists the default pack, then uploads, and caps uploads per room, not per player', () => {
    const def = { id: 'default:a', label: 'A', durationMs: 1000, url: '/sounds/default/a.mp3' };
    const rooms = new RoomManager({}, Date.now, [def]);
    const { room, player: host } = rooms.create('Alice', '#ff0000', 's');
    for (let i = 0; i < MAX_CUSTOM_SOUNDS_PER_ROOM; i++)
      rooms.addCustomSound(room, upload(`u${i}`, host.id));
    expect(errorCode(() => rooms.assertCanAddSound(room))).toBe('TOO_MANY_SOUNDS');
    expect(rooms.toState(room, host.id).sounds.map((s) => s.id)).toEqual([
      'default:a',
      ...Array.from({ length: MAX_CUSTOM_SOUNDS_PER_ROOM }, (_, i) => `u${i}`),
    ]);
  });

  it('only accepts uploads in the lobby', () => {
    const rooms = new RoomManager();
    const { room } = rooms.create('Alice', '#ff0000', 's');
    room.phase = 'RECORDING';
    expect(errorCode(() => rooms.assertCanAddSound(room))).toBe('WRONG_PHASE');
  });

  it('lets the uploader or the host delete a sound, and forgets it in the selection', () => {
    const rooms = new RoomManager();
    const { room, player: host } = rooms.create('Alice', '#ff0000', 's1');
    const { player: bob } = rooms.join(room.code, 'Bob', '#00ff00', 's2');
    const { player: carol } = rooms.join(room.code, 'Carol', '#0000ff', 's3');
    rooms.addCustomSound(room, upload('bob-1', bob.id));
    rooms.addCustomSound(room, upload('bob-2', bob.id));
    rooms.updateSettings(room.code, host.id, { selectedSoundIds: ['bob-1', 'default:x'] });

    expect(errorCode(() => rooms.removeCustomSound(room.code, carol.id, 'bob-1'))).toBe('NOT_HOST');
    rooms.removeCustomSound(room.code, bob.id, 'bob-1');
    rooms.removeCustomSound(room.code, host.id, 'bob-2');
    expect(room.customSounds).toEqual([]);
    expect(room.settings.selectedSoundIds).toEqual(['default:x']);
    expect(errorCode(() => rooms.removeCustomSound(room.code, host.id, 'nope'))).toBe(
      'INVALID_PAYLOAD',
    );
  });
});
