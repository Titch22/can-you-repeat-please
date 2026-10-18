import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MAX_UPLOAD_BYTES, TagSchema, type LibrarySound } from '@cyrp/shared';
import { PlayButton } from '../components/game/bits';
import { Logo } from '../components/Logo';
import {
  matchesFilter,
  NO_FILTER,
  SoundFilters,
  tagCounts,
  type SoundFilter,
} from '../components/SoundFilters';
import { Button, Card, ErrorText, inputClass, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { replay } from '../lib/audio';
import {
  adminCheckToken,
  adminDelete,
  adminUpdate,
  adminUpload,
  fetchLibrary,
  LIBRARY_ERROR_TEXT,
  useLibrary,
} from '../lib/library';

const TOKEN_KEY = 'cyrp.adminToken';
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token just isn't remembered.
  }
};

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

/** Library management (not linked from the game): upload, tag, rename, delete. */
export function AdminPage() {
  useDocumentTitle('Sound library admin');
  const [token, setToken] = useState<string | null>(null);
  const [saved] = useState(readToken);
  const [checking, setChecking] = useState(!!saved);

  // A remembered token is checked once on load.
  useEffect(() => {
    if (!saved) return;
    void adminCheckToken(saved).then((ok) => {
      if (ok) setToken(saved);
      else writeToken(null);
      setChecking(false);
    });
  }, [saved]);

  return (
    <Page wide>
      <header className="flex items-center justify-between gap-3 pt-2">
        <Link to="/" aria-label="Home">
          <Logo size="sm" />
        </Link>
        {token && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              writeToken(null);
              setToken(null);
            }}
          >
            Lock
          </Button>
        )}
      </header>
      {checking ? (
        <p className="m-auto animate-pulse text-muted">Checking…</p>
      ) : token ? (
        <Library token={token} />
      ) : (
        <TokenForm
          onUnlock={(t) => {
            writeToken(t);
            setToken(t);
          }}
        />
      )}
    </Page>
  );
}

function TokenForm({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await adminCheckToken(value.trim());
    setBusy(false);
    if (ok) onUnlock(value.trim());
    else setError(LIBRARY_ERROR_TEXT.UNAUTHORIZED);
  };
  return (
    <Card className="m-auto w-full max-w-sm" title="Sound library admin">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Admin token"
          aria-label="Admin token"
          autoComplete="current-password"
          className={inputClass}
        />
        <Button type="submit" disabled={!value.trim() || busy}>
          Unlock
        </Button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Card>
  );
}

function Library({ token }: { token: string }) {
  const [sounds, setSounds] = useState<LibrarySound[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<SoundFilter>(NO_FILTER);

  // no-store: listings are cached for a few seconds, the admin wants the truth.
  const fetchAll = () =>
    fetchLibrary({ cache: 'no-store' }).then(setSounds, () => setLoadError(true));
  const retry = () => {
    setLoadError(false);
    void fetchAll();
  };
  useEffect(() => {
    void fetchAll();
  }, []);

  /** Applies a change locally, and makes the lobby refetch next time. */
  const change = (fn: (list: LibrarySound[]) => LibrarySound[]) => {
    setSounds((list) => fn(list ?? []));
    useLibrary.setState({ sounds: null });
  };
  const replace = (sound: LibrarySound) =>
    change((list) => list.map((s) => (s.id === sound.id ? sound : s)));

  const allTags = tagCounts(sounds ?? []);
  const visible = (sounds ?? []).filter((s) => matchesFilter(s, filter));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
      <UploadCard
        token={token}
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
        title="Library"
        subtitle={sounds ? `${visible.length} of ${sounds.length} sounds` : undefined}
      >
        <SoundFilters value={filter} onChange={setFilter} tags={allTags} />
        {loadError && (
          <p className="mt-3 flex items-center gap-2 text-sm text-danger" role="alert">
            {LIBRARY_ERROR_TEXT.NETWORK}
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
              token={token}
              onChanged={replace}
              onDeleted={() => change((list) => list.filter((x) => x.id !== s.id))}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function UploadCard({
  token,
  knownTags,
  onAdded,
}: {
  token: string;
  knownTags: string[];
  onAdded: (sound: LibrarySound) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [tagText, setTagText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ added: number; problems: string[] } | null>(null);
  const tags = parseTags(tagText);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0 || !tags) return;
    const problems: string[] = [];
    let added = 0;
    setReport(null);
    for (const [i, f] of files.entries()) {
      setProgress({ done: i, total: files.length });
      if (f.size > MAX_UPLOAD_BYTES) {
        problems.push(`${f.name}: ${LIBRARY_ERROR_TEXT.FILE_TOO_LARGE}`);
        continue;
      }
      const label =
        f.name
          .replace(/\.[^.]+$/, '')
          .trim()
          .slice(0, 40) || 'Sound';
      const result = await adminUpload(token, f, label, tags);
      if (result.ok) {
        added++;
        onAdded(result.value);
      } else {
        const existing = result.sound ? ` (as “${result.sound.label}”)` : '';
        problems.push(`${f.name}: ${LIBRARY_ERROR_TEXT[result.error]}${existing}`);
      }
    }
    setProgress(null);
    setReport({ added, problems });
  };

  return (
    <Card title="Add sounds" className="lg:sticky lg:top-4">
      <div className="flex flex-col gap-3">
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
        <input
          ref={input}
          type="file"
          multiple
          accept="audio/*,.mp3,.ogg,.wav,.webm,.m4a"
          className="hidden"
          onChange={(e) => void pick(e)}
        />
        <Button onClick={() => input.current?.click()} disabled={!tags || !!progress}>
          {progress ? `Uploading ${progress.done + 1} of ${progress.total}…` : 'Choose files'}
        </Button>
        <p className="text-xs text-subtle">
          20 seconds and 2 MB max each. Sounds are named after their files; rename them in the list.
        </p>
        {report && (
          <div className="text-sm">
            <p className="text-success">
              {report.added} sound{report.added === 1 ? '' : 's'} added.
            </p>
            {report.problems.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-danger" role="alert">
                {report.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function SoundRow({
  sound,
  token,
  onChanged,
  onDeleted,
}: {
  sound: LibrarySound;
  token: string;
  onChanged: (s: LibrarySound) => void;
  onDeleted: () => void;
}) {
  const [label, setLabel] = useState(sound.label);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: { label?: string; tags?: string[] }) => {
    setBusy(true);
    setError(null);
    const result = await adminUpdate(token, sound.id, patch);
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
    if (!confirm(`Delete “${sound.label}” from the library?`)) return;
    setBusy(true);
    const result = await adminDelete(token, sound.id);
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
        <span className="w-12 shrink-0 text-right text-xs text-subtle tabular-nums">
          {(sound.durationMs / 1000).toFixed(1)}s
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
        <ErrorText>{error}</ErrorText>
      </div>
    </li>
  );
}
