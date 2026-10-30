import { useEffect } from 'react';
import type { Phase, RoomState } from '@cyrp/shared';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { clearAudioCache, preload, unlockAudio, useAudioUnlock } from '../../lib/audio';
import { setDucked, useVoice } from '../../lib/voice';
import { useGame } from '../../store';
import { Header } from '../Header';
import { RoomStatus } from '../RoomStatus';
import { VoiceBar } from '../VoiceBar';
import { Avatar, Badge, Button, Card, Page } from '../ui';
import { SecondsLeft } from './bits';
import { DubVideo } from './DubVideo';
import { RoleBadge } from './teams';
import {
  FinalResults,
  PlaybackPhase,
  RecordingPhase,
  ReferencePhase,
  RoundIntro,
  RoundResultsPhase,
  VotingPhase,
} from './phases';

const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby',
  ROUND_INTRO: 'New round',
  REFERENCE: 'Listen',
  RECORDING: 'Repeat',
  PLAYBACK: 'Playback',
  VOTING: 'Vote',
  ROUND_RESULTS: 'Results',
  FINAL_RESULTS: 'Final results',
};

const PHASES = {
  LOBBY: () => null,
  ROUND_INTRO: RoundIntro,
  REFERENCE: ReferencePhase,
  RECORDING: RecordingPhase,
  PLAYBACK: PlaybackPhase,
  VOTING: VotingPhase,
  ROUND_RESULTS: RoundResultsPhase,
  FINAL_RESULTS: FinalResults,
} satisfies Record<Phase, unknown>;

/** Dub mode: when the clip plays in this phase (null: it waits), and whether it's muted. */
function clipPlay(room: RoomState): { startsAt: number | null; muted: boolean } {
  if (room.phase === 'REFERENCE') {
    return { startsAt: room.reference?.startsAt ?? null, muted: false };
  }
  if (room.phase === 'RECORDING')
    return { startsAt: room.recording?.startsAt ?? null, muted: true };
  const pb = room.playback;
  if (room.phase === 'PLAYBACK' && pb) {
    return { startsAt: pb.startsAt, muted: pb.items[pb.index]?.kind === 'performance' };
  }
  return { startsAt: null, muted: true };
}

const CLIP_PHASES: Phase[] = ['ROUND_INTRO', 'REFERENCE', 'RECORDING', 'PLAYBACK'];

export function GameView({ room }: { room: RoomState }) {
  const meId = useGame((s) => s.playerId);
  const me = room.players.find((p) => p.id === meId);
  const audioBlocked = useAudioUnlock((s) => s.blocked);
  const round = `Round ${room.round}/${room.settings.rounds}`;
  useDocumentTitle(`${room.code} · ${room.phase === 'FINAL_RESULTS' ? 'Final results' : round}`);

  // Turn voice down while game sounds play.
  useEffect(() => {
    setDucked(room.phase === 'REFERENCE' || room.phase === 'PLAYBACK');
    return () => setDucked(false);
  }, [room.phase]);

  // Decoded audio is big (MBs per clip): drop the last round's before preloading this one's.
  useEffect(() => clearAudioCache(), [room.round]);

  // Fetch and decode sounds ahead of their scheduled start.
  const toPreload = [
    room.reference?.url,
    room.reference?.backgroundUrl,
    ...room.performances.flatMap((p) => p.parts.map((part) => part.url)),
  ]
    .filter(Boolean)
    .join('|');
  useEffect(() => {
    for (const url of toPreload.split('|')) if (url) void preload(url).catch(() => {});
  }, [toPreload]);

  const Phase = PHASES[room.phase];
  const clip = room.reference?.video && CLIP_PHASES.includes(room.phase) ? room.reference : null;

  return (
    <Page>
      <RoomStatus room={room} />
      <Header code={room.code} />

      {audioBlocked && (
        <Button size="lg" onClick={() => void unlockAudio()}>
          Click to enable game sound
        </Button>
      )}

      {/* The stage: what's happening right now. Re-mounted (and animated in) on each phase. */}
      <Card className="relative overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            {room.round > 0 && room.phase !== 'FINAL_RESULTS' && (
              <p className="text-xs font-semibold tracking-wider text-muted uppercase">{round}</p>
            )}
            <h1
              className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl"
              data-testid="phase"
            >
              {PHASE_LABEL[room.phase]}
            </h1>
          </div>
          <SecondsLeft deadline={room.deadline} />
        </div>
        {/* Outside the stage: reloading the video each phase would be slow, and may mean an ad. */}
        {clip && (
          <DubVideo
            key={room.round}
            video={clip.video!}
            durationMs={clip.durationMs}
            {...clipPlay(room)}
          />
        )}
        <div key={`${room.phase}-${room.round}`} className="animate-enter">
          <Phase room={room} me={me} />
        </div>
      </Card>

      {/* Dub mode has no scores. */}
      {room.settings.mode !== 'dub' && <Scoreboard room={room} meId={meId} />}
      <VoiceBar gameMuted={room.voiceMuted} amHost={false} compact />
    </Page>
  );
}

function Scoreboard({ room, meId }: { room: RoomState; meId: string | null }) {
  const peers = useVoice((s) => s.peers);
  const roleOf = (id: string) =>
    room.teams?.flatMap((t) => t.members).find((m) => m.playerId === id)?.role;
  const players = [...room.players].sort((a, b) => b.score - a.score);
  const done = (id: string) =>
    (room.phase === 'RECORDING' && room.submittedPlayerIds.includes(id)) ||
    (room.phase === 'VOTING' && room.votedPlayerIds.includes(id));

  return (
    <Card title="Scores">
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="scoreboard">
        {players.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-control border border-line/60 bg-surface-raised/50 px-3 py-2 ${
              p.connected ? '' : 'opacity-50'
            }`}
          >
            <Avatar player={p} speaking={peers[p.id]?.speaking ?? false} />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-semibold">{p.nickname}</span>
              {p.id === meId && <span className="text-sm text-muted">(you)</span>}
              {p.isSpectator && <Badge>watching</Badge>}
              {roleOf(p.id) && <RoleBadge role={roleOf(p.id)!} />}
            </span>
            {done(p.id) && (
              <span className="animate-pop font-bold text-success" title="Done">
                ✓
              </span>
            )}
            <span
              className="min-w-8 rounded-full bg-accent/15 px-2 py-0.5 text-center font-display font-bold text-accent-strong tabular-nums"
              data-testid={`score-${p.nickname}`}
            >
              {p.score}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
