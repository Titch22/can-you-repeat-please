import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MIN_PLAYERS, type RoomState } from '@cyrp/shared';
import { leaveRoom } from '../lib/actions';
import { useGame } from '../store';
import { PlayerList } from './PlayerList';
import { SettingsPanel } from './SettingsPanel';
import { Button, Page } from './ui';

export function Lobby({ room }: { room: RoomState }) {
  const navigate = useNavigate();
  const meId = useGame((s) => s.playerId);
  const connected = useGame((s) => s.connected);
  const amHost = room.players.some((p) => p.id === meId && p.isHost);
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${room.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is visible anyway.
    }
  };

  const leave = async () => {
    await leaveRoom();
    navigate('/');
  };

  return (
    <Page>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Room code</p>
          <p className="font-mono text-4xl font-black tracking-[0.2em]" data-testid="room-code">
            {room.code}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </Button>
          <Button variant="ghost" onClick={leave}>
            Leave
          </Button>
        </div>
      </header>

      {!connected && (
        <p className="rounded-xl bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
          Connection lost, reconnecting…
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <PlayerList players={room.players} meId={meId} amHost={amHost} />
        <SettingsPanel settings={room.settings} editable={amHost} />
      </div>

      <footer className="flex flex-col items-center gap-2">
        {amHost ? (
          <>
            <Button className="w-full max-w-xs py-3 text-lg" disabled>
              Start game
            </Button>
            <p className="text-sm text-slate-400">
              {room.players.length < MIN_PLAYERS
                ? `Waiting for at least ${MIN_PLAYERS} players…`
                : 'The game itself arrives in M3.'}
            </p>
          </>
        ) : (
          <p className="text-slate-400">Waiting for the host to start the game…</p>
        )}
      </footer>
    </Page>
  );
}
