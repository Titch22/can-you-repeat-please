import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { RoomCodeSchema } from '@cyrp/shared';
import { ProfileFields, useProfile } from '../components/ProfileFields';
import { Button, Card, ErrorText, Page } from '../components/ui';
import { createRoom, joinRoom } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useGame } from '../store';

export function HomePage() {
  const navigate = useNavigate();
  const { profile, raw, update, valid } = useProfile();
  const notice = useGame((s) => s.notice);
  const currentRoom = useGame((s) => s.room);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <header className="py-6 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Can You Repeat Please?</h1>
        <p className="mt-3 text-slate-400">
          Hear a sound. Imitate it. Vote for the best (or worst) attempt.
        </p>
      </header>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-500/10 px-4 py-3 text-rose-200">
          <span>{notice}</span>
          <button className="text-sm underline" onClick={() => useGame.setState({ notice: null })}>
            Dismiss
          </button>
        </div>
      )}

      {currentRoom && (
        <div className="rounded-xl bg-slate-800 px-4 py-3">
          You’re in room <b className="font-mono">{currentRoom.code}</b>.{' '}
          <Link to={`/r/${currentRoom.code}`} className="text-amber-300 underline">
            Go back to it
          </Link>
        </div>
      )}

      <Card>
        <ProfileFields value={raw} onChange={update} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-bold">Create a room</h2>
            <p className="text-sm text-slate-400">You’ll be the host and pick the settings.</p>
          </div>
          <Button onClick={onCreate} disabled={!valid || busy}>
            Create room
          </Button>
        </Card>

        <Card>
          <form onSubmit={onJoin} className="flex h-full flex-col justify-between gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-bold">Join a room</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="ABCD"
                aria-label="Room code"
                autoComplete="off"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-center font-mono text-2xl tracking-[0.3em] uppercase outline-none focus:border-amber-400"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={!valid || !codeOk || busy}>
              Join
            </Button>
          </form>
        </Card>
      </div>

      {!valid && <p className="text-center text-sm text-slate-400">Pick a nickname to play.</p>}
      <ErrorText>{error}</ErrorText>
    </Page>
  );
}
