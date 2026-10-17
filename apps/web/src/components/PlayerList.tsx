import { MAX_PLAYERS, type Player } from '@cyrp/shared';
import { kickPlayer } from '../lib/actions';
import { setPeerVolume, useVoice } from '../lib/voice';
import { MicOffIcon } from './icons';
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
      className={`flex flex-col gap-2 rounded-xl bg-slate-800/60 px-3 py-2 ${
        p.connected ? '' : 'opacity-50'
      }`}
      data-testid={`player-${p.nickname}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative grid size-9 shrink-0 place-items-center rounded-full font-bold text-slate-950 transition ${
            speaking ? 'ring-[3px] ring-emerald-400 ring-offset-2 ring-offset-slate-800' : ''
          }`}
          style={{ backgroundColor: p.color }}
          data-speaking={speaking}
          aria-hidden
        >
          {p.nickname[0]?.toUpperCase()}
          {voice && !voice.micOn && (
            <span
              className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-slate-950 text-rose-400"
              title="Mic off"
            >
              <MicOffIcon className="size-2.5" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {p.nickname}
          {isMe && <span className="text-slate-400"> (you)</span>}
          {p.isHost && (
            <span className="ml-2 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-300">
              host
            </span>
          )}
          {!p.connected && <span className="ml-2 text-xs text-slate-400">reconnecting…</span>}
          {p.connected && !voice && <span className="ml-2 text-xs text-slate-500">no voice</span>}
        </span>
        {canKick && (
          <Button
            variant="danger"
            className="px-2 py-1 text-sm"
            onClick={() => void kickPlayer(p.id)}
          >
            Kick
          </Button>
        )}
      </div>
      {/* Always rendered for others (disabled until their voice connects), so rows don't grow
          when someone joins voice and shift the page under the user's cursor. */}
      {!isMe && (
        <label
          className={`flex items-center gap-2 pl-12 text-xs text-slate-400 ${voice ? '' : 'opacity-40'}`}
        >
          <span className="sr-only">Volume of {p.nickname}</span>
          <span aria-hidden>Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setPeerVolume(p.id, Number(e.target.value))}
            disabled={!voice}
            className="h-1 flex-1 accent-slate-400"
          />
        </label>
      )}
    </li>
  );
}
