import type { Player } from '@cyrp/shared';
import { useServerNow } from '../../lib/clock';

export function Avatar({
  player,
  size = 'size-9',
}: {
  player: Pick<Player, 'nickname' | 'color'>;
  size?: string;
}) {
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full font-bold text-slate-950`}
      style={{ backgroundColor: player.color }}
      aria-hidden
    >
      {player.nickname[0]?.toUpperCase()}
    </span>
  );
}

/** Bar filling from `from` to `to` (server time). */
export function ProgressBar({
  from,
  to,
  color = 'bg-amber-400',
}: {
  from: number;
  to: number;
  color?: string;
}) {
  const now = useServerNow(50);
  const ratio = Math.min(1, Math.max(0, (now - from) / Math.max(1, to - from)));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full ${color}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/** Whole seconds left until `deadline` (server time). */
export function SecondsLeft({ deadline }: { deadline: number | null }) {
  const now = useServerNow(200);
  if (!deadline) return null;
  return <span className="tabular-nums">{Math.max(0, Math.ceil((deadline - now) / 1000))}s</span>;
}

export function PlayButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-700 text-slate-100 transition hover:bg-slate-600"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
        <path d="M7 4.5v15l13-7.5z" />
      </svg>
    </button>
  );
}

export function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-700 text-slate-100 transition hover:bg-slate-600"
    >
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
