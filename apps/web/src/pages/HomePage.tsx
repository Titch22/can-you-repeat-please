import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { RoomCodeSchema } from '@cyrp/shared';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Logo } from '../components/Logo';
import { ProfileFields, useProfile } from '../components/ProfileFields';
import { Button, Card, ErrorText, Notice, Page, inputClass } from '../components/ui';
import { useAccount } from '../lib/account';
import { createRoom, joinRoom } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useGame } from '../store';

const STEPS = [
  { title: 'Listen', text: 'A sound plays for everyone, at the same time.' },
  { title: 'Repeat', text: 'Imitate it into your mic. Everyone records at once.' },
  { title: 'Vote', text: 'Replay every attempt and vote for the best (or worst).' },
];

export function HomePage() {
  const navigate = useNavigate();
  const { profile, raw, update, valid } = useProfile();
  const notice = useGame((s) => s.notice);
  const currentRoom = useGame((s) => s.room);
  const account = useAccount((s) => s.user);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(null);

  const codeOk = RoomCodeSchema.safeParse(code).success;

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    const ack = await createRoom(profile);
    setBusy(false);
    if (ack.ok) navigate(`/r/${ack.code}`);
    else setError(errorMessage(ack.error));
  };

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    const upper = code.trim().toUpperCase();
    setBusy(true);
    setError(null);
    const ack = await joinRoom(upper, profile);
    setBusy(false);
    if (ack.ok) navigate(`/r/${upper}`);
    else setError(errorMessage(ack.error));
  };

  return (
    <Page>
      <nav className="flex justify-end text-sm">
        <Link
          to={account ? '/account' : '/login'}
          className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {account ? account.username : 'Log in'}
        </Link>
      </nav>
      <header className="animate-enter pb-2 sm:pt-6">
        <Logo size="lg" />
        <p className="mt-4 text-center text-muted sm:text-lg">
          Hear a sound. Imitate it. Vote for the best (or worst) attempt.
        </p>
      </header>

      {notice && (
        <Notice tone="danger">
          <span>{notice}</span>
          <button
            className="text-sm font-semibold underline underline-offset-2"
            onClick={() => useGame.setState({ notice: null })}
          >
            Dismiss
          </button>
        </Notice>
      )}

      {currentRoom && (
        <Notice>
          <span>
            You’re in room <b className="font-mono tracking-widest">{currentRoom.code}</b>.
          </span>
          <Link
            to={`/r/${currentRoom.code}`}
            className="font-semibold text-accent underline underline-offset-2"
          >
            Go back to it
          </Link>
        </Notice>
      )}

      <Card title="Who are you?">
        <ProfileFields value={raw} onChange={update} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col justify-between gap-5">
          <div>
            <h2 className="font-display text-lg font-bold">Create a room</h2>
            <p className="mt-1 text-sm text-muted">
              You’ll be the host: invite friends and pick the sounds.
            </p>
          </div>
          <Button onClick={onCreate} disabled={!valid || busy} size="lg">
            Create room
          </Button>
        </Card>

        <Card>
          <form onSubmit={onJoin} className="flex h-full flex-col justify-between gap-5">
            <label className="flex flex-col gap-2">
              <span className="font-display text-lg font-bold">Join a room</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="ABCD"
                aria-label="Room code"
                autoComplete="off"
                className={`${inputClass} text-center font-mono text-2xl tracking-[0.35em] uppercase`}
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              disabled={!valid || !codeOk || busy}
            >
              Join
            </Button>
          </form>
        </Card>
      </div>

      {!valid && <p className="text-center text-sm text-muted">Pick a nickname to play.</p>}
      <ErrorText>{error}</ErrorText>

      <section aria-label="How to play" className="mt-2 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex gap-3 rounded-card border border-line/60 bg-surface/50 p-4"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 font-display font-bold text-accent">
              {i + 1}
            </span>
            <span>
              <span className="block font-display font-bold">{step.title}</span>
              <span className="text-sm text-muted">{step.text}</span>
            </span>
          </div>
        ))}
      </section>
    </Page>
  );
}
