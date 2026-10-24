import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import type { Player } from '@cyrp/shared';

// ── Button ──────────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink shadow-accent hover:bg-accent-strong',
  secondary: 'bg-surface-raised text-ink hover:bg-slate-700',
  ghost: 'text-slate-300 hover:bg-surface-raised hover:text-ink',
  danger: 'text-rose-300 hover:bg-rose-500/15',
};

const SIZES: Record<Size, string> = {
  sm: 'gap-1.5 px-2.5 py-1.5 text-sm',
  md: 'gap-2 px-4 py-2.5',
  lg: 'gap-2.5 px-6 py-3.5 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-control font-semibold transition focus-visible:shadow-glow active:translate-y-px disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/** Small round icon-only button (play, download…). */
export const iconButtonClass =
  'grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised text-ink transition hover:bg-slate-700 focus-visible:shadow-glow active:scale-95';

// ── Card ────────────────────────────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-surface p-5 shadow-card backdrop-blur-sm ${className}`}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="flex flex-wrap items-baseline gap-x-2 font-display text-lg font-bold">
            {title}
            {subtitle && (
              <span className="font-sans text-sm font-normal text-muted">{subtitle}</span>
            )}
          </h2>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Form bits ───────────────────────────────────────────────────────────────────

export const inputClass =
  'rounded-control border border-line-strong bg-surface-sunken px-3 py-2.5 outline-none transition placeholder:text-subtle focus:border-accent focus:shadow-glow';

/**
 * Range input with its label and current value. The visible label and the value share a row
 * (tests look for the value next to the label).
 */
export function Slider({
  label,
  display,
  hint,
  valueTestId,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  display: ReactNode;
  hint?: ReactNode;
  valueTestId?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums" data-testid={valueTestId}>
          {display}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        className="h-2 w-full cursor-pointer disabled:cursor-default disabled:opacity-50"
        {...input}
      />
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

// ── Badges & avatars ────────────────────────────────────────────────────────────

const BADGES = {
  accent: 'bg-accent/15 text-accent-strong',
  muted: 'bg-surface-raised text-muted',
  success: 'bg-emerald-400/15 text-emerald-300',
  danger: 'bg-rose-500/15 text-rose-300',
};

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: keyof typeof BADGES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold ${BADGES[tone]}`}
    >
      {children}
    </span>
  );
}

const AVATAR_SIZES = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-12 text-lg',
  xl: 'size-16 text-2xl',
};

/**
 * A player's colored initial. `speaking` adds the green ring (and `data-speaking`, which the
 * tests read); `children` can add a corner badge (mic off…).
 */
export function Avatar({
  player,
  size = 'md',
  speaking,
  className = '',
  children,
}: {
  player: Pick<Player, 'nickname' | 'color'>;
  size?: keyof typeof AVATAR_SIZES;
  speaking?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const style: CSSProperties = { backgroundColor: player.color };
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-full font-display font-bold text-slate-950 transition ${
        AVATAR_SIZES[size]
      } ${speaking ? 'ring-[3px] ring-success ring-offset-2 ring-offset-slate-900' : ''} ${className}`}
      style={style}
      data-speaking={speaking === undefined ? undefined : speaking}
      aria-hidden
    >
      {player.nickname[0]?.toUpperCase() || '?'}
      {children}
    </span>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────────

/** `wide` for the lobby's two-column desktop layout. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main
      className={`mx-auto flex w-full flex-1 ${wide ? 'lg:max-w-[90%]' : 'max-w-3xl'} flex-col gap-5 px-4 pt-3 pb-10 sm:gap-6`}
    >
      {children}
    </main>
  );
}

/** Dismissable or informational banner. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'danger';
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-control border px-4 py-3 ${
        tone === 'danger'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
          : 'border-line bg-surface text-ink'
      }`}
    >
      {children}
    </div>
  );
}
