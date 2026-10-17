type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function MicIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
    </svg>
  );
}

export function MicOffIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3" />
      <path d="M19 10v1a7 7 0 0 1-1.1 3.7M5 10v1a7 7 0 0 0 11.3 5.5M12 18v4" />
    </svg>
  );
}

export function HeadphonesIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
    </svg>
  );
}
