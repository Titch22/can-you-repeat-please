import { MAX_PLAYERS, type Player } from '@cyrp/shared';
import { kickPlayer } from '../lib/actions';
import { Button, Card } from './ui';

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
    <Card>
      <h2 className="mb-3 flex items-baseline justify-between font-bold">
        Players
        <span className="text-sm font-normal text-slate-400">
          {players.length}/{MAX_PLAYERS}
        </span>
      </h2>
      <ul className="flex flex-col gap-2" data-testid="player-list">
        {players.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-2 ${
              p.connected ? '' : 'opacity-50'
            }`}
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full font-bold text-slate-950"
              style={{ backgroundColor: p.color }}
              aria-hidden
            >
              {p.nickname[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.nickname}
              {p.id === meId && <span className="text-slate-400"> (you)</span>}
              {p.isHost && (
                <span className="ml-2 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-300">
                  host
                </span>
              )}
              {!p.connected && <span className="ml-2 text-xs text-slate-400">reconnecting…</span>}
            </span>
            {amHost && p.id !== meId && (
              <Button
                variant="danger"
                className="px-2 py-1 text-sm"
                onClick={() => void kickPlayer(p.id)}
              >
                Kick
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
