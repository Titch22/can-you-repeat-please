import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAccount } from '../lib/account';
import { fetchFromLink, LIBRARY_ERROR_TEXT } from '../lib/library';
import { CropEditor } from './CropEditor';
import { Button, inputClass } from './ui';

/** Files are cut down in the browser, so they may be big: about 5 minutes of mp3. */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

const labelFromFile = (f: File) => f.name.replace(/\.[^.]+$/, '');

/**
 * Adding sounds: files (several at once), or a link to a sound file (logged in). Each sound then opens in
 * the crop editor, one after the other; `upload` sends the kept part and answers an error
 * message, or null. `onFinished` runs once the last one is done.
 */
export function SoundAdder({
  upload,
  onFinished,
  pickLabel,
  hint,
  disabledReason,
}: {
  upload: (file: Blob, label: string) => Promise<string | null>;
  onFinished?: () => void;
  pickLabel: string;
  hint?: ReactNode;
  /** Set when nothing can be added (e.g. the room is full): shown instead of the buttons. */
  disabledReason?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const user = useAccount((s) => s.user);
  const [queue, setQueue] = useState<{ blob: Blob; label: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [report, setReport] = useState<{ added: number; problems: string[] } | null>(null);
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);

  const start = (items: { blob: Blob; label: string }[], problems: string[]) => {
    setReport({ added: 0, problems });
    setIndex(0);
    setQueue(items);
  };
  const next = (added: boolean) => {
    if (added) setReport((r) => r && { ...r, added: r.added + 1 });
    if (index + 1 < queue.length) setIndex(index + 1);
    else finish();
  };
  const finish = () => {
    setQueue([]);
    onFinished?.();
  };

  const pick = (files: File[]) => {
    const fit = files.filter((f) => f.size <= MAX_SOURCE_BYTES);
    const problems = files
      .filter((f) => f.size > MAX_SOURCE_BYTES)
      .map((f) => `${f.name}: too big (50 MB max).`);
    start(
      fit.map((f) => ({ blob: f, label: labelFromFile(f) })),
      problems,
    );
  };

  const fromLink = async (e: FormEvent) => {
    e.preventDefault();
    setFetching(true);
    setReport(null);
    const result = await fetchFromLink(link.trim());
    setFetching(false);
    if (!result.ok) {
      const text =
        result.error === 'INVALID_PAYLOAD'
          ? 'That isn’t a link to a public website (standard web port).'
          : result.error === 'FILE_TOO_LARGE'
            ? 'That file is too big (15 MB max).'
            : result.error === 'UNSUPPORTED_FORMAT'
              ? 'That link isn’t a sound file (mp3, ogg, wav, webm, m4a).'
              : result.error === 'RATE_LIMITED'
                ? 'Too many downloads right now: try again in a moment.'
                : LIBRARY_ERROR_TEXT[result.error];
      setReport({ added: 0, problems: [text] });
      return;
    }
    setLink('');
    start([{ blob: result.blob, label: result.title }], []);
  };

  const current = queue[index];
  if (current) {
    return (
      <CropEditor
        key={index}
        source={current.blob}
        label={current.label}
        position={queue.length > 1 ? `${index + 1} of ${queue.length}` : undefined}
        onAdd={async (file, label) => {
          const problem = await upload(file, label);
          if (!problem) next(true);
          return problem;
        }}
        onSkip={() => next(false)}
        onCancelAll={queue.length > 1 ? finish : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <input
        ref={input}
        type="file"
        multiple
        accept="audio/*,.mp3,.ogg,.wav,.webm,.m4a"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ''; // allow picking the same files again
          if (files.length) pick(files);
        }}
        data-testid="sound-file"
      />
      {disabledReason ? (
        <p className="text-sm text-muted">{disabledReason}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={fetching}>
            {pickLabel}
          </Button>
          {user ? (
            <form onSubmit={(e) => void fromLink(e)} className="flex w-full min-w-0 gap-2">
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="or a link to a sound file"
                aria-label="Link to a sound file"
                className={`${inputClass} min-w-0 flex-1 py-2`}
              />
              <Button
                type="submit"
                variant="ghost"
                className="whitespace-nowrap"
                disabled={!link.trim() || fetching}
              >
                {fetching ? 'Downloading…' : 'Get the sound'}
              </Button>
            </form>
          ) : (
            <Link to="/login" className="text-sm text-muted underline underline-offset-2">
              Log in to add sounds from a link
            </Link>
          )}
        </div>
      )}
      {report && (report.added > 0 || report.problems.length > 0) && (
        <div className="text-sm">
          {report.added > 0 && (
            <p className="text-success">
              {report.added} sound{report.added === 1 ? '' : 's'} added.
            </p>
          )}
          {report.problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-danger" role="alert">
              {report.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
