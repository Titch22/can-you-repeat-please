import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { RoomCodeSchema } from '@cyrp/shared';
import { Lobby } from '../components/Lobby';
import { ProfileFields, useProfile } from '../components/ProfileFields';
import { Button, Card, ErrorText, Page } from '../components/ui';
import { joinRoom } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useGame } from '../store';

export function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const room = useGame((s) => s.room);
  const resuming = useGame((s) => s.resuming);
  const notice = useGame((s) => s.notice);

  if (notice) return <Navigate to="/" replace />;
  if (room?.code === code) return <Lobby room={room} />;
  if (resuming) {
    return (
      <Page>
        <p className="m-auto text-slate-400">Reconnecting…</p>
      </Page>
    );
  }
  if (!RoomCodeSchema.safeParse(code).success) {
    return (
      <Page>
        <p className="m-auto text-center">
          “{code}” is not a valid room code.{' '}
          <Link to="/" className="text-amber-300 underline">
            Go home
          </Link>
        </p>
      </Page>
    );
  }
  return <JoinCard code={code} />;
}

/** Shown when arriving from an invite link without a seat in the room yet. */
function JoinCard({ code }: { code: string }) {
  const { profile, raw, update, valid } = useProfile();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ack = await joinRoom(code, profile);
    setBusy(false);
    // On success, room:state arrives and RoomPage switches to the lobby.
    if (!ack.ok) setError(errorMessage(ack.error));
  };

  return (
    <Page>
      <Card className="m-auto w-full max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <h1 className="text-2xl font-black">
            Join room <span className="font-mono tracking-widest">{code}</span>
          </h1>
          <ProfileFields value={raw} onChange={update} />
          <Button type="submit" disabled={!valid || busy}>
            Join
          </Button>
          <ErrorText>{error}</ErrorText>
          <Link to="/" className="text-center text-sm text-slate-400 underline">
            Back to home
          </Link>
        </form>
      </Card>
    </Page>
  );
}
