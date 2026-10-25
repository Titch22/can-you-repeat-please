import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { logout, useAccount } from '../lib/account';
import { leaveRoom } from '../lib/actions';
import { useGame } from '../store';
import { LogOutIcon } from './icons';
import { Logo } from './Logo';

const LEAVE_WARNING = 'You will leave the current game if you proceed.';

const tabClass = (active: boolean) =>
  `rounded-control px-1.5 py-1.5 text-sm font-semibold whitespace-nowrap transition focus-visible:shadow-glow sm:px-3 ${
    active ? 'bg-surface-raised text-ink' : 'text-muted hover:text-ink'
  }`;

/**
 * Every page's top bar: the logo and Play (the home page, or the room the player is in) on the
 * left; Add sounds (logged in), Account and, for admins, Admin on the right. Those open pages
 * outside the game: from a room, they leave it, after a warning. So does any other link to a
 * page of the app that isn't the room (in the lobby, the game…).
 */
export function AppBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const room = useGame((s) => s.room);
  const user = useAccount((s) => s.user);
  const play = room ? `/r/${room.code}` : '/';
  const pages = [
    // Own sounds need an account.
    ...(user ? [{ to: '/sounds', label: 'Add sounds', short: 'Sounds', also: [] }] : []),
    // Logged out, the account page sends to the login page.
    { to: '/account', label: 'Account', also: ['/login'] },
    ...(user?.isAdmin ? [{ to: '/admin/accounts', label: 'Admin', also: [] }] : []),
  ];
  const isOn = (page: (typeof pages)[number]) =>
    [page.to, ...page.also].some((p) => pathname.startsWith(p));
  const onPlay = !pages.some(isOn);

  /** From a room: false if the player cancels, otherwise they leave it first. */
  const leaveFirst = async () => {
    if (!useGame.getState().room) return true;
    if (!window.confirm(LEAVE_WARNING)) return false;
    await leaveRoom();
    return true;
  };

  const open = async (to: string) => {
    if (await leaveFirst()) navigate(to);
  };

  // Any click on a link leading out of the room (another page of the app): same warning.
  const roomCode = room?.code;
  useEffect(() => {
    if (!roomCode) return;
    const onClick = (e: MouseEvent) => {
      // A new tab or window (modifier keys, middle button) doesn't leave the room.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as Element).closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) {
        return;
      }
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname === `/r/${roomCode}`) return;
      // Before React Router's own handler (capture phase, on the document).
      e.preventDefault();
      e.stopPropagation();
      void open(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open reads the room when called
  }, [roomCode]);

  /**
   * Logging out reconnects the socket, which mid-game looks like the player dropping out (it can
   * end a vote early): from a room, it leaves it first. Off the account pages, back home.
   */
  const logOut = async () => {
    const inRoom = !!room;
    if (!(await leaveFirst())) return;
    await logout();
    if (inRoom || !onPlay) navigate('/');
  };

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* The logo is a second way to Play: same target. */}
          <NavLink to={play} tabIndex={-1} aria-hidden className="rounded-control">
            <Logo size="sm" />
          </NavLink>
          <NavLink to={play} className={tabClass(onPlay)}>
            Play
          </NavLink>
        </div>
        <div className="flex items-center sm:gap-1">
          {pages.map((page) => (
            <button
              key={page.to}
              type="button"
              onClick={() => void open(page.to)}
              className={tabClass(isOn(page))}
              aria-current={isOn(page) ? 'page' : undefined}
            >
              {'short' in page ? (
                <>
                  <span className="sm:hidden">{page.short}</span>
                  <span className="hidden sm:inline">{page.label}</span>
                </>
              ) : (
                page.label
              )}
            </button>
          ))}
          {user && (
            // An icon only on phones: the bar must fit on one line.
            <button
              type="button"
              onClick={() => void logOut()}
              className={tabClass(false)}
              aria-label="Log out"
              title="Log out"
            >
              <LogOutIcon className="size-4 sm:hidden" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
