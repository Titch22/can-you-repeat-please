import { useState } from 'react';
import {
  isDialogue,
  LIBRARY_ID_PREFIX,
  MIN_PLAYERS,
  MIN_PLAYERS_TEAMS,
  type RoomState,
} from '@cyrp/shared';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { startGame } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useLibrary } from '../lib/library';
import { useGame } from '../store';
import { Header } from './Header';
import { PlayerList } from './PlayerList';
import { RoomStatus } from './RoomStatus';
import { SettingsPanel } from './SettingsPanel';
import { SoundsPanel } from './SoundsPanel';
import { VoiceBar } from './VoiceBar';
import { Button, ErrorText, Page } from './ui';

export function Lobby({ room }: { room: RoomState }) {
  const meId = useGame((s) => s.playerId);
  const amHost = room.players.some((p) => p.id === meId && p.isHost);
  const [startError, setStartError] = useState<string | null>(null);
  const { mode } = room.settings;
  const teams = mode === 'teams';
  const minPlayers = teams ? MIN_PLAYERS_TEAMS : MIN_PLAYERS;
  const enoughPlayers = room.players.filter((p) => p.connected).length >= minPlayers;
  // Classic: a ticked library sound, or a ticked upload that still exists. Teams: a ticked
  // dialogue. Dub: a ticked clip. The server has the final say (library sounds deleted since
  // are skipped).
  const library = useLibrary((s) => s.sounds);
  const uploadIds = new Set(room.sounds.filter((s) => !s.video).map((s) => s.id));
  const clipIds = new Set(room.sounds.filter((s) => s.video).map((s) => s.id));
  const dialogueIds = new Set((library ?? []).filter(isDialogue).map((s) => s.id));
  const enoughSounds = room.settings.selectedSoundIds.some((id) =>
    mode === 'dub'
      ? clipIds.has(id)
      : teams
        ? dialogueIds.has(id)
        : id.startsWith(LIBRARY_ID_PREFIX) || uploadIds.has(id),
  );
  useDocumentTitle(`${room.code} · Lobby`);

  const start = async () => {
    setStartError(null);
    const ack = await startGame();
    if (!ack.ok) setStartError(errorMessage(ack.error));
  };

  return (
    <Page wide>
      <RoomStatus room={room} />
      <Header code={room.code} />

      {/* Phones: one column, Start sticky below the sounds. Desktop: sounds on the right in
          their own scrolling column, everything else (and Start) on the left. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <VoiceBar gameMuted={room.voiceMuted} amHost={amHost} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <PlayerList players={room.players} meId={meId} amHost={amHost} />
            <SettingsPanel settings={room.settings} editable={amHost} />
          </div>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-28 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col">
          <SoundsPanel room={room} meId={meId} amHost={amHost} />
        </aside>

        <footer className="sticky bottom-0 z-10 -mx-4 flex flex-col items-center gap-2 bg-gradient-to-t from-bg via-bg/95 to-transparent px-4 pt-6 pb-4 lg:col-start-1 lg:mx-0 lg:px-0">
          {amHost ? (
            <>
              <Button
                size="lg"
                className="w-full max-w-sm"
                disabled={!enoughPlayers || !enoughSounds}
                onClick={() => void start()}
              >
                Start game
              </Button>
              <p className="text-sm text-muted">
                {!enoughPlayers
                  ? `Waiting for at least ${minPlayers} players${teams ? ' (Teams mode)' : ''}…`
                  : !enoughSounds
                    ? teams
                      ? 'Tick at least one dialogue.'
                      : mode === 'dub'
                        ? 'Tick at least one clip.'
                        : 'Tick at least one sound.'
                    : `${room.settings.rounds} rounds. Have fun!`}
              </p>
              <ErrorText>{startError}</ErrorText>
            </>
          ) : (
            <p className="text-muted">Waiting for the host to start the game…</p>
          )}
        </footer>
      </div>
    </Page>
  );
}
