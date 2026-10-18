import { useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  MAX_CUSTOM_SOUND_MS,
  MAX_CUSTOM_SOUNDS_PER_PLAYER,
  MAX_UPLOAD_BYTES,
  SoundLabelSchema,
  type RoomState,
  type SoundRef,
} from '@cyrp/shared';
import { deleteSound, updateSettings, uploadSound } from '../lib/actions';
import { replay } from '../lib/audio';
import { errorMessage } from '../lib/errors';
import { PlayButton } from './game/bits';
import { Button, Card, ErrorText, inputClass } from './ui';

/**
 * The room's sounds: the default pack plus uploads, each with a checkbox deciding whether it
 * can come up in the game (host only). Anyone can upload; uploads vanish with the room.
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
  // Optimistic selection: the checkbox flips right away. It's only trusted while the server's
  // selection is still the one it was based on; the next server update replaces it.
  const serverKey = room.settings.selectedSoundIds.join('|');
  const [optimistic, setOptimistic] = useState<{ base: string; ids: string[] } | null>(null);
  const selectedIds =
    optimistic && optimistic.base === serverKey ? optimistic.ids : room.settings.selectedSoundIds;
  const isSelected = new Set(selectedIds);
  const selected = room.sounds.filter((s) => isSelected.has(s.id)).length;
  const uploads = room.sounds.filter((s) => s.uploadedBy);
  const myUploads = uploads.filter((s) => s.uploadedBy === meId).length;

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
          {selected} of {room.sounds.length} in the game
        </span>
      }
      actions={
        amHost && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(room.sounds.map((s) => s.id))}
            >
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
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
      <UploadForm code={room.code} remaining={MAX_CUSTOM_SOUNDS_PER_PLAYER - myUploads} />

      <ul
        className="-mx-1 mt-4 grid gap-2 px-1 pb-1 sm:grid-cols-2 lg:min-h-0 lg:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] lg:content-start lg:overflow-y-auto"
        data-testid="sound-grid"
      >
        {room.sounds.map((sound) => (
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
  sound: SoundRef;
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
          {(sound.durationMs / 1000).toFixed(1)}s{uploader && ` · by ${uploader}`}
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
  const [error, setError] = useState<string | null>(null);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!f) return;
    setError(null);
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(errorMessage('FILE_TOO_LARGE'));
      return;
    }
    choose(f);
    setLabel(f.name.replace(/\.[^.]+$/, '').slice(0, 40));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
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
      setError(errorMessage(result.error));
    }
  };

  const labelOk = SoundLabelSchema.safeParse(label).success;

  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong bg-surface-sunken/40 p-3">
      <input
        ref={input}
        type="file"
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
            Bring your own sounds: {MAX_CUSTOM_SOUND_MS / 1000}s max,{' '}
            {MAX_UPLOAD_BYTES / 1024 / 1024} MB max. They’re deleted when the lobby closes.
          </p>
          <Button
            variant="secondary"
            disabled={remaining <= 0}
            onClick={() => input.current?.click()}
          >
            {remaining > 0 ? 'Upload a sound' : 'Upload limit reached'}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
