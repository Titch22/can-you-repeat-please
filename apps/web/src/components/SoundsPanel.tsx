import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  MAX_CUSTOM_SOUND_MS,
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  MAX_UPLOAD_BYTES,
  SoundLabelSchema,
  type RoomState,
  type SoundRef,
} from '@cyrp/shared';
import { deleteSound, updateSettings, uploadSound } from '../lib/actions';
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
import { Button, Card, inputClass } from './ui';

/**
 * The sounds a game can use: the shared library (filtered by tags, length and name) plus this
 * room's uploads, each with a checkbox deciding whether it can come up (host only). Anyone can
 * upload; uploads vanish with the room.
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
  const uploads = room.sounds.filter((s) => s.uploadedBy);
  const all: (SoundRef & { tags?: string[] })[] = [...(library ?? []), ...uploads];
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
              disabled={uploads.length === 0}
              onClick={() => setSelected(uploads.map((s) => s.id))}
            >
              Only uploads
            </Button>
          </>
        )
      }
    >
      <UploadForm code={room.code} remaining={MAX_CUSTOM_SOUNDS_PER_ROOM - uploads.length} />

      <div className="mt-4">
        <SoundFilters
          value={filter}
          onChange={setFilter}
          tags={tagCounts(library ?? [])}
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
      {library !== null && narrowed && visible.length === 0 && (
        <p className="mt-2 text-sm text-muted">No sound matches these filters.</p>
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
  sound: SoundRef & { tags?: string[] };
  room: RoomState;
  checked: boolean;
  canToggle: boolean;
  canDelete: boolean;
  onToggle: () => void;
}) {
  const uploader = sound.uploadedBy
    ? (room.players.find((p) => p.id === sound.uploadedBy)?.nickname ?? 'someone who left')
    : null;
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
          {(sound.durationMs / 1000).toFixed(1)}s
          {uploader ? ` · by ${uploader}` : sound.tags?.length ? ` · ${sound.tags.join(', ')}` : ''}
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

/** Default sound name: the file name without extension, trimmed to the label limit. */
const labelFromFile = (f: File) =>
  f.name
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, 40) || 'Sound';

/**
 * One file: name it, then "Add sound". Several files: uploaded right away, one after another,
 * each named after its file.
 */
function UploadForm({ code, remaining }: { code: string; remaining: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // The file currently in the form, readable after an await (state would be stale there).
  const current = useRef<File | null>(null);
  const choose = (f: File | null) => {
    current.current = f;
    setFile(f);
  };
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = ''; // allow picking the same files again
    if (picked.length === 0) return;
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = picked.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    const problems = tooBig.map((f) =>
      picked.length === 1
        ? errorMessage('FILE_TOO_LARGE')
        : `${f.name}: ${errorMessage('FILE_TOO_LARGE')}`,
    );
    setErrors(problems);
    if (ok.length === 1 && picked.length === 1) {
      choose(ok[0]!);
      setLabel(labelFromFile(ok[0]!));
    } else if (ok.length > 0) {
      void uploadAll(ok, problems);
    }
  };

  const uploadAll = async (files: File[], problems: string[]) => {
    choose(null);
    setBusy(true);
    const failed = [...problems];
    for (const [i, f] of files.entries()) {
      setProgress({ done: i, total: files.length });
      const result = await uploadSound(code, f, labelFromFile(f));
      if (!result.ok) {
        failed.push(`${f.name}: ${errorMessage(result.error)}`);
        // The room is full: the remaining files would all fail the same way.
        if (result.error === 'TOO_MANY_SOUNDS' || result.error === 'WRONG_PHASE') break;
      }
    }
    setProgress(null);
    setBusy(false);
    setErrors(failed);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    const sent = file;
    const result = await uploadSound(code, sent, label.trim());
    setBusy(false);
    if (result.ok) {
      // Only clear the form if no other file was picked while this one was uploading.
      if (current.current === sent) {
        choose(null);
        setLabel('');
      }
    } else {
      setErrors([errorMessage(result.error)]);
    }
  };

  const labelOk = SoundLabelSchema.safeParse(label).success;

  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong bg-surface-sunken/40 p-3">
      <input
        ref={input}
        type="file"
        multiple
        accept="audio/*,.mp3,.ogg,.wav,.webm,.m4a"
        className="hidden"
        onChange={pick}
        data-testid="sound-file"
      />
      {file ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            aria-label="Sound name"
            className={`${inputClass} min-w-0 flex-1 py-2`}
          />
          <Button onClick={() => void submit()} disabled={!labelOk || busy}>
            {busy ? 'Uploading…' : 'Add sound'}
          </Button>
          <Button variant="ghost" onClick={() => choose(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Bring your own sounds (pick several at once if you like): {MAX_CUSTOM_SOUND_MS / 1000}s
            max, {MAX_UPLOAD_BYTES / 1024 / 1024} MB max each. They’re deleted when the lobby
            closes.
          </p>
          <Button
            variant="secondary"
            disabled={remaining <= 0 || busy}
            onClick={() => input.current?.click()}
          >
            {progress
              ? `Uploading ${progress.done + 1} of ${progress.total}…`
              : remaining > 0
                ? 'Upload a sound'
                : 'Upload limit reached'}
          </Button>
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-sm text-danger">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
