/** The mark: a speech bubble holding a sound wave (same drawing as public/favicon.svg). */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        d="M7 3h18a5 5 0 0 1 5 5v11a5 5 0 0 1-5 5H15l-6.5 5.2a.8.8 0 0 1-1.3-.6V24H7a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z"
        className="fill-accent"
      />
      <rect x="9.5" y="10" width="3" height="7" rx="1.5" className="fill-bg" />
      <rect x="14.5" y="7" width="3" height="13" rx="1.5" className="fill-bg" />
      <rect x="19.5" y="11" width="3" height="5" rx="1.5" className="fill-bg" />
    </svg>
  );
}

/**
 * Mark + wordmark. `lg` is the home hero (rendered as the page's h1), `sm` the header logo.
 */
export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  if (size === 'lg') {
    return (
      <h1 className="flex flex-col items-center gap-4 text-center">
        <LogoMark className="size-16 drop-shadow-[0_8px_24px_rgb(251_191_36/0.35)] sm:size-20" />
        <span className="font-display text-4xl leading-none font-extrabold tracking-tight sm:text-6xl">
          Can You Repeat <span className="text-accent">Please?</span>
        </span>
      </h1>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <LogoMark className="size-7" />
      <span className="hidden font-display text-base leading-tight font-bold sm:inline">
        Can You Repeat <span className="text-accent">Please?</span>
      </span>
    </span>
  );
}
