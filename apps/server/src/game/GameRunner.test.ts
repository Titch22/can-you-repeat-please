import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase, SoundRef } from '@cyrp/shared';
import { RoomError, RoomManager, type Room } from '../rooms/RoomManager.js';
import { GameRunner } from './GameRunner.js';
import type { Timing } from './timing.js';

const T: Timing = {
  introMs: 100,
  referenceLeadMs: 100,
  referenceTailMs: 100,
  countdownMs: 100,
  uploadGraceMs: 500,
  afterRecordingMs: 200,
  playbackIntroMs: 150,
  playbackLeadMs: 50,
  playbackGapMs: 50,
  resultsMs: 200,
};

const sound = (id: string): SoundRef => ({ id, label: id, durationMs: 1000, url: `/sounds/${id}` });

function setup(names = ['Alice', 'Bob', 'Carol']) {
  const voice: boolean[] = [];
  const discardRecordings = vi.fn();
  // eslint-disable-next-line prefer-const
  let game: GameRunner;
  const rooms = new RoomManager({ onPresenceChanged: (room) => game.onPresenceChanged(room) });
  game = new GameRunner({
    rooms,
    timing: T,
    defaultSounds: [sound('s1'), sound('s2')],
    setVoiceMuted: async (_code, muted) => void voice.push(muted),
    discardRecordings,
    rng: () => 0.5,
  });
  const { room, player: host } = rooms.create(names[0]!, '#ff0000', `s-${names[0]}`);
  const others = names.slice(1).map((n) => rooms.join(room.code, n, '#00ff00', `s-${n}`).player);
  const players = [host, ...others];
  const id = (name: string) => players.find((p) => p.nickname === name)!.id;
  return { rooms, game, room, voice, discardRecordings, id };
}

/** Advances fake time until the room reaches `phase` (fails after 60 s of game time). */
function advanceTo(room: Room, phase: Phase) {
  for (let i = 0; i < 6000 && room.phase !== phase; i++) vi.advanceTimersByTime(10);
  expect(room.phase).toBe(phase);
}

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RoomError) return e.code;
    throw e;
  }
  return null;
};

describe('GameRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only lets the host start, with at least 2 connected players', () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob']);
    expect(errorCode(() => game.start(room.code, id('Bob')))).toBe('NOT_HOST');
    rooms.disconnect(room.code, id('Bob'), 's-Bob');
    expect(errorCode(() => game.start(room.code, id('Alice')))).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('plays a full game: rounds, mute while recording, playback, votes, scores, back to lobby', () => {
    const { rooms, game, room, voice, discardRecordings, id } = setup();
    room.settings.rounds = 2;
    game.start(room.code, id('Alice'));
    expect(room.phase).toBe('ROUND_INTRO');
    expect(rooms.toState(room, id('Bob')).round).toBe(1);

    advanceTo(room, 'REFERENCE');
    expect(room.game!.reference?.url).toMatch(/^\/sounds\/s[12]$/);

    advanceTo(room, 'RECORDING');
    expect(voice).toEqual([true]);
    const { startsAt, endsAt } = room.game!.recording!;
    expect(endsAt - startsAt).toBe(1000 + room.settings.extraRecordMs);
    // Clips stay hidden until playback.
    expect(rooms.toState(room, id('Bob')).clips).toEqual([]);

    // Uploads arrive once the recording window has closed. With all of them in, the phase
    // still holds a "Time's up!" pause before playback.
    vi.setSystemTime(endsAt + 10);
    for (const name of ['Alice', 'Bob', 'Carol']) {
      game.beginUpload(room, id(name), 1);
      game.finishUpload(room, id(name), `clip-${name}`);
    }
    expect(room.phase).toBe('RECORDING');
    expect(room.game!.deadline).toBe(endsAt + T.afterRecordingMs);
    advanceTo(room, 'PLAYBACK');
    expect(Date.now()).toBeGreaterThanOrEqual(endsAt + T.afterRecordingMs);
    expect(voice).toEqual([true, false]);
    // A longer pause before the first sound, then the shorter lead for the next ones.
    expect(room.game!.playback!.startsAt - Date.now()).toBe(T.playbackIntroMs);
    const items = room.game!.playback!.items;
    expect(items.map((i) => i.kind)).toEqual(['reference', 'clip', 'clip', 'clip']);
    expect(rooms.toState(room, id('Bob')).myClipId).toBe('clip-Bob');

    advanceTo(room, 'VOTING');
    expect(errorCode(() => game.vote(room.code, id('Alice'), ['clip-Alice']))).toBe(
      'CANNOT_VOTE_SELF',
    );
    game.vote(room.code, id('Alice'), ['clip-Bob', 'clip-Carol']);
    game.vote(room.code, id('Bob'), ['clip-Alice']);
    // Votes can be changed until everyone has voted.
    game.vote(room.code, id('Bob'), ['clip-Carol']);
    expect(room.phase).toBe('VOTING');
    game.vote(room.code, id('Carol'), []);
    expect(room.phase).toBe('ROUND_RESULTS');
    expect(room.game!.roundResults!.map((r) => [r.clipId, r.votes])).toEqual([
      ['clip-Carol', 2],
      ['clip-Bob', 1],
      ['clip-Alice', 0],
    ]);
    expect(room.players.map((p) => [p.nickname, p.score])).toEqual([
      ['Alice', 0],
      ['Bob', 1],
      ['Carol', 2],
    ]);

    // Round 2: nobody records, so playback and voting are skipped.
    advanceTo(room, 'ROUND_INTRO');
    expect(room.game!.round).toBe(2);
    advanceTo(room, 'RECORDING');
    advanceTo(room, 'ROUND_RESULTS');
    expect(room.game!.roundResults).toEqual([]);
    advanceTo(room, 'FINAL_RESULTS');
    expect(room.game!.deadline).toBeNull();
    expect(voice).toEqual([true, false, true, false]);

    expect(errorCode(() => game.backToLobby(room.code, id('Bob')))).toBe('NOT_HOST');
    game.backToLobby(room.code, id('Alice'));
    expect(room.phase).toBe('LOBBY');
    expect(room.game).toBeNull();
    expect(discardRecordings).toHaveBeenCalledWith(room);
  });

  it('guards uploads: phase, round, duplicates, late arrivals', () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    expect(errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('WRONG_PHASE');
    game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');

    expect(errorCode(() => game.beginUpload(room, id('Alice'), 2))).toBe('WRONG_PHASE');
    game.beginUpload(room, id('Alice'), 1);
    expect(errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('ALREADY_SUBMITTED');
    game.finishUpload(room, id('Alice'), 'clip-Alice');
    expect(errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('ALREADY_SUBMITTED');

    // Bob's upload is still being stored when the phase ends: it is refused.
    game.beginUpload(room, id('Bob'), 1);
    advanceTo(room, 'PLAYBACK');
    expect(game.finishUpload(room, id('Bob'), 'clip-Bob')).toBe(false);
    expect(room.game!.clipOrder).toEqual(['clip-Alice']);
  });

  it('ends the game when fewer than 2 players remain, unmuting voice', () => {
    const { rooms, game, room, voice, id } = setup(['Alice', 'Bob']);
    game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');
    rooms.leave(room.code, id('Bob'));
    expect(room.phase).toBe('FINAL_RESULTS');
    expect(voice).toEqual([true, false]);
  });

  it('does not wait for disconnected players, and late joiners only watch', () => {
    const { rooms, game, room, id } = setup();
    game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');
    vi.setSystemTime(room.game!.recording!.endsAt + 10);
    game.beginUpload(room, id('Alice'), 1);
    game.finishUpload(room, id('Alice'), 'clip-Alice');
    game.beginUpload(room, id('Bob'), 1);
    game.finishUpload(room, id('Bob'), 'clip-Bob');
    expect(room.phase).toBe('RECORDING'); // still waiting for Carol
    rooms.disconnect(room.code, id('Carol'), 's-Carol');
    expect(room.game!.deadline).toBe(room.game!.recording!.endsAt + T.afterRecordingMs);
    advanceTo(room, 'PLAYBACK');

    const { player: dave } = rooms.join(room.code, 'Dave', '#0000ff', 's-Dave');
    expect(dave.isSpectator).toBe(true);
    advanceTo(room, 'VOTING');
    expect(errorCode(() => game.vote(room.code, dave.id, ['clip-Bob']))).toBe('SPECTATOR');
    game.vote(room.code, id('Alice'), ['clip-Bob']);
    game.vote(room.code, id('Bob'), ['clip-Alice']);
    expect(room.phase).toBe('ROUND_RESULTS');
  });

  it('stops scheduling once the room is closed', () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob']);
    game.start(room.code, id('Alice'));
    rooms.closeAll();
    game.stop(room.code);
    vi.advanceTimersByTime(10_000);
    expect(room.phase).toBe('ROUND_INTRO');
  });
});
