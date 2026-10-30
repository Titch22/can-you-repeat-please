import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CUSTOM_SOUND_MS, MAX_RECORDING_MS, type Phase, type SoundRef } from '@cyrp/shared';
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
const dialogue: SoundRef = {
  ...sound('lib:d1'),
  tags: ['team'],
  lines: [
    { startMs: 0, endMs: 500, speaker: 'A', text: 'Hello.', wordStartsMs: [] },
    { startMs: 500, endMs: 1000, speaker: 'B', text: 'Hi!', wordStartsMs: [] },
  ],
};

function setup(names = ['Alice', 'Bob', 'Carol']) {
  const voice: boolean[] = [];
  const discardRecordings = vi.fn();
  // eslint-disable-next-line prefer-const
  let game: GameRunner;
  const rooms = new RoomManager({ onPresenceChanged: (room) => game.onPresenceChanged(room) });
  // The library holds s1 and s2, and d1: a dialogue (Teams mode).
  const library = {
    available: true,
    // User 42's own sound u1 only resolves when they share theirs.
    resolve: vi.fn(async (ids: string[], owners: number[] = []) => {
      if (!library.available) throw new RoomError('LIBRARY_UNAVAILABLE');
      return ids.flatMap((x) =>
        x === 's1' || x === 's2'
          ? [sound(`lib:${x}`)]
          : x === 'd1'
            ? [dialogue]
            : x === 'u1' && owners.includes(42)
              ? [sound('lib:u1')]
              : [],
      );
    }),
    userSounds: vi.fn(async () => []),
  };
  game = new GameRunner({
    rooms,
    timing: T,
    library,
    setVoiceMuted: async (_code, muted) => void voice.push(muted),
    discardRecordings,
    rng: () => 0.5,
  });
  const { room, player: host } = rooms.create(names[0]!, '#ff0000', `s-${names[0]}`);
  const others = names.slice(1).map((n) => rooms.join(room.code, n, '#00ff00', `s-${n}`).player);
  room.settings.selectedSoundIds = ['lib:s1', 'lib:s2']; // nothing is ticked by default
  const players = [host, ...others];
  const id = (name: string) => players.find((p) => p.nickname === name)!.id;
  return { rooms, game, room, voice, discardRecordings, id, library };
}

/** Advances fake time until the room reaches `phase` (fails after 60 s of game time). */
function advanceTo(room: Room, phase: Phase) {
  for (let i = 0; i < 6000 && room.phase !== phase; i++) vi.advanceTimersByTime(10);
  expect(room.phase).toBe(phase);
}

const errorCode = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof RoomError) return e.code;
    throw e;
  }
  return null;
};

describe('GameRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('dub mode', () => {
    const clip = (id: string, durationMs = 1000): SoundRef & { uploadedBy: string } => ({
      id,
      label: id,
      durationMs,
      url: '',
      uploadedBy: 'someone',
      video: { youtubeId: 'dQw4w9WgXcQ', startMs: 5000 },
    });
    const dubRoom = (names?: string[]) => {
      const s = setup(names);
      s.room.settings = {
        ...s.room.settings,
        mode: 'dub',
        rounds: 1,
        selectedSoundIds: ['lib:s1', 'c1'],
      };
      s.room.customSounds.push(clip('c1'));
      return s;
    };

    it('plays ticked clips only, and refuses to start without one', async () => {
      const { game, room, id } = dubRoom();
      room.settings.selectedSoundIds = ['lib:s1'];
      expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NO_CLIPS');
      room.settings.selectedSoundIds = ['lib:s1', 'c1'];
      await game.start(room.code, id('Alice'));
      expect(room.game!.sounds.map((s) => s.id)).toEqual(['c1']);
    });

    it('never plays a clip in the other modes', async () => {
      const { game, room, id } = dubRoom();
      room.settings.mode = 'classic';
      await game.start(room.code, id('Alice'));
      expect(room.game!.sounds.map((s) => s.id)).toEqual(['lib:s1']);
    });

    it('shows the clip from the intro on, without teams', async () => {
      const { game, room, id } = dubRoom();
      await game.start(room.code, id('Alice'));
      expect(room.phase).toBe('ROUND_INTRO');
      expect(room.game!.reference?.video?.youtubeId).toBe('dQw4w9WgXcQ');
      expect(room.game!.teams).toBeNull();
      advanceTo(room, 'REFERENCE');
      expect(room.game!.reference!.startsAt).toBeGreaterThan(0);
    });

    it('records a long clip whole, and waits longer for its uploads', async () => {
      const { game, room, id } = dubRoom();
      room.customSounds = [clip('c1', 3_600_000)];
      await game.start(room.code, id('Alice'));
      advanceTo(room, 'RECORDING');
      const { startsAt, endsAt } = room.game!.recording!;
      expect(endsAt - startsAt).toBe(3_600_000); // no extra time, whatever the setting says
      expect(room.game!.deadline).toBe(endsAt + 120_000);
    });

    it('plays one mashup of everyone, then ends without votes or scores', async () => {
      const { game, room, id } = dubRoom();
      await game.start(room.code, id('Alice'));
      advanceTo(room, 'RECORDING');
      vi.advanceTimersByTime(T.countdownMs + 2100);
      game.finishUpload(room, id('Alice'), 'f1', 240);
      game.finishUpload(room, id('Bob'), 'f2', -30);
      game.finishUpload(room, id('Carol'), 'f3');
      advanceTo(room, 'PLAYBACK');
      expect(room.game!.performances).toHaveLength(1);
      expect(room.game!.performances[0]!.parts.map((p) => p.leadMs).sort()).toEqual([-30, 0, 240]);

      const seen = new Set<Phase>();
      for (let i = 0; i < 1000 && room.phase !== 'FINAL_RESULTS'; i++) {
        vi.advanceTimersByTime(10);
        seen.add(room.phase);
      }
      expect(room.phase).toBe('FINAL_RESULTS');
      expect(seen.has('VOTING')).toBe(false);
      expect(seen.has('ROUND_RESULTS')).toBe(false);
    });
  });

  it('only lets the host start, with at least 2 connected players', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob']);
    expect(await errorCode(() => game.start(room.code, id('Bob')))).toBe('NOT_HOST');
    rooms.disconnect(room.code, id('Bob'), 's-Bob');
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('plays a full game: rounds, mute while recording, playback, votes, scores, back to lobby', async () => {
    const { rooms, game, room, voice, discardRecordings, id } = setup();
    room.settings.rounds = 2;
    room.settings.replayReference = true;
    await game.start(room.code, id('Alice'));
    expect(room.phase).toBe('ROUND_INTRO');
    expect(rooms.toState(room, id('Bob')).round).toBe(1);

    advanceTo(room, 'REFERENCE');
    expect(room.game!.reference?.url).toMatch(/^\/sounds\/lib:s[12]$/);

    advanceTo(room, 'RECORDING');
    expect(voice).toEqual([true]);
    const { startsAt, endsAt } = room.game!.recording!;
    expect(endsAt - startsAt).toBe(1000 + room.settings.extraRecordMs);
    // Recordings stay hidden until playback.
    expect(rooms.toState(room, id('Bob')).performances).toEqual([]);
    expect(rooms.toState(room, id('Bob')).teams).toBeNull();

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
    expect(items.map((i) => i.kind)).toEqual([
      'reference',
      'performance',
      'performance',
      'performance',
    ]);
    // Each attempt is shown with its author (players recognize each other's voices anyway).
    expect(
      items.flatMap((i) => (i.kind === 'performance' ? i.performance.playerIds : [])).sort(),
    ).toEqual([id('Alice'), id('Bob'), id('Carol')].sort());
    expect(rooms.toState(room, id('Bob')).myPerformanceId).toBe('clip-Bob');

    advanceTo(room, 'VOTING');
    expect(
      rooms.toState(room, id('Bob')).performances.find((p) => p.id === 'clip-Alice')?.playerIds,
    ).toEqual([id('Alice')]);
    expect(await errorCode(() => game.vote(room.code, id('Alice'), ['clip-Alice']))).toBe(
      'CANNOT_VOTE_SELF',
    );
    game.vote(room.code, id('Alice'), ['clip-Bob', 'clip-Carol']);
    game.vote(room.code, id('Bob'), ['clip-Alice']);
    // Votes can be changed until everyone has voted.
    game.vote(room.code, id('Bob'), ['clip-Carol']);
    expect(room.phase).toBe('VOTING');
    game.vote(room.code, id('Carol'), []);
    expect(room.phase).toBe('ROUND_RESULTS');
    expect(room.game!.roundResults!.map((r) => [r.performanceId, r.votes])).toEqual([
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

    expect(await errorCode(() => game.backToLobby(room.code, id('Bob')))).toBe('NOT_HOST');
    game.backToLobby(room.code, id('Alice'));
    expect(room.phase).toBe('LOBBY');
    expect(room.game).toBeNull();
    expect(discardRecordings).toHaveBeenCalledWith(room);
  });

  it('guards uploads: phase, round, duplicates, late arrivals', async () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    expect(await errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('WRONG_PHASE');
    await game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');

    expect(await errorCode(() => game.beginUpload(room, id('Alice'), 2))).toBe('WRONG_PHASE');
    game.beginUpload(room, id('Alice'), 1);
    expect(await errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('ALREADY_SUBMITTED');
    game.finishUpload(room, id('Alice'), 'clip-Alice');
    expect(await errorCode(() => game.beginUpload(room, id('Alice'), 1))).toBe('ALREADY_SUBMITTED');

    // Bob's upload is still being stored when the phase ends: it is refused.
    game.beginUpload(room, id('Bob'), 1);
    advanceTo(room, 'PLAYBACK');
    expect(game.finishUpload(room, id('Bob'), 'clip-Bob')).toBe(false);
    expect(room.game!.performances.map((p) => p.id)).toEqual(['clip-Alice']);
  });

  it('ends the game when fewer than 2 players remain, unmuting voice', async () => {
    const { rooms, game, room, voice, id } = setup(['Alice', 'Bob']);
    await game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');
    rooms.leave(room.code, id('Bob'));
    expect(room.phase).toBe('FINAL_RESULTS');
    expect(voice).toEqual([true, false]);
  });

  it('does not wait for disconnected players, and late joiners only watch', async () => {
    const { rooms, game, room, id } = setup();
    await game.start(room.code, id('Alice'));
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
    expect(await errorCode(() => game.vote(room.code, dave.id, ['clip-Bob']))).toBe('SPECTATOR');
    game.vote(room.code, id('Alice'), ['clip-Bob']);
    game.vote(room.code, id('Bob'), ['clip-Alice']);
    expect(room.phase).toBe('ROUND_RESULTS');
  });

  it('only picks the sounds the host ticked, from the library and uploads', async () => {
    const { game, room, id, library } = setup(['Alice', 'Bob']);
    room.customSounds.push({ ...sound('mine'), uploadedBy: id('Bob') });
    room.customSounds.push({ ...sound('not-ticked'), uploadedBy: id('Bob') });
    room.settings.rounds = 6;
    room.settings.selectedSoundIds = ['lib:s2', 'lib:gone', 'mine'];
    await game.start(room.code, id('Alice'));
    expect(library.resolve).toHaveBeenCalledWith(['s2', 'gone'], []);
    expect(new Set(room.game!.sounds.map((s) => s.id))).toEqual(new Set(['lib:s2', 'mine']));
  });

  it('can pick the own sounds of players sharing theirs, while they are in the room', async () => {
    const { rooms, game, room, id, library } = setup(['Alice', 'Bob']);
    const carol = rooms.join(room.code, 'Carol', '#0000ff', 's-Carol').player;
    rooms.setSharing(room.code, carol.id, 42, true);
    // Logged in but not sharing: their sounds stay out.
    const dave = rooms.join(room.code, 'Dave', '#0000ff', 's-Dave').player;
    rooms.setSharing(room.code, dave.id, 43, false);
    room.settings.selectedSoundIds = ['lib:u1'];
    await game.start(room.code, id('Alice'));
    expect(library.resolve).toHaveBeenLastCalledWith(['u1'], [42]);
    expect(room.game!.sounds.map((s) => s.id)).toEqual([
      'lib:u1',
      'lib:u1',
      'lib:u1',
      'lib:u1',
      'lib:u1',
    ]);
    expect(
      rooms.toState(room, id('Alice')).players.find((p) => p.id === carol.id)?.sharesSounds,
    ).toBe(true);
  });

  it('refuses to start when the ticked library sounds are gone or the library is down', async () => {
    const { game, room, id, library } = setup(['Alice', 'Bob']);
    room.settings.selectedSoundIds = ['lib:gone'];
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NOT_ENOUGH_SOUNDS');
    room.settings.selectedSoundIds = ['lib:s1'];
    library.available = false;
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('LIBRARY_UNAVAILABLE');
    expect(room.phase).toBe('LOBBY');
    library.available = true;
    await game.start(room.code, id('Alice'));
    expect(room.phase).toBe('ROUND_INTRO');
  });

  it('plays a teams round: random pairs, one performance per team, both members score', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob', 'Carol', 'Dave']);
    room.settings.mode = 'teams';
    room.settings.rounds = 1;
    room.settings.replayReference = true;
    room.settings.selectedSoundIds = ['lib:s1', 'lib:d1']; // s1 isn't a dialogue
    await game.start(room.code, id('Alice'));
    expect(room.game!.sounds.map((s) => s.id)).toEqual(['lib:d1']);

    // Teams are known from the round intro on.
    const teams = rooms.toState(room, id('Alice')).teams!;
    expect(teams).toHaveLength(2);
    for (const t of teams) expect(t.members.map((m) => m.role).sort()).toEqual(['A', 'B']);
    const teamOf = (name: string) =>
      teams.find((t) => t.members.some((m) => m.playerId === id(name)))!;
    expect(rooms.toState(room, id('Alice')).reference).toBeNull();
    advanceTo(room, 'REFERENCE');
    expect(rooms.toState(room, id('Alice')).reference?.lines).toEqual(dialogue.lines);

    advanceTo(room, 'RECORDING');
    vi.setSystemTime(room.game!.recording!.endsAt + 10);
    // Dave doesn't record: his team still plays (his lines are silent) and he still scores.
    for (const name of ['Alice', 'Bob', 'Carol']) {
      game.beginUpload(room, id(name), 1);
      game.finishUpload(room, id(name), `clip-${name}`);
    }
    advanceTo(room, 'PLAYBACK');
    const items = room.game!.playback!.items;
    expect(items.map((i) => i.kind)).toEqual(['reference', 'performance', 'performance']);
    const perfs = room.game!.performances;
    expect(perfs.map((p) => p.id).sort()).toEqual(teams.map((t) => t.id).sort());
    const daveTeam = perfs.find((p) => p.id === teamOf('Dave').id)!;
    expect(daveTeam.playerIds).toContain(id('Dave'));
    expect(daveTeam.parts).toHaveLength(1);
    for (const part of perfs.flatMap((p) => p.parts)) {
      const member = teams.flatMap((t) => t.members).find((m) => m.playerId === part.playerId)!;
      expect(part.role).toBe(member.role);
    }

    advanceTo(room, 'VOTING');
    expect(rooms.toState(room, id('Alice')).myPerformanceId).toBe(teamOf('Alice').id);
    const otherTeam = (name: string) => teams.find((t) => t !== teamOf(name))!.id;
    expect(await errorCode(() => game.vote(room.code, id('Alice'), [teamOf('Alice').id]))).toBe(
      'CANNOT_VOTE_SELF',
    );
    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
      game.vote(room.code, id(name), [otherTeam(name)]);
    }
    expect(room.phase).toBe('ROUND_RESULTS');
    expect(room.game!.roundResults!.map((r) => r.votes)).toEqual([2, 2]);
    expect(room.players.map((p) => p.score)).toEqual([2, 2, 2, 2]);
  });

  it('puts the odd player alone, voicing both characters', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob', 'Carol']);
    room.settings.mode = 'teams';
    room.settings.selectedSoundIds = ['lib:d1'];
    await game.start(room.code, id('Alice'));
    const teams = rooms.toState(room, id('Alice')).teams!;
    expect(teams.map((t) => t.members.length).sort()).toEqual([1, 2]);
    expect(teams.find((t) => t.members.length === 1)!.members[0]!.role).toBe('both');
  });

  it('needs 3 players and a ticked dialogue in teams mode', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob']);
    room.settings.mode = 'teams';
    room.settings.selectedSoundIds = ['lib:d1'];
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NOT_ENOUGH_PLAYERS');
    rooms.join(room.code, 'Carol', '#0000ff', 's-Carol');
    room.settings.selectedSoundIds = ['lib:s1', 'lib:s2'];
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NO_DIALOGUES');
    expect(room.phase).toBe('LOBBY');
  });

  it('ends a teams game when fewer than 3 players remain', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob', 'Carol']);
    room.settings.mode = 'teams';
    room.settings.selectedSoundIds = ['lib:d1'];
    await game.start(room.code, id('Alice'));
    rooms.leave(room.code, id('Carol'));
    expect(room.phase).toBe('FINAL_RESULTS');
  });

  it('starts only once when the host double-clicks', async () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    const first = game.start(room.code, id('Alice'));
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('WRONG_PHASE');
    await first;
    expect(room.phase).toBe('ROUND_INTRO');
  });

  it('gives the longest custom sound its full recording window', async () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    room.customSounds.push({
      ...sound('long'),
      durationMs: MAX_CUSTOM_SOUND_MS,
      uploadedBy: id('Bob'),
    });
    room.settings.selectedSoundIds = ['long'];
    room.settings.extraRecordMs = 3000;
    await game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');
    const { startsAt, endsAt } = room.game!.recording!;
    expect(endsAt - startsAt).toBe(MAX_CUSTOM_SOUND_MS + 3000);
    expect(endsAt - startsAt).toBeLessThanOrEqual(MAX_RECORDING_MS);
  });

  it('skips the original in playback when replayReference is off', async () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    room.settings.replayReference = false;
    await game.start(room.code, id('Alice'));
    advanceTo(room, 'RECORDING');
    vi.setSystemTime(room.game!.recording!.endsAt + 10);
    for (const name of ['Alice', 'Bob']) {
      game.beginUpload(room, id(name), 1);
      game.finishUpload(room, id(name), `clip-${name}`);
    }
    advanceTo(room, 'PLAYBACK');
    expect(room.game!.playback!.items.map((i) => i.kind)).toEqual(['performance', 'performance']);
  });

  it('refuses to start when no sound is ticked', async () => {
    const { game, room, id } = setup(['Alice', 'Bob']);
    room.settings.selectedSoundIds = [];
    expect(await errorCode(() => game.start(room.code, id('Alice')))).toBe('NOT_ENOUGH_SOUNDS');
    expect(room.phase).toBe('LOBBY');
  });

  it('stops scheduling once the room is closed', async () => {
    const { rooms, game, room, id } = setup(['Alice', 'Bob']);
    await game.start(room.code, id('Alice'));
    rooms.closeAll();
    game.stop(room.code);
    vi.advanceTimersByTime(10_000);
    expect(room.phase).toBe('ROUND_INTRO');
  });
});
