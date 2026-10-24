import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { Badge, Button, Card, ErrorText, inputClass, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ACCOUNT_ERROR_TEXT, changePassword, useAccount } from '../lib/account';

/** The logged-in player's own page: their name, and changing their password. */
export function AccountPage() {
  const { user, loaded } = useAccount();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Your account');

  if (!loaded) return null;
  if (!user) return <Navigate to="/login" replace />;

  const onChange = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setMessage({ ok: false, text: 'The two new passwords differ.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await changePassword(oldPassword, newPassword);
    setBusy(false);
    if (!result.ok) {
      const wrongOld = result.error === 'BAD_CREDENTIALS';
      setMessage({
        ok: false,
        text: wrongOld ? 'Your current password is wrong.' : ACCOUNT_ERROR_TEXT[result.error],
      });
      return;
    }
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setMessage({ ok: true, text: 'Password changed. Your other devices are logged out.' });
  };

  const field = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete={auto}
        minLength={auto === 'new-password' ? 8 : undefined}
        required
        className={inputClass}
      />
    </label>
  );

  return (
    <Page>
      <div className="m-auto flex w-full max-w-md animate-enter flex-col items-center gap-6">
        <Card
          className="w-full"
          title={user.username}
          subtitle={user.isAdmin ? <Badge>admin</Badge> : undefined}
        >
          <h3 className="mb-3 font-display font-bold">Change your password</h3>
          <form onSubmit={onChange} className="flex flex-col gap-4">
            {field('Current password', oldPassword, setOldPassword, 'current-password')}
            {field('New password (8+ characters)', newPassword, setNewPassword, 'new-password')}
            {field('New password again', confirm, setConfirm, 'new-password')}
            <Button type="submit" disabled={busy}>
              Change password
            </Button>
            {message?.ok ? (
              <p className="text-sm text-success" role="status">
                {message.text}
              </p>
            ) : (
              <ErrorText>{message?.text ?? null}</ErrorText>
            )}
          </form>
        </Card>
      </div>
    </Page>
  );
}
