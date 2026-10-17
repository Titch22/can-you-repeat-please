import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MIN_PLAYERS, type RoomState } from '@cyrp/shared';
import { leaveRoom, startGame } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useGame } from '../store';
import { PlayerList } from './PlayerList';
import { RoomStatus } from './RoomStatus';
import { SettingsPanel } from './SettingsPanel';
import { SoundsPanel } from './SoundsPanel';
import { VoiceBar } from './VoiceBar';
import { Button, ErrorText, Page } from './ui';

export function Lobby({ room }: { room: RoomState }) {
  const navigate = useNavigate();
  const meId = useGame((s) => s.playerId);
  const amHost = room.players.some((p) => p.id === meId && p.isHost);
  const [copied, setCopied] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const enoughPlayers = room.players.filter((p) => p.connected).length >= MIN_PLAYERS;
  const selected = new Set(room.settings.selectedSoundIds);
  const enoughSounds = room.sounds.some((s) => selected.has(s.id));

  const start = async () => {
    setStartError(null);
    const ack = await startGame();
    if (!ack.ok) setStartError(errorMessage(ack.error));
  };

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
      <RoomStatus room={room} />
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

      <VoiceBar gameMuted={room.voiceMuted} amHost={amHost} />

      <div className="grid gap-4 sm:grid-cols-2">
        <PlayerList players={room.players} meId={meId} amHost={amHost} />
        <SettingsPanel settings={room.settings} editable={amHost} />
      </div>

      <SoundsPanel room={room} meId={meId} amHost={amHost} />

      <footer className="flex flex-col items-center gap-2">
        {amHost ? (
          <>
            <Button
              className="w-full max-w-xs py-3 text-lg"
              disabled={!enoughPlayers || !enoughSounds}
              onClick={() => void start()}
            >
              Start game
            </Button>
            <p className="text-sm text-slate-400">
              {!enoughPlayers
                ? `Waiting for at least ${MIN_PLAYERS} players…`
                : !enoughSounds
                  ? 'Tick at least one sound below.'
                  : `${room.settings.rounds} rounds. Have fun!`}
            </p>
            <ErrorText>{startError}</ErrorText>
          </>
        ) : (
          <p className="text-slate-400">Waiting for the host to start the game…</p>
        )}
      </footer>
    </Page>
  );
}
