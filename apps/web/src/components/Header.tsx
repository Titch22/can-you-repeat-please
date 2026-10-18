import { useState } from 'react';
import { useNavigate } from 'react-router';
import { leaveRoom } from '../lib/actions';
import { Logo } from './Logo';
import { Button } from './ui';

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/**
 * Room header (lobby and game): logo, the room code with a copy-invite button, and Leave.
 * The logo also leaves, after a confirm, so it can't drop someone out of a room by accident.
 */
export function Header({ code }: { code: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is visible anyway.
    }
  };

  const leave = async () => {
    await leaveRoom();
    navigate('/');
  };

  return (
    <header className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => window.confirm('Leave the room?') && void leave()}
        className="rounded-control transition hover:opacity-80 focus-visible:shadow-glow"
        title="Leave the room"
      >
        <Logo size="sm" />
      </button>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-control border border-line bg-surface py-1 pr-1 pl-3">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">Room</span>
          <span
            className="font-mono text-xl font-black tracking-[0.18em] sm:text-2xl"
            data-testid="room-code"
          >
            {code}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyLink()}
            icon={<CopyIcon />}
            title="Copy the invite link"
          >
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy invite link'}</span>
            <span className="sm:hidden">{copied ? 'Copied!' : 'Link'}</span>
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void leave()}>
          Leave
        </Button>
      </div>
    </header>
  );
}
