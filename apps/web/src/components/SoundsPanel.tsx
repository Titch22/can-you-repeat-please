import { useEffect, useState, type MouseEvent } from 'react';
import {
  MAX_CUSTOM_SOUND_MS,
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  isDialogue,
  type RoomState,
  type SoundRef,
} from '@cyrp/shared';
import { Link } from 'react-router';
import { useAccount } from '../lib/account';
import {
  deleteSound,
  fetchSharedSounds,
  shareSounds,
  updateSettings,
  uploadSound,
} from '../lib/actions';
import { replay } from '../lib/audio';
import { errorMessage } from '../lib/errors';
import { useLibrary } from '../lib/library';
import { PlayButton } from './game/bits';
import {
  isFiltered,
  matchesBasics,
  NO_FILTER,
  SoundFilters,
  tagCounts,
  type SoundFilter,
} from './SoundFilters';
import { SoundAdder } from './SoundAdder';
import { Button, Card } from './ui';

/** A sound shared by a player (their own sounds, from /sounds): `sharedBy` is their id. */
type Listed = SoundRef & { sharedBy?: string };

/**
 * The sounds a game can use: the shared library (filtered by tags, length and name), the own
 * sounds of the players sharing theirs, and this room's uploads, each with a checkbox deciding
 * whether it can come up (host only). Anyone can upload; uploads vanish with the room.
 */
export function SoundsPanel({
  room,
  meId,
  amHost,
}: {
  room: RoomState;
  meId: string | null;
  amHost: boolean;
}) {
  const library = useLibrary((s) => s.sounds);
  const libraryError = useLibrary((s) => s.error);
  useEffect(() => {
    void useLibrary.getState().load();
  }, []);

  // Players' shared sounds: reloaded when someone starts or stops sharing (joins, leaves).
  const sharingKey = room.players
    .filter((p) => p.sharesSounds)
    .map((p) => p.id)
    .join('|');
  const [shared, setShared] = useState<Listed[]>([]);
  useEffect(() => {
    let live = true;
    void fetchSharedSounds(room.code).then(
      (list) =>
        live &&
        setShared(
          list.flatMap((s) => s.sounds.map((sound) => ({ ...sound, sharedBy: s.playerId }))),
        ),
    );
    return () => {
      live = false;
    };
  }, [room.code, sharingKey]);

  // Optimistic selection: the checkbox flips right away. It's only trusted while the server's
  // selection is still the one it was based on; the next server update replaces it.
  const serverKey = room.settings.selectedSoundIds.join('|');
  const [optimistic, setOptimistic] = useState<{ base: string; ids: string[] } | null>(null);
  const selectedIds =
    optimistic && optimistic.base === serverKey ? optimistic.ids : room.settings.selectedSoundIds;
  const isSelected = new Set(selectedIds);

  const [filter, setFilter] = useState<SoundFilter>(NO_FILTER);
  // The "uploaded here" chip: works like a tag that only room uploads have.
  const [roomOnly, setRoomOnly] = useState(false);
  // Teams mode only plays dialogues (library sounds tagged "team" with their lines).
  const teamsMode = room.settings.mode === 'teams';
  const uploads = teamsMode ? [] : room.sounds.filter((s) => s.uploadedBy);
  const all: Listed[] = teamsMode
    ? [...(library ?? []), ...shared].filter(isDialogue)
    : [...(library ?? []), ...shared, ...uploads];
  const tagFilterOn = filter.tags.length > 0 || roomOnly;
  const visible = all.filter((s) => {
    if (!matchesBasics(s, filter)) return false;
    if (!tagFilterOn) return true;
    if (s.uploadedBy) return roomOnly;
    return (s.tags ?? []).some((t) => filter.tags.includes(t));
  });
  const visibleIds = new Set(visible.map((s) => s.id));
  const narrowed = isFiltered(filter) || roomOnly;
  const selected = all.filter((s) => isSelected.has(s.id)).length;

  const setSelected = (ids: string[]) => {
    setOptimistic({ base: serverKey, ids });
    void updateSettings({ selectedSoundIds: ids }).then((ack) => {
      if (!ack.ok) setOptimistic(null);
    });
  };
  const toggle = (id: string) =>
    setSelected(isSelected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  return (
    <Card
      className="lg:flex lg:min-h-0 lg:flex-col"
      title="Sounds"
      subtitle={
        <span data-testid="sound-count">
          {selected} of {all.length} in the game
        </span>
      }
      actions={
        amHost && (
          <>
            <Button
              variant="ghost"
              size="sm"
              title={narrowed ? 'Tick every sound shown' : undefined}
              disabled={library === null && !libraryError}
              onClick={() => setSelected([...new Set([...selectedIds, ...visibleIds])])}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={narrowed ? 'Untick every sound shown' : undefined}
              disabled={library === null && !libraryError}
              onClick={() => setSelected(selectedIds.filter((id) => !visibleIds.has(id)))}
            >
              None
            </Button>
            <Button
              variant="ghost"
              size="sm"
              hidden={teamsMode}
              disabled={uploads.length === 0}
              onClick={() => setSelected(uploads.map((s) => s.id))}
            >
              Only uploads
            </Button>
          </>
        )
      }
    >
      {teamsMode ? (
        <p className="rounded-control border border-dashed border-line-strong bg-surface-sunken/40 p-3 text-sm text-muted">
          Teams mode plays <b className="text-ink">dialogues</b>: library sounds tagged “team” whose
          lines (who speaks when) are set. Room uploads aren’t used in this mode.
        </p>
      ) : (
        <UploadForm code={room.code} remaining={MAX_CUSTOM_SOUNDS_PER_ROOM - uploads.length} />
      )}
      <ShareMySounds sharing={!!room.players.find((p) => p.id === meId)?.sharesSounds} />

      <div className="mt-4">
        <SoundFilters
          value={filter}
          onChange={setFilter}
          tags={tagCounts(
            (teamsMode ? all : [...(library ?? []), ...shared]).map((s) => ({
              tags: s.tags ?? [],
            })),
          )}
          extraChips={
            uploads.length > 0
              ? [
                  {
                    key: 'room-uploads',
                    label: 'uploaded here',
                    count: uploads.length,
                    on: roomOnly,
                    toggle: () => setRoomOnly(!roomOnly),
                  },
                ]
              : []
          }
        />
      </div>
      {libraryError ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
          The sound library is unreachable: only this room’s uploads are listed.
          <Button variant="ghost" size="sm" onClick={() => void useLibrary.getState().load()}>
            Retry
          </Button>
        </p>
      ) : (
        library === null && <p className="mt-3 animate-pulse text-sm text-muted">Loading sounds…</p>
      )}
      {narrowed && (
        <p className="mt-2 text-xs text-subtle">
          {visible.length} shown · All / None apply to the sounds shown
        </p>
      )}

      <ul
        className="-mx-1 mt-3 grid gap-2 px-1 pb-1 sm:grid-cols-2 lg:min-h-0 lg:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] lg:content-start lg:overflow-y-auto"
        data-testid="sound-grid"
      >
        {visible.map((sound) => (
          <SoundTile
            key={sound.id}
            sound={sound}
            room={room}
            checked={isSelected.has(sound.id)}
            canToggle={amHost}
            canDelete={!!sound.uploadedBy && (amHost || sound.uploadedBy === meId)}
            onToggle={() => toggle(sound.id)}
          />
        ))}
      </ul>
      {library !== null && teamsMode && all.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No dialogue in the library yet. In /sounds, tag a scene “team” and mark its lines.
        </p>
      ) : (
        library !== null &&
        narrowed &&
        visible.length === 0 && (
          <p className="mt-2 text-sm text-muted">No sound matches these filters.</p>
        )
      )}
      {!amHost && <p className="mt-3 text-sm text-muted">The host picks which sounds are in.</p>}
    </Card>
  );
}

function SoundTile({
  sound,
  room,
  checked,
  canToggle,
  canDelete,
  onToggle,
}: {
  sound: Listed;
  room: RoomState;
  checked: boolean;
  canToggle: boolean;
  canDelete: boolean;
  onToggle: () => void;
}) {
  const nameOf = (id: string) =>
    room.players.find((p) => p.id === id)?.nickname ?? 'someone who left';
  const uploader = sound.uploadedBy ? nameOf(sound.uploadedBy) : null;
  const sharer = sound.sharedBy ? nameOf(sound.sharedBy) : null;
  // The whole tile toggles the sound (host only); its own buttons keep their action.
  const onTileClick = (e: MouseEvent<HTMLLIElement>) => {
    if (!canToggle || (e.target as HTMLElement).closest('button, input, a')) return;
    onToggle();
  };
  return (
    <li
      onClick={onTileClick}
      className={`flex items-center gap-2 rounded-control border border-l-4 py-1.5 pr-2 pl-2 transition select-none ${
        checked
          ? 'border-line-strong border-l-accent bg-surface-raised/70'
          : 'border-line border-l-transparent bg-surface-sunken/60 text-muted'
      } ${canToggle ? 'cursor-pointer hover:border-accent/50' : ''}`}
      data-testid={`sound-${sound.label}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!canToggle}
        onChange={onToggle}
        aria-label={`Use “${sound.label}” in the game`}
        className="size-4 shrink-0 cursor-pointer disabled:cursor-default"
      />
      <PlayButton label={`Play “${sound.label}”`} onClick={() => replay(sound.url)} />
      <span className="min-w-0 flex-1 leading-tight">
        <span
          className={`block truncate text-sm font-semibold ${checked ? 'text-ink' : ''}`}
          title={sound.label}
        >
          {sound.label}
        </span>
        <span className="block truncate text-xs text-subtle">
          {(sound.durationMs / 1000).toFixed(1)}s{uploader ? ` · by ${uploader}` : ''}
          {sharer ? ` · ${sharer}’s` : ''}
          {!uploader && sound.tags?.length ? ` · ${sound.tags.join(', ')}` : ''}
          {sound.lines?.length ? ` · ${sound.lines.length} lines` : ''}
        </span>
      </span>
      {canDelete && (
        <button
          type="button"
          onClick={() => void deleteSound(sound.id)}
          aria-label={`Delete “${sound.label}”`}
          title="Delete"
          className="grid size-7 shrink-0 place-items-center rounded-full text-rose-300 transition hover:bg-rose-500/15 focus-visible:shadow-glow"
        >
          ✕
        </button>
      )}
    </li>
  );
}

/** Room uploads: files or a YouTube link, each cropped in the editor. Gone with the room. */
function UploadForm({ code, remaining }: { code: string; remaining: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong bg-surface-sunken/40 p-3">
      <SoundAdder
        upload={async (file, label) => {
          const result = await uploadSound(code, file, label);
          return result.ok ? null : errorMessage(result.error);
        }}
        pickLabel="Upload a sound"
        hint={`Bring your own sounds (several at once if you like): you keep up to ${MAX_CUSTOM_SOUND_MS / 1000}s of each. They’re deleted when the lobby closes.`}
        disabledReason={remaining > 0 ? undefined : 'Upload limit reached.'}
      />
    </div>
  );
}

/** Logged-in players: put their own sounds (/sounds) in this list, for the host to pick. */
function ShareMySounds({ sharing }: { sharing: boolean }) {
  const user = useAccount((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const toggle = async (share: boolean) => {
    setError(null);
    const ack = await shareSounds(share);
    if (!ack.ok) setError(errorMessage(ack.error));
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-line bg-surface-sunken/40 px-3 py-2 text-sm">
      <label className="flex cursor-pointer items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={sharing}
          onChange={(e) => void toggle(e.target.checked)}
          className="size-4"
        />
        Share my sounds with the room
      </label>
      <Link to="/sounds" className="text-muted underline underline-offset-2 hover:text-ink">
        manage my sounds
      </Link>
      {error && (
        <span className="w-full text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
