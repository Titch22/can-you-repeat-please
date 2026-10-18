import { MAX_PLAYERS, type Player } from '@cyrp/shared';
import { kickPlayer } from '../lib/actions';
import { setPeerVolume, useVoice } from '../lib/voice';
import { MicOffIcon } from './icons';
import { Avatar, Badge, Button, Card } from './ui';

export function PlayerList({
  players,
  meId,
  amHost,
}: {
  players: Player[];
  meId: string | null;
  amHost: boolean;
}) {
  return (
    <Card title="Players" subtitle={`${players.length}/${MAX_PLAYERS}`}>
      <ul className="flex flex-col gap-2" data-testid="player-list">
        {players.map((p) => (
          <PlayerRow key={p.id} player={p} isMe={p.id === meId} canKick={amHost && p.id !== meId} />
        ))}
      </ul>
    </Card>
  );
}

function PlayerRow({
  player: p,
  isMe,
  canKick,
}: {
  player: Player;
  isMe: boolean;
  canKick: boolean;
}) {
  const voice = useVoice((s) => s.peers[p.id]);
  const volume = useVoice((s) => s.volumes[p.id] ?? 1);
  const speaking = voice?.speaking ?? false;

  return (
    <li
      className={`flex animate-enter flex-col gap-2 rounded-control border border-line/60 bg-surface-raised/50 px-3 py-2.5 transition-opacity ${
        p.connected ? '' : 'opacity-50'
      }`}
      data-testid={`player-${p.nickname}`}
    >
      <div className="flex items-center gap-3">
        <Avatar player={p} speaking={speaking}>
          {voice && !voice.micOn && (
            <span
              className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-bg text-danger"
              title="Mic off"
            >
              <MicOffIcon className="size-2.5" />
            </span>
          )}
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold">{p.nickname}</span>
          {isMe && <span className="text-sm text-muted">(you)</span>}
          {p.isHost && <Badge tone="accent">host</Badge>}
          {!p.connected && <Badge>reconnecting…</Badge>}
          {p.connected && !voice && <span className="text-xs text-subtle">no voice</span>}
        </span>
        {canKick && (
          <Button variant="danger" size="sm" onClick={() => void kickPlayer(p.id)}>
            Kick
          </Button>
        )}
      </div>
      {/* Always rendered for others (disabled until their voice connects), so rows don't grow
          when someone joins voice and shift the page under the user's cursor. */}
      {!isMe && (
        <label
          className={`flex items-center gap-2 pl-12 text-xs text-muted ${voice ? '' : 'opacity-40'}`}
        >
          <span aria-hidden>Vol</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={volume}
            onChange={(e) => setPeerVolume(p.id, Number(e.target.value))}
            disabled={!voice}
            aria-label={`Volume of ${p.nickname}`}
            className={`h-1.5 flex-1 cursor-pointer disabled:cursor-default ${volume > 1 ? '' : 'grayscale'}`}
          />
          <span
            className={`w-10 text-right tabular-nums ${volume > 1 ? 'font-semibold text-accent' : ''}`}
            data-testid={`volume-${p.nickname}`}
          >
            {Math.round(volume * 100)}%
          </span>
        </label>
      )}
    </li>
  );
}
