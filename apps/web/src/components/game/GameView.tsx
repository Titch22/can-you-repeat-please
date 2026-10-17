import { useEffect } from 'react';
import type { Phase, RoomState } from '@cyrp/shared';
import { preload, unlockAudio, useAudioUnlock } from '../../lib/audio';
import { setDucked, useVoice } from '../../lib/voice';
import { useGame } from '../../store';
import { RoomStatus } from '../RoomStatus';
import { VoiceBar } from '../VoiceBar';
import { Button, Card, Page } from '../ui';
import { Avatar, SecondsLeft } from './bits';
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

export function GameView({ room }: { room: RoomState }) {
  const meId = useGame((s) => s.playerId);
  const me = room.players.find((p) => p.id === meId);
  const audioBlocked = useAudioUnlock((s) => s.blocked);

  // Turn voice down while game sounds play.
  useEffect(() => {
    setDucked(room.phase === 'REFERENCE' || room.phase === 'PLAYBACK');
    return () => setDucked(false);
  }, [room.phase]);

  // Fetch and decode sounds ahead of their scheduled start.
  const toPreload = [
    room.reference?.url,
    ...(room.playback?.items.map((i) => i.url) ?? []),
    ...room.clips.map((c) => c.url),
  ]
    .filter(Boolean)
    .join('|');
  useEffect(() => {
    for (const url of toPreload.split('|')) if (url) void preload(url).catch(() => {});
  }, [toPreload]);

  const Phase = PHASES[room.phase];

  return (
    <Page>
      <RoomStatus room={room} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            Room <span className="font-mono">{room.code}</span>
            {room.round > 0 && ` · Round ${room.round}/${room.settings.rounds}`}
          </p>
          <h1 className="text-2xl font-black" data-testid="phase">
            {PHASE_LABEL[room.phase]}
          </h1>
        </div>
        <p className="text-2xl font-bold text-slate-300">
          <SecondsLeft deadline={room.deadline} />
        </p>
      </header>

      {audioBlocked && (
        <Button onClick={() => void unlockAudio()}>Click to enable game sound</Button>
      )}

      <Card>
        <Phase room={room} me={me} />
      </Card>

      <Scoreboard room={room} meId={meId} />
      <VoiceBar gameMuted={room.voiceMuted} amHost={false} compact />
    </Page>
  );
}

function Scoreboard({ room, meId }: { room: RoomState; meId: string | null }) {
  const peers = useVoice((s) => s.peers);
  const players = [...room.players].sort((a, b) => b.score - a.score);
  const done = (id: string) =>
    (room.phase === 'RECORDING' && room.submittedPlayerIds.includes(id)) ||
    (room.phase === 'VOTING' && room.votedPlayerIds.includes(id));

  return (
    <Card>
      <h2 className="mb-3 font-bold">Scores</h2>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="scoreboard">
        {players.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-2 ${
              p.connected ? '' : 'opacity-50'
            }`}
          >
            <span
              className={`rounded-full ${
                peers[p.id]?.speaking
                  ? 'ring-[3px] ring-emerald-400 ring-offset-2 ring-offset-slate-800'
                  : ''
              }`}
            >
              <Avatar player={p} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.nickname}
              {p.id === meId && <span className="text-slate-400"> (you)</span>}
              {p.isSpectator && <span className="ml-2 text-xs text-slate-400">watching</span>}
            </span>
            {done(p.id) && (
              <span className="text-emerald-400" title="Done">
                ✓
              </span>
            )}
            <span className="font-bold tabular-nums" data-testid={`score-${p.nickname}`}>
              {p.score}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
