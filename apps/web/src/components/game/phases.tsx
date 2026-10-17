import { useEffect, useState } from 'react';
import { MAX_VOTES_PER_PLAYER, type Player, type RoomState } from '@cyrp/shared';
import { useRecorder, type RecorderStatus } from '../../hooks/useRecorder';
import { backToLobby, castVote } from '../../lib/actions';
import { playAt, replay } from '../../lib/audio';
import { useServerNow } from '../../lib/clock';
import { errorMessage } from '../../lib/errors';
import { Button, ErrorText } from '../ui';
import { Avatar, PlayButton, ProgressBar } from './bits';

interface PhaseProps {
  room: RoomState;
  me: Player | undefined;
}

/** The player who made a clip; they may have left the room since. */
function authorOf(room: RoomState, playerId: string | null) {
  return (
    room.players.find((p) => p.id === playerId) ?? {
      nickname: 'Someone who left',
      color: '#64748b',
    }
  );
}

/** Plays `url` for everyone at `startsAt` (server time) while mounted. */
function useScheduledSound(url: string | undefined, startsAt: number | undefined) {
  useEffect(() => {
    if (!url || startsAt === undefined) return;
    return playAt(url, startsAt);
  }, [url, startsAt]);
}

export function RoundIntro({ room }: PhaseProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-slate-400">Get ready…</p>
      <p className="text-5xl font-black">
        Round {room.round}
        <span className="text-slate-500">/{room.settings.rounds}</span>
      </p>
    </div>
  );
}

export function ReferencePhase({ room }: PhaseProps) {
  const ref = room.reference;
  useScheduledSound(ref?.url, ref?.startsAt);
  const now = useServerNow(100);
  if (!ref) return null;
  const playing = now >= ref.startsAt;
  const ended = now >= ref.startsAt + ref.durationMs;
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <p className={ended ? 'font-bold text-amber-300' : 'text-slate-400'}>
        {ended ? 'Get ready to repeat it!' : playing ? 'Listen carefully!' : 'Here it comes…'}
      </p>
      <p className="text-4xl font-black">{ref.label}</p>
      <div className="w-full max-w-sm">
        <ProgressBar from={ref.startsAt} to={ref.startsAt + ref.durationMs} />
      </div>
    </div>
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

export function RecordingPhase({ room, me }: PhaseProps) {
  const canRecord = !!me && !me.isSpectator;
  const { status, level } = useRecorder(room, canRecord);
  const now = useServerNow(100);
  const rec = room.recording;
  if (!rec) return null;

  if (!canRecord) {
    return (
      <p className="py-10 text-center text-slate-400">
        The players are recording… You’ll join in the next game.
      </p>
    );
  }

  const countdown = Math.ceil((rec.startsAt - now) / 1000);
  return (
    <div className="flex flex-col items-center gap-5 py-8 text-center" data-testid="recorder">
      <p className="text-slate-400">Everyone is muted while recording.</p>
      {now >= rec.endsAt && <p className="text-5xl font-black">Time’s up!</p>}
      {status === 'countdown' && countdown > 0 ? (
        <p className="text-7xl font-black tabular-nums">{countdown}</p>
      ) : (
        <p
          className={`text-3xl font-black ${status === 'recording' ? 'text-rose-400' : ''}`}
          data-status={status}
        >
          {status === 'recording' && (
            <span className="mr-3 inline-block size-4 animate-pulse rounded-full bg-rose-500" />
          )}
          {RECORDER_TEXT[status]}
        </p>
      )}
      {status === 'recording' && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <ProgressBar from={rec.startsAt} to={rec.endsAt} color="bg-rose-500" />
          <div className="h-3 overflow-hidden rounded-full bg-slate-800" aria-label="Mic level">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-75"
              style={{ width: `${level * 100}%` }}
            />
          </div>
        </div>
      )}
      {status !== 'recording' && status !== 'countdown' && (
        <p className="text-sm text-slate-400">
          {room.submittedPlayerIds.length} recording
          {room.submittedPlayerIds.length === 1 ? '' : 's'} received
        </p>
      )}
    </div>
  );
}

export function PlaybackPhase({ room }: PhaseProps) {
  const pb = room.playback;
  const item = pb?.items[pb.index];
  useScheduledSound(item?.url, pb?.startsAt);
  const now = useServerNow(100);
  if (!pb || !item) return null;
  const attempt = pb.items.slice(0, pb.index + 1).filter((i) => i.kind === 'clip').length;
  const total = pb.items.filter((i) => i.kind === 'clip').length;

  // Pause before the first sound.
  if (pb.index === 0 && now < pb.startsAt) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="playback">
        <p className="text-4xl font-black">Here come the attempts!</p>
        <p className="text-slate-400">
          The original first, then {total} {total === 1 ? 'attempt' : 'attempts'}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center" data-testid="playback">
      {item.kind === 'reference' ? (
        <>
          <p className="text-slate-400">The original, one more time</p>
          <p className="text-4xl font-black">{room.reference?.label}</p>
        </>
      ) : (
        <>
          <p className="text-slate-400">
            Attempt {attempt} of {total}
          </p>
          <p className="flex items-center gap-3 text-4xl font-black">
            <Avatar player={authorOf(room, item.playerId)} size="size-11" />
            {authorOf(room, item.playerId).nickname}
          </p>
          {item.clipId === room.myClipId && <p className="text-sm text-amber-300">That’s you!</p>}
        </>
      )}
      <div className="w-full max-w-sm">
        <ProgressBar from={pb.startsAt} to={pb.startsAt + item.durationMs} />
      </div>
    </div>
  );
}

export function VotingPhase({ room, me }: PhaseProps) {
  const [selected, setSelected] = useState<string[]>(room.myVotes);
  const [error, setError] = useState<string | null>(null);
  const sent = me ? room.votedPlayerIds.includes(me.id) : false;
  const canVote = !!me && !me.isSpectator;

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
    <div className="flex flex-col gap-4">
      <p className="text-center text-slate-400">
        {canVote
          ? `Pick your favorite attempts (up to ${MAX_VOTES_PER_PLAYER}).`
          : 'The players are voting…'}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="vote-list">
        {room.clips.map((clip) => {
          const mine = clip.id === room.myClipId;
          const author = authorOf(room, clip.playerId);
          const isSelected = selected.includes(clip.id);
          return (
            <li
              key={clip.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                isSelected ? 'border-amber-400 bg-amber-400/10' : 'border-slate-800 bg-slate-800/60'
              }`}
            >
              <PlayButton
                label={`Replay ${author.nickname}’s attempt`}
                onClick={() => replay(clip.url)}
              />
              <Avatar player={author} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {author.nickname}
                {mine && <span className="ml-2 text-sm font-normal text-slate-400">(you)</span>}
              </span>
              {canVote && !mine && (
                <Button
                  variant={isSelected ? 'primary' : 'secondary'}
                  className="px-3 py-1.5 text-sm"
                  onClick={() => toggle(clip.id)}
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
          <Button onClick={() => void submit()} className="w-full max-w-xs">
            {sent ? 'Update my votes' : selected.length ? 'Send my votes' : 'Skip voting'}
          </Button>
          {sent && <p className="text-sm text-emerald-300">Votes sent. Waiting for the others…</p>}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <p className="text-center text-sm text-slate-400">
        {room.votedPlayerIds.length} / {room.players.filter((p) => !p.isSpectator).length} voted
      </p>
    </div>
  );
}

export function RoundResultsPhase({ room }: PhaseProps) {
  const results = room.roundResults ?? [];
  const best = Math.max(0, ...results.map((r) => r.votes));
  if (results.length === 0) {
    return <p className="py-10 text-center text-slate-400">Nobody recorded anything this round!</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-slate-400">Votes this round</p>
      <ul className="flex flex-col gap-2" data-testid="round-results">
        {results.map((r) => {
          const author = authorOf(room, r.playerId);
          return (
            <li
              key={r.clipId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                best > 0 && r.votes === best ? 'bg-amber-400/15' : 'bg-slate-800/60'
              }`}
            >
              <PlayButton
                label={`Replay ${author.nickname}’s attempt`}
                onClick={() => replay(r.url)}
              />
              <Avatar player={author} />
              <span className="flex-1 truncate font-semibold">{author.nickname}</span>
              <span className="font-bold tabular-nums">
                +{r.votes} {r.votes === 1 ? 'vote' : 'votes'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FinalResults({ room, me }: PhaseProps) {
  const ranked = [...room.players]
    .filter((p) => !p.isSpectator)
    .sort((a, b) => b.score - a.score)
    .map((p, _i, all) => ({ ...p, rank: 1 + all.filter((o) => o.score > p.score).length }));
  const podium = ranked.filter((p) => p.rank <= 3);
  const medal = ['🥇', '🥈', '🥉'];

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <p className="text-3xl font-black">Game over!</p>
      <ol className="flex w-full max-w-md flex-col gap-2" data-testid="podium">
        {podium.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
              p.rank === 1 ? 'bg-amber-400/15 text-lg' : 'bg-slate-800/60'
            }`}
          >
            <span aria-label={`Rank ${p.rank}`}>{medal[p.rank - 1]}</span>
            <Avatar player={p} />
            <span className="flex-1 truncate font-bold">{p.nickname}</span>
            <span className="tabular-nums">
              {p.score} {p.score === 1 ? 'point' : 'points'}
            </span>
          </li>
        ))}
      </ol>
      {me?.isHost ? (
        <Button onClick={() => void backToLobby()}>Back to the lobby</Button>
      ) : (
        <p className="text-slate-400">Waiting for the host to go back to the lobby…</p>
      )}
    </div>
  );
}
