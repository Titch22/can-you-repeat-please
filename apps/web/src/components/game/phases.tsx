import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MAX_VOTES_PER_PLAYER,
  type Mashup,
  type Performance,
  type Player,
  type RoomState,
} from '@cyrp/shared';
import { useRecorder, type RecorderStatus } from '../../hooks/useRecorder';
import { backToLobby, castVote } from '../../lib/actions';
import {
  downloadRecording,
  playAt,
  playSegmentsAt,
  renderSegments,
  replaySegments,
  saveBlob,
} from '../../lib/audio';
import { useServerNow } from '../../lib/clock';
import { lineAt, performanceSegments, speaks } from '../../lib/dialogue';
import { errorMessage } from '../../lib/errors';
import { useDubScene } from '../../lib/youtube';
import { Avatar, Button, ErrorText } from '../ui';
import { DownloadButton, PlayButton, ProgressBar } from './bits';
import {
  DialogueTimeline,
  myTeam,
  namesOf,
  playerOf,
  PlayersLabel,
  RoleBadge,
  speakerText,
  Subtitle,
} from './teams';

interface PhaseProps {
  room: RoomState;
  me: Player | undefined;
}

/** "Bob - Screaming goat": the name a downloaded recording is saved under. */
function recordingName(room: RoomState, performance: Performance) {
  return `${namesOf(room, performance.playerIds)} - ${room.reference?.label ?? 'recording'}`;
}

const segmentsOf = (room: RoomState, performance: Performance) =>
  performanceSegments(performance, room.reference);

/** Plays `url` for everyone at `startsAt` (server time) while mounted. */
function useScheduledSound(url: string | undefined, startsAt: number | undefined) {
  useEffect(() => {
    if (!url || startsAt === undefined) return;
    return playAt(url, startsAt);
  }, [url, startsAt]);
}

/** Plays a performance (stitched in Teams mode) for everyone at `startsAt` while mounted. */
function useScheduledPerformance(
  room: RoomState,
  performance: Performance | undefined,
  startsAt: number | undefined,
) {
  const segments = performance ? segmentsOf(room, performance) : null;
  const key = segments ? JSON.stringify(segments) : null;
  useEffect(() => {
    if (!key || startsAt === undefined) return;
    return playSegmentsAt(JSON.parse(key), startsAt);
  }, [key, startsAt]);
}

/** Centered stage content. */
function Stage({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      className="flex flex-col items-center gap-4 py-8 text-center sm:py-10"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

const Lead = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-muted sm:text-lg ${className}`}>{children}</p>
);

const Headline = ({ children }: { children: ReactNode }) => (
  <p className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{children}</p>
);

export function RoundIntro({ room, me }: PhaseProps) {
  const mine = myTeam(room, me?.id);
  return (
    <Stage>
      <Lead>Get ready…</Lead>
      <p className="animate-pop font-display text-6xl font-black tracking-tight sm:text-7xl">
        Round {room.round}
        <span className="text-subtle">/{room.settings.rounds}</span>
      </p>
      {mine && (
        <p className="text-lg sm:text-xl" data-testid="my-team">
          {mine.partner ? (
            <>
              You’re with <b>{playerOf(room, mine.partner.playerId).nickname}</b>: you voice{' '}
              <RoleBadge role={mine.role} className="align-middle" />
            </>
          ) : (
            <>
              You’re alone this round: you voice <b>both characters</b>{' '}
              <RoleBadge role="both" className="align-middle" />
            </>
          )}
        </p>
      )}
      {room.teams && (
        <ul className="flex w-full max-w-lg flex-col gap-2" data-testid="teams">
          {room.teams.map((t) => (
            <li
              key={t.id}
              className={`rounded-control border px-3 py-2 ${
                t === mine?.team
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-line bg-surface-raised/40'
              }`}
            >
              <PlayersLabel room={room} playerIds={t.members.map((m) => m.playerId)} />
            </li>
          ))}
        </ul>
      )}
    </Stage>
  );
}

export function ReferencePhase({ room, me }: PhaseProps) {
  const ref = room.reference;
  useScheduledSound(ref?.url, ref?.startsAt);
  const now = useServerNow(100);
  if (!ref) return null;
  const playing = now >= ref.startsAt;
  const ended = now >= ref.startsAt + ref.durationMs;
  const role = myTeam(room, me?.id)?.role;
  return (
    <Stage>
      <Lead className={ended ? 'font-semibold text-accent' : ''}>
        {ended ? 'Get ready to repeat it!' : playing ? 'Listen carefully!' : 'Here it comes…'}
      </Lead>
      <Headline>{ref.label}</Headline>
      {room.teams && ref.lines?.length ? (
        <div className="flex w-full max-w-lg flex-col gap-2">
          <DialogueTimeline
            lines={ref.lines}
            durationMs={ref.durationMs}
            startsAt={ref.startsAt}
            myRole={role}
          />
          <Subtitle lines={ref.lines} ms={now - ref.startsAt} myRole={role} />
          {role && (
            <p className="text-sm text-muted">
              Your lines are outlined: you voice{' '}
              {role === 'both' ? 'both characters' : `character ${role}`}.
            </p>
          )}
        </div>
      ) : (
        <div className="w-full max-w-sm">
          <ProgressBar from={ref.startsAt} to={ref.startsAt + ref.durationMs} />
        </div>
      )}
    </Stage>
  );
}

const RECORDER_TEXT: Record<RecorderStatus, string> = {
  idle: '',
  preparing: 'Getting your microphone…',
  countdown: 'Get ready to repeat it!',
  recording: 'Your turn! Repeat the sound!',
  uploading: 'Sending your recording…',
  done: 'Got it! Waiting for the others…',
  'no-mic': 'No microphone access, so you’ll sit this one out.',
  error: 'Your recording could not be sent.',
};

/** Teams mode, while recording: is it my line now, my partner's, or a pause before mine? */
function DialogueCue({ room, meId, now }: { room: RoomState; meId: string; now: number }) {
  const rec = room.recording!;
  const lines = room.reference?.lines ?? [];
  const mine = myTeam(room, meId);
  const { current, next } = lineAt(lines, now - rec.startsAt);
  const partnerName = mine?.partner ? playerOf(room, mine.partner.playerId).nickname : null;

  if (current && speaks(mine?.role, current.speaker)) {
    return (
      <p
        className="inline-flex animate-pop items-center gap-3 rounded-full bg-rec/15 px-6 py-2.5 font-display text-3xl font-black text-rose-300 sm:text-4xl"
        data-status="recording"
      >
        <span className="size-4 animate-pulse rounded-full bg-rec shadow-[0_0_12px_var(--color-rec)]" />
        YOUR LINE!
        <RoleBadge role={current.speaker} />
      </p>
    );
  }
  const upcomingMine = next && speaks(mine?.role, next.speaker);
  const inSec = next ? Math.ceil((rec.startsAt + next.startMs - now) / 1000) : 0;
  return (
    <p className="font-display text-2xl font-bold sm:text-3xl" data-status="recording">
      {current ? (
        <span className={speakerText(current.speaker)}>
          {partnerName ? `${partnerName}’s line…` : `Character ${current.speaker}’s line…`}
        </span>
      ) : upcomingMine ? (
        <span className="text-ink">Your line in {inSec}…</span>
      ) : next ? (
        <span className="text-muted">Wait for it…</span>
      ) : (
        <span className="text-muted">That’s the end of the scene!</span>
      )}
    </p>
  );
}

export function RecordingPhase({ room, me }: PhaseProps) {
  const canRecord = !!me && !me.isSpectator;
  const { status, level } = useRecorder(room, canRecord);
  const now = useServerNow(50);
  const rec = room.recording;
  if (!rec) return null;

  if (!canRecord) {
    return (
      <Stage>
        <Lead>The players are recording… You’ll join in the next game.</Lead>
      </Stage>
    );
  }

  const countdown = Math.ceil((rec.startsAt - now) / 1000);
  const timesUp = now >= rec.endsAt;
  const lines = room.teams ? room.reference?.lines : undefined;
  const mine = myTeam(room, me.id);
  return (
    <Stage testId="recorder">
      <Lead className="text-sm sm:text-base">Everyone is muted while recording.</Lead>
      {timesUp && (
        <p className="animate-shake font-display text-5xl font-black text-accent">Time’s up!</p>
      )}
      {status === 'countdown' && countdown > 0 ? (
        <p
          key={countdown}
          className="animate-pop font-display text-8xl font-black text-accent tabular-nums"
        >
          {countdown}
        </p>
      ) : status === 'recording' && lines?.length ? (
        <DialogueCue room={room} meId={me.id} now={now} />
      ) : status === 'recording' ? (
        <p
          className="inline-flex items-center gap-3 rounded-full bg-rec/15 px-5 py-2 font-display text-2xl font-extrabold text-rose-300 sm:text-3xl"
          data-status={status}
        >
          <span className="size-4 animate-pulse rounded-full bg-rec shadow-[0_0_12px_var(--color-rec)]" />
          {room.reference?.video ? 'Your turn! Dub it!' : RECORDER_TEXT[status]}
        </p>
      ) : (
        <p
          className={`font-display text-2xl font-bold sm:text-3xl ${
            status === 'done' ? 'text-success' : status === 'error' ? 'text-danger' : ''
          }`}
          data-status={status}
        >
          {RECORDER_TEXT[status]}
        </p>
      )}
      {lines?.length && (status === 'countdown' || status === 'recording') ? (
        <div className="flex w-full max-w-lg flex-col gap-2">
          <DialogueTimeline
            lines={lines}
            durationMs={room.reference!.durationMs}
            startsAt={rec.startsAt}
            myRole={mine?.role}
          />
          <Subtitle lines={lines} ms={now - rec.startsAt} myRole={mine?.role} />
        </div>
      ) : null}
      {status === 'recording' && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <ProgressBar from={rec.startsAt} to={rec.endsAt} color="bg-rec" />
          <div
            className="h-3 overflow-hidden rounded-full bg-surface-raised"
            aria-label="Mic level"
          >
            <div
              className="h-full rounded-full bg-success transition-[width] duration-75"
              style={{ width: `${level * 100}%` }}
            />
          </div>
        </div>
      )}
      {status !== 'recording' && status !== 'countdown' && (
        <p className="text-sm text-muted">
          {room.submittedPlayerIds.length} recording
          {room.submittedPlayerIds.length === 1 ? '' : 's'} received
        </p>
      )}
    </Stage>
  );
}

export function PlaybackPhase({ room }: PhaseProps) {
  const pb = room.playback;
  const item = pb?.items[pb.index];
  // Dub mode: the voices wait for the video on this device, instead of a time set in advance.
  const scene = useDubScene((s) => (s.startsAt === pb?.startsAt ? s.sceneStartsAt : undefined));
  useScheduledSound(item?.kind === 'reference' ? item.url : undefined, pb?.startsAt);
  useScheduledPerformance(
    room,
    item?.kind === 'performance' ? item.performance : undefined,
    room.reference?.video ? scene : pb?.startsAt,
  );
  const now = useServerNow(100);
  if (!pb || !item) return null;
  const teams = !!room.teams;
  const dub = !!room.reference?.video;
  const attempt = pb.items.slice(0, pb.index + 1).filter((i) => i.kind === 'performance').length;
  const total = pb.items.filter((i) => i.kind === 'performance').length;

  // Pause before the first sound.
  if (pb.index === 0 && now < pb.startsAt) {
    return (
      <Stage testId="playback">
        <Headline>
          {dub
            ? 'Here comes the mashup!'
            : teams
              ? 'Here come the teams!'
              : 'Here come the attempts!'}
        </Headline>
        {!dub && (
          <Lead>
            {pb.items[0]?.kind === 'reference' ? 'The original first, then ' : ''}
            {total}{' '}
            {teams ? (total === 1 ? 'team' : 'teams') : total === 1 ? 'attempt' : 'attempts'}.
          </Lead>
        )}
      </Stage>
    );
  }

  const lines = room.reference?.lines;
  return (
    <Stage testId="playback">
      {item.kind === 'reference' ? (
        <div key="reference" className="flex animate-enter flex-col items-center gap-3">
          <Lead>The original, one more time</Lead>
          <Headline>{room.reference?.label}</Headline>
        </div>
      ) : (
        <div key={item.performance.id} className="flex animate-enter flex-col items-center gap-3">
          <Lead>
            {dub ? 'Everyone at once' : `${teams ? 'Team' : 'Attempt'} ${attempt} of ${total}`}
          </Lead>
          <div className="font-display text-3xl font-extrabold sm:text-4xl">
            <PlayersLabel room={room} playerIds={item.performance.playerIds} size="lg" />
          </div>
          {!dub && item.performance.id === room.myPerformanceId && (
            <p className="text-sm font-semibold text-accent">
              {item.performance.playerIds.length > 1 ? 'That’s your team!' : 'That’s you!'}
            </p>
          )}
        </div>
      )}
      <div className="flex w-full max-w-lg flex-col gap-2">
        {teams && lines?.length ? (
          <>
            <DialogueTimeline
              lines={lines}
              durationMs={room.reference!.durationMs}
              startsAt={pb.startsAt}
            />
            <Subtitle lines={lines} ms={now - pb.startsAt} />
          </>
        ) : (
          <ProgressBar from={pb.startsAt} to={pb.startsAt + item.durationMs} />
        )}
      </div>
    </Stage>
  );
}

/** Replay and download buttons for one performance. */
function PerformanceActions({ room, performance }: { room: RoomState; performance: Performance }) {
  const [rendering, setRendering] = useState(false);
  const label = `${namesOf(room, performance.playerIds)}’s ${
    room.teams ? 'performance' : 'attempt'
  }`;
  const stitched = performance.parts.some((p) => p.role !== null);
  /** Teams: render the stitched scene to WAV. Classic: the recording as uploaded. */
  const download = async () => {
    setRendering(true);
    try {
      if (stitched) {
        const blob = await renderSegments(segmentsOf(room, performance), performance.durationMs);
        saveBlob(blob, `${recordingName(room, performance)}.wav`);
      } else {
        await downloadRecording(performance.parts[0]!.url, recordingName(room, performance));
      }
    } catch (err) {
      console.warn('[download] failed', err);
    } finally {
      setRendering(false);
    }
  };
  return (
    <>
      <PlayButton
        label={`Replay ${label}`}
        onClick={() => replaySegments(segmentsOf(room, performance))}
      />
      <DownloadButton
        label={`Download ${label}`}
        busy={rendering}
        onClick={() => void download()}
      />
    </>
  );
}

export function VotingPhase({ room, me }: PhaseProps) {
  const [selected, setSelected] = useState<string[]>(room.myVotes);
  const [error, setError] = useState<string | null>(null);
  const sent = me ? room.votedPlayerIds.includes(me.id) : false;
  const canVote = !!me && !me.isSpectator;
  const teams = !!room.teams;

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_VOTES_PER_PLAYER ? [...s, id] : s,
    );
  const submit = async () => {
    setError(null);
    const ack = await castVote(selected);
    if (!ack.ok) setError(errorMessage(ack.error));
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <Lead className="text-center">
        {canVote
          ? `Pick your favorite ${teams ? 'teams' : 'attempts'} (up to ${MAX_VOTES_PER_PLAYER}).`
          : 'The players are voting…'}
      </Lead>
      <ul className={`grid gap-2 ${teams ? '' : 'sm:grid-cols-2'}`} data-testid="vote-list">
        {room.performances.map((perf, i) => {
          const mine = perf.id === room.myPerformanceId;
          const isSelected = selected.includes(perf.id);
          return (
            <li
              key={perf.id}
              style={{ animationDelay: `${i * 40}ms` } as CSSProperties}
              className={`flex animate-enter items-center gap-2.5 rounded-control border px-3 py-2.5 transition ${
                isSelected
                  ? 'border-accent bg-accent/10 shadow-accent'
                  : 'border-line bg-surface-raised/50'
              }`}
            >
              <PerformanceActions room={room} performance={perf} />
              <span className="min-w-0 flex-1 font-semibold">
                <PlayersLabel room={room} playerIds={perf.playerIds} />
                {mine && (
                  <span className="text-sm font-normal text-muted">
                    {teams ? '(your team)' : '(you)'}
                  </span>
                )}
              </span>
              {canVote && !mine && (
                <Button
                  key={isSelected ? 'on' : 'off'}
                  variant={isSelected ? 'primary' : 'secondary'}
                  size="sm"
                  className={isSelected ? 'animate-bump' : ''}
                  onClick={() => toggle(perf.id)}
                  aria-pressed={isSelected}
                >
                  {isSelected ? '★ Voted' : 'Vote'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {canVote && (
        <div className="flex flex-col items-center gap-2">
          <Button size="lg" onClick={() => void submit()} className="w-full max-w-xs">
            {sent ? 'Update my votes' : selected.length ? 'Send my votes' : 'Skip voting'}
          </Button>
          {sent && (
            <p className="text-sm font-medium text-success">Votes sent. Waiting for the others…</p>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <p className="text-center text-sm text-muted">
        {room.votedPlayerIds.length} / {room.players.filter((p) => !p.isSpectator).length} voted
      </p>
    </div>
  );
}

export function RoundResultsPhase({ room }: PhaseProps) {
  const results = room.roundResults ?? [];
  const best = Math.max(0, ...results.map((r) => r.votes));
  if (results.length === 0) {
    return (
      <Stage>
        <Lead>Nobody recorded anything this round!</Lead>
      </Stage>
    );
  }
  return (
    <div className="flex flex-col gap-3 pt-4">
      <Lead className="text-center">Votes this round</Lead>
      <ul className="flex flex-col gap-2" data-testid="round-results">
        {results.map((r, i) => {
          const perf = room.performances.find((p) => p.id === r.performanceId);
          const top = best > 0 && r.votes === best;
          return (
            <li
              key={r.performanceId}
              style={{ animationDelay: `${i * 60}ms` } as CSSProperties}
              className={`flex animate-enter items-center gap-2.5 rounded-control border px-3 py-2.5 ${
                top ? 'border-accent/60 bg-accent/10' : 'border-line bg-surface-raised/50'
              }`}
            >
              {perf && <PerformanceActions room={room} performance={perf} />}
              <span className="flex min-w-0 flex-1 items-center gap-1 font-semibold">
                {top && <span aria-hidden>👑</span>}
                <PlayersLabel room={room} playerIds={r.playerIds} />
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 font-display font-bold tabular-nums ${
                  r.votes > 0 ? 'bg-accent text-accent-ink' : 'bg-surface-raised text-muted'
                }`}
              >
                +{r.votes} {r.votes === 1 ? 'vote' : 'votes'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];
/** Podium blocks: 1st is tallest; colors gold, silver, bronze. */
const BLOCK = {
  1: { height: 'h-28 sm:h-32', color: 'from-amber-300 to-amber-500 text-amber-950' },
  2: { height: 'h-20 sm:h-24', color: 'from-slate-200 to-slate-400 text-slate-900' },
  3: { height: 'h-14 sm:h-16', color: 'from-orange-300 to-orange-600 text-orange-950' },
} as const;

export function FinalResults({ room, me }: PhaseProps) {
  // Dub mode: nobody won.
  if (room.settings.mode === 'dub') {
    return (
      <div className="flex flex-col items-center gap-6 pt-6 pb-2" data-testid="dub-end">
        <p className="animate-pop font-display text-4xl font-black">What have you done?</p>
        {room.mashups.length > 0 && (
          <ul className="flex w-full max-w-md flex-col gap-2" data-testid="mashups">
            {room.mashups.map((m) => (
              <MashupDownload key={m.performance.id} mashup={m} />
            ))}
          </ul>
        )}
        <BackToLobby amHost={!!me?.isHost} />
      </div>
    );
  }
  const ranked = [...room.players]
    .filter((p) => !p.isSpectator)
    .sort((a, b) => b.score - a.score)
    .map((p, _i, all) => ({ ...p, rank: 1 + all.filter((o) => o.score > p.score).length }));
  const top = ranked.slice(0, 3);
  // Displayed 2nd · 1st · 3rd; the order the blocks rise: 3rd, 2nd, then 1st.
  const columns = [top[1], top[0], top[2]];
  const riseOrder = [1, 2, 0];
  // Ties for a medal beyond the three blocks.
  const alsoOnPodium = ranked.slice(3).filter((p) => p.rank <= 3);

  return (
    <div className="flex flex-col items-center gap-6 pt-6 pb-2">
      <p className="animate-pop font-display text-4xl font-black">Game over!</p>
      <ol
        className="grid w-full max-w-md grid-cols-3 items-end gap-2 sm:gap-3"
        data-testid="podium"
      >
        {columns.map((p, col) =>
          p ? (
            <li key={p.id} className="flex min-w-0 flex-col items-center gap-2">
              <Avatar player={p} size={p.rank === 1 ? 'xl' : 'lg'} />
              <span className="w-full truncate text-center font-display font-bold">
                {p.nickname}
              </span>
              <span className="text-sm text-muted tabular-nums">
                {p.score} {p.score === 1 ? 'point' : 'points'}
              </span>
              <div
                className={`flex w-full origin-bottom animate-rise items-start justify-center rounded-t-control bg-gradient-to-b pt-2 font-display text-3xl font-black ${
                  BLOCK[Math.min(p.rank, 3) as 1 | 2 | 3].height
                } ${BLOCK[Math.min(p.rank, 3) as 1 | 2 | 3].color}`}
                style={{ animationDelay: `${riseOrder[col]! * 250}ms` }}
              >
                <span aria-label={`Rank ${p.rank}`}>{MEDALS[p.rank - 1]}</span>
              </div>
            </li>
          ) : (
            <li key={`empty-${col}`} aria-hidden />
          ),
        )}
      </ol>
      {alsoOnPodium.length > 0 && (
        <p className="text-sm text-muted">
          Also on the podium:{' '}
          {alsoOnPodium.map((p) => `${MEDALS[p.rank - 1]} ${p.nickname}`).join(', ')}
        </p>
      )}
      <BackToLobby amHost={!!me?.isHost} />
    </div>
  );
}

/** One round's voices, mixed in the browser into a WAV (YouTube's video and sound aren't in it). */
function MashupDownload({ mashup }: { mashup: Mashup }) {
  const [rendering, setRendering] = useState(false);
  const [failed, setFailed] = useState(false);
  const { label, performance } = mashup;
  const download = async () => {
    setRendering(true);
    setFailed(false);
    try {
      const segments = performanceSegments(performance, null);
      saveBlob(await renderSegments(segments, performance.durationMs), `${label} - mashup.wav`);
    } catch (err) {
      console.warn('[download] failed', err);
      setFailed(true);
    } finally {
      setRendering(false);
    }
  };
  return (
    <li className="flex items-center gap-2.5 rounded-control border border-line bg-surface-raised/50 px-3 py-2.5">
      <DownloadButton
        label={`Download the mashup of “${label}”`}
        busy={rendering}
        onClick={() => void download()}
      />
      <span className="min-w-0 flex-1 truncate text-left font-semibold">{label}</span>
      {failed && <span className="text-sm text-danger">Couldn’t make the file.</span>}
    </li>
  );
}

function BackToLobby({ amHost }: { amHost: boolean }) {
  return amHost ? (
    <Button size="lg" onClick={() => void backToLobby()}>
      Back to the lobby
    </Button>
  ) : (
    <p className="text-muted">Waiting for the host to go back to the lobby…</p>
  );
}
