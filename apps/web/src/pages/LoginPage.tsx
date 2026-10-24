import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button, Card, ErrorText, inputClass, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ACCOUNT_ERROR_TEXT, login, signup, useAccount } from '../lib/account';

/** Log in, or create an account (with a code from an admin unless sign-up is open). */
export function LoginPage() {
  const navigate = useNavigate();
  const { user, signup: signupMode } = useAccount();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(mode === 'login' ? 'Log in' : 'Create an account');

  if (user) return <Navigate to="/account" replace />;
  const needsCode = mode === 'signup' && signupMode === 'code';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'login'
        ? await login(username, password)
        : await signup(username, password, needsCode ? code : undefined);
    setBusy(false);
    if (result.ok) navigate('/');
    else setError(ACCOUNT_ERROR_TEXT[result.error]);
  };

  return (
    <Page>
      <div className="m-auto flex w-full max-w-md animate-enter flex-col items-center gap-6">
        <Card className="w-full">
          <div
            className="mb-5 grid grid-cols-2 gap-1 rounded-control bg-surface-sunken p-1"
            role="group"
            aria-label="Log in or create an account"
          >
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`rounded-[0.6rem] px-3 py-1.5 text-sm font-semibold transition focus-visible:shadow-glow ${
                  mode === m
                    ? 'bg-accent text-accent-ink shadow-accent'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Create an account'}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                maxLength={20}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
                className={inputClass}
              />
            </label>
            {needsCode && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-muted">Code (ask an administrator)</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  autoComplete="off"
                  required
                  className={`${inputClass} font-mono tracking-widest`}
                />
              </label>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {mode === 'login' ? 'Log in' : 'Create my account'}
            </Button>
            <ErrorText>{error}</ErrorText>
          </form>
        </Card>
      </div>
    </Page>
  );
}
