import { useServerNow } from '../../lib/clock';
import { iconButtonClass } from '../ui';

export { Avatar } from '../ui';

/** Bar filling from `from` to `to` (server time). */
export function ProgressBar({
  from,
  to,
  color = 'bg-accent',
}: {
  from: number;
  to: number;
  color?: string;
}) {
  const now = useServerNow(50);
  const ratio = Math.min(1, Math.max(0, (now - from) / Math.max(1, to - from)));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/** Whole seconds left until `deadline` (server time), as a small timer chip. */
export function SecondsLeft({ deadline }: { deadline: number | null }) {
  const now = useServerNow(200);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span
      className={`inline-flex min-w-14 items-center justify-center rounded-full border px-3 py-1 font-display text-lg font-bold tabular-nums ${
        left <= 5
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : 'border-line bg-surface text-ink'
      }`}
    >
      {left}s
    </span>
  );
}

export function PlayButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={iconButtonClass}
    >
      <svg viewBox="0 0 24 24" className="size-4 translate-x-px" fill="currentColor" aria-hidden>
        <path d="M7 4.5v15l13-7.5z" />
      </svg>
    </button>
  );
}

export function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} download aria-label={label} title={label} className={iconButtonClass}>
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
    </a>
  );
}
