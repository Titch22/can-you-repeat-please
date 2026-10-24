import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Logo } from '../components/Logo';
import { Badge, Button, Card, ErrorText, inputClass, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  ACCOUNT_ERROR_TEXT,
  createInvites,
  deleteInvite,
  listInvites,
  listUsers,
  resetPassword,
  useAccount,
  type AccountResult,
  type AccountUser,
  type Invite,
} from '../lib/account';

const day = (ms: number) => new Date(ms).toLocaleDateString();

/** Admins (ADMIN_USERNAMES): sign-up codes, and password resets printed in the server console. */
export function AccountsAdminPage() {
  const { user, loaded } = useAccount();
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [count, setCount] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Accounts');

  const isAdmin = !!user?.isAdmin;
  const fetchLists = () => Promise.all([listUsers(), listInvites()]);
  const show = ([u, i]: Awaited<ReturnType<typeof fetchLists>>) => {
    if (u.ok) setUsers(u.value);
    if (i.ok) setInvites(i.value);
    if (!u.ok) setError(ACCOUNT_ERROR_TEXT[u.error]);
  };
  const reload = async () => show(await fetchLists());
  useEffect(() => {
    if (isAdmin) void fetchLists().then(show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when admin rights are known
  }, [isAdmin]);

  if (!loaded) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) {
    return (
      <Page>
        <p className="m-auto text-muted">Only administrators can see this page.</p>
      </Page>
    );
  }

  /** Runs an admin action, shows its error if any, then reloads the lists. */
  const act = async <T,>(request: Promise<AccountResult<T>>, done?: string) => {
    setError(null);
    setNotice(null);
    const result = await request;
    if (!result.ok) setError(ACCOUNT_ERROR_TEXT[result.error]);
    else if (done) setNotice(done);
    await reload();
  };

  const unused = invites.filter((i) => !i.usedBy);
  return (
    <Page>
      <header className="flex items-center justify-between pt-3">
        <Link to="/" aria-label="Home">
          <Logo size="sm" />
        </Link>
        <Link to="/account" className="text-sm text-muted underline underline-offset-2">
          Your account
        </Link>
      </header>
      {notice && (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      )}
      <ErrorText>{error}</ErrorText>

      <Card title="Sign-up codes" subtitle={`${unused.length} unused`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            aria-label="How many codes"
            className={`${inputClass} w-20 py-1.5`}
          />
          <Button size="sm" onClick={() => void act(createInvites(count))}>
            Generate {count === 1 ? 'a code' : `${count} codes`}
          </Button>
          <span className="text-xs text-subtle">Each code creates one account.</span>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">No codes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {invites.map((invite) => (
              <li key={invite.code} className="flex flex-wrap items-center gap-2">
                <code
                  className={`font-mono tracking-widest ${invite.usedBy ? 'text-subtle line-through' : ''}`}
                >
                  {invite.code}
                </code>
                {invite.usedBy ? (
                  <span className="text-muted">
                    used by <b>{invite.usedBy}</b> on {day(invite.usedAt!)}
                  </span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard?.writeText(invite.code)}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void act(deleteInvite(invite.code))}
                      aria-label={`Delete code ${invite.code}`}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Accounts" subtitle={`${users.length}`}>
        <ul className="flex flex-col gap-1.5 text-sm">
          {users.map((u) => (
            <li key={u.username} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{u.username}</span>
              {u.isAdmin && <Badge tone="accent">admin</Badge>}
              <span className="text-subtle">since {day(u.createdAt)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (
                    !confirm(`Give ${u.username} a new random password? They'll be logged out.`)
                  ) {
                    return;
                  }
                  void act(
                    resetPassword(u.username),
                    `Done: ${u.username}’s new password is in the server console (docker compose logs game).`,
                  );
                }}
              >
                Reset password
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
