import { MIN_PLAYERS, type RoomState } from '@cyrp/shared';
import { useGame } from '../store';

type Tone = 'ok' | 'listen' | 'muted' | 'warn';

const TONES: Record<Tone, { bar: string; dot: string }> = {
  ok: { bar: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100', dot: 'bg-emerald-400' },
  listen: { bar: 'border-amber-400/30 bg-amber-400/10 text-amber-100', dot: 'bg-amber-400' },
  muted: {
    bar: 'border-rose-500/40 bg-rose-500/15 text-rose-100',
    dot: 'bg-rose-500 animate-pulse',
  },
  warn: {
    bar: 'border-amber-400/40 bg-amber-400/10 text-amber-100',
    dot: 'bg-amber-400 animate-pulse',
  },
};

/** What the room is doing right now, in one line. */
export function roomStatus(room: RoomState, connected: boolean): { tone: Tone; text: string } {
  if (!connected) return { tone: 'warn', text: 'Connection lost, reconnecting…' };
  if (room.voiceMuted) {
    return {
      tone: 'muted',
      text: room.phase === 'RECORDING' ? 'Everyone is muted · recording' : 'Everyone is muted',
    };
  }
  const round = `Round ${room.round}/${room.settings.rounds}`;
  switch (room.phase) {
    case 'LOBBY': {
      const online = room.players.filter((p) => p.connected).length;
      return online < MIN_PLAYERS
        ? { tone: 'warn', text: `Room open · waiting for players (${online}/${MIN_PLAYERS})` }
        : { tone: 'ok', text: `Room open · ${online} players · voice chat on` };
    }
    case 'ROUND_INTRO':
      return { tone: 'ok', text: `${round} starting · voice chat on` };
    case 'REFERENCE':
    case 'PLAYBACK':
      return { tone: 'listen', text: `${round} · voice turned down · listen!` };
    case 'RECORDING':
      return { tone: 'muted', text: 'Everyone is muted · recording' };
    case 'VOTING':
      return { tone: 'ok', text: `${round} · voting · voice chat on` };
    case 'ROUND_RESULTS':
      return { tone: 'ok', text: `${round} · results · voice chat on` };
    case 'FINAL_RESULTS':
      return { tone: 'ok', text: 'Game over · voice chat on' };
  }
}

/** Always-visible status bar, pinned to the top of the lobby and game screens. */
export function RoomStatus({ room }: { room: RoomState }) {
  const connected = useGame((s) => s.connected);
  const meId = useGame((s) => s.playerId);
  const watching = room.players.some((p) => p.id === meId && p.isSpectator);
  const { tone, text } = roomStatus(room, connected);
  const t = TONES[tone];
  return (
    <div className="sticky top-12 z-10 -mx-4 bg-bg/80 px-4 pt-2 pb-2 backdrop-blur-md">
      <p
        role="status"
        data-testid="room-status"
        data-tone={tone}
        className={`flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${t.bar}`}
      >
        <span className={`size-2.5 shrink-0 rounded-full ${t.dot}`} aria-hidden />
        <span className="truncate">
          {text}
          {watching && ' · you’re watching this game'}
        </span>
      </p>
    </div>
  );
}
