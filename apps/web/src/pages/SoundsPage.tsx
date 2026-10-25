import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { TagSchema, type LibrarySound } from '@cyrp/shared';
import { LinesEditor } from '../components/admin/LinesEditor';
import { PlayButton } from '../components/game/bits';
import {
  matchesFilter,
  NO_FILTER,
  SoundFilters,
  tagCounts,
  type SoundFilter,
} from '../components/SoundFilters';
import { SoundAdder } from '../components/SoundAdder';
import { Button, Card, ErrorText, inputClass, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAccount } from '../lib/account';
import { replay } from '../lib/audio';
import {
  adminDelete,
  adminUpdate,
  adminUpload,
  fetchMySounds,
  LIBRARY_ERROR_TEXT,
  useLibrary,
  type SoundsScope,
} from '../lib/library';

/** "Meme, Animal" → ['meme', 'animal'], or null if one of them isn't a valid tag. */
function parseTags(text: string): string[] | null {
  const parts = text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const tags = parts.map((t) => TagSchema.safeParse(t));
  if (tags.some((t) => !t.success)) return null;
  return [...new Set(tags.map((t) => t.data!))];
}

const mb = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * A logged-in user's own sounds: upload, tag, rename, delete, and dialogue lines. They can
 * share them with a room from its lobby. Admins also manage the shared library here.
 */
export function SoundsPage() {
  useDocumentTitle('My sounds');
  const { user, loaded } = useAccount();
  const [scope, setScope] = useState<SoundsScope>('mine');

  if (!loaded) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Page wide>
      <header className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {user.isAdmin && (
          <div
            className="grid grid-cols-2 gap-1 rounded-control bg-surface-sunken p-1"
            role="group"
            aria-label="Whose sounds"
          >
            {(
              [
                ['mine', 'My sounds'],
                ['library', 'Shared library'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`rounded-[0.6rem] px-3 py-1.5 text-sm font-semibold transition ${
                  scope === value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>
      {/* Remounted per scope: each list loads its own sounds. */}
      <Library key={scope} scope={scope} />
    </Page>
  );
}

function Library({ scope }: { scope: SoundsScope }) {
  const [sounds, setSounds] = useState<LibrarySound[] | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SoundFilter>(NO_FILTER);

  const fetchAll = () =>
    fetchMySounds(scope).then((result) => {
      if (!result.ok) return setLoadError(LIBRARY_ERROR_TEXT[result.error]);
      setSounds(result.value.sounds);
      setUsage({ used: result.value.usedBytes, quota: result.value.quotaBytes });
    });
  const retry = () => {
    setLoadError(null);
    void fetchAll();
  };
  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per scope (remounted)
  }, []);

  /** Applies a change locally, and makes the lobby refetch. */
  const change = (fn: (list: LibrarySound[]) => LibrarySound[]) => {
    setSounds((list) => fn(list ?? []));
    useLibrary.setState({ sounds: null });
  };
  /** Re-reads the space used (it reloads the whole list: once per batch, not per file). */
  const refreshUsage = () =>
    void fetchMySounds(scope).then(
      (r) => r.ok && setUsage({ used: r.value.usedBytes, quota: r.value.quotaBytes }),
    );
  const replace = (sound: LibrarySound) =>
    change((list) => list.map((s) => (s.id === sound.id ? sound : s)));

  const allTags = tagCounts(sounds ?? []);
  const visible = (sounds ?? []).filter((s) => matchesFilter(s, filter));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
      <UploadCard
        scope={scope}
        usage={usage}
        onBatchDone={refreshUsage}
        knownTags={allTags.map(([t]) => t)}
        onAdded={(s) =>
          change((list) =>
            [...list, s].sort((a, b) =>
              a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
            ),
          )
        }
      />
      <Card
        title={scope === 'library' ? 'Shared library' : 'My sounds'}
        subtitle={sounds ? `${visible.length} of ${sounds.length} sounds` : undefined}
      >
        {scope === 'mine' && (
          <p className="mb-3 text-sm text-muted">
            Only you see them. To play with them, tick “Share my sounds with the room” in a room’s
            lobby: the host can then pick among them.
          </p>
        )}
        <SoundFilters value={filter} onChange={setFilter} tags={allTags} />
        {loadError && (
          <p className="mt-3 flex items-center gap-2 text-sm text-danger" role="alert">
            {loadError}
            <Button variant="ghost" size="sm" onClick={retry}>
              Retry
            </Button>
          </p>
        )}
        {!sounds && !loadError && <p className="mt-3 animate-pulse text-muted">Loading…</p>}
        <datalist id="known-tags">
          {allTags.map(([t]) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <ul className="mt-4 flex flex-col gap-2">
          {visible.map((s) => (
            <SoundRow
              key={s.id}
              sound={s}
              onChanged={replace}
              onDeleted={() => {
                change((list) => list.filter((x) => x.id !== s.id));
                refreshUsage();
              }}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function UploadCard({
  scope,
  usage,
  knownTags,
  onAdded,
  onBatchDone,
}: {
  scope: SoundsScope;
  usage: { used: number; quota: number | null } | null;
  knownTags: string[];
  onAdded: (sound: LibrarySound) => void;
  onBatchDone: () => void;
}) {
  const [tagText, setTagText] = useState('');
  const tags = parseTags(tagText);

  /** One sound out of the crop editor: an error message, or null once it's in. */
  const upload = async (file: Blob, label: string) => {
    const result = await adminUpload(file, label, tags ?? [], scope);
    if (result.ok) {
      onAdded(result.value);
      return null;
    }
    const existing = result.sound ? ` (as “${result.sound.label}”)` : '';
    return `${LIBRARY_ERROR_TEXT[result.error]}${existing}`;
  };

  return (
    <Card title="Add sounds" className="lg:sticky lg:top-16">
      <div className="flex flex-col gap-3">
        {usage?.quota != null && (
          <div className="flex flex-col gap-1" data-testid="quota">
            <span className="text-sm text-muted">
              {mb(usage.used)} of {mb(usage.quota)} used
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (usage.used / usage.quota) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Tags for this batch (comma separated)</span>
          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="meme, movie"
            list="known-tags"
            className={inputClass}
          />
          {!tags && (
            <span className="text-xs text-danger">
              Tags: lowercase letters, digits, spaces and dashes (24 characters max).
            </span>
          )}
          {knownTags.length > 0 && (
            <span className="text-xs text-subtle">Existing: {knownTags.join(', ')}</span>
          )}
        </label>
        <SoundAdder
          upload={upload}
          onFinished={onBatchDone}
          pickLabel="Choose files"
          disabledReason={tags ? undefined : 'Fix the tags first.'}
        />
        <p className="text-xs text-subtle">
          Each sound opens in an editor: keep up to 20 seconds of it, and name it.
        </p>
      </div>
    </Card>
  );
}

function SoundRow({
  sound,
  onChanged,
  onDeleted,
}: {
  sound: LibrarySound;
  onChanged: (s: LibrarySound) => void;
  onDeleted: () => void;
}) {
  const [label, setLabel] = useState(sound.label);
  const [newTag, setNewTag] = useState('');
  const [editingLines, setEditingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: { label?: string; tags?: string[] }) => {
    setBusy(true);
    setError(null);
    const result = await adminUpdate(sound.id, patch);
    setBusy(false);
    if (result.ok) onChanged(result.value);
    else {
      setError(LIBRARY_ERROR_TEXT[result.error]);
      setLabel(sound.label);
    }
  };
  const saveLabel = () => {
    if (label.trim() && label.trim() !== sound.label) void save({ label: label.trim() });
    else setLabel(sound.label);
  };
  const addTag = (e: FormEvent) => {
    e.preventDefault();
    const tag = TagSchema.safeParse(newTag);
    if (!tag.success) {
      setError(LIBRARY_ERROR_TEXT.INVALID_PAYLOAD);
      return;
    }
    setNewTag('');
    if (!sound.tags.includes(tag.data)) void save({ tags: [...sound.tags, tag.data] });
  };
  const remove = async () => {
    if (!confirm(`Delete “${sound.label}”?`)) return;
    setBusy(true);
    const result = await adminDelete(sound.id);
    setBusy(false);
    if (result.ok || result.error === 'NOT_FOUND') onDeleted();
    else setError(LIBRARY_ERROR_TEXT[result.error]);
  };

  return (
    <li
      className={`flex flex-col gap-2 rounded-control border border-line bg-surface-raised/40 p-2.5 ${
        busy ? 'opacity-60' : ''
      }`}
      data-testid={`library-${sound.id}`}
    >
      <div className="flex items-center gap-2">
        <PlayButton label={`Play “${sound.label}”`} onClick={() => replay(sound.url)} />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          maxLength={40}
          aria-label={`Name of ${sound.id}`}
          className={`${inputClass} min-w-0 flex-1 py-1.5 text-sm font-semibold`}
        />
        <span
          className="flex w-16 shrink-0 flex-col text-right text-xs leading-tight text-subtle tabular-nums"
          title="Length, and space it takes on the server (counted in your quota)"
        >
          <span>{(sound.durationMs / 1000).toFixed(1)}s</span>
          <span data-testid="sound-size">{mb(sound.bytes)}</span>
        </span>
        <Button variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>
          Delete
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-11">
        {sound.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-accent/15 py-0.5 pr-1 pl-2.5 text-xs font-semibold text-accent-strong"
          >
            {t}
            <button
              type="button"
              onClick={() => void save({ tags: sound.tags.filter((x) => x !== t) })}
              aria-label={`Remove tag ${t} from ${sound.label}`}
              className="grid size-4 place-items-center rounded-full hover:bg-accent/25"
            >
              ✕
            </button>
          </span>
        ))}
        <form onSubmit={addTag}>
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="+ tag"
            list="known-tags"
            aria-label={`Add a tag to ${sound.label}`}
            className="w-24 rounded-full border border-dashed border-line-strong bg-transparent px-2.5 py-0.5 text-xs outline-none focus:border-accent"
          />
        </form>
        <button
          type="button"
          onClick={() => setEditingLines(!editingLines)}
          aria-expanded={editingLines}
          className="ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold text-muted hover:bg-surface-raised hover:text-ink"
        >
          {sound.lines.length ? `Lines (${sound.lines.length})` : 'Lines'}{' '}
          {editingLines ? '▴' : '▾'}
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
      {editingLines && <LinesEditor sound={sound} onChanged={onChanged} />}
    </li>
  );
}
