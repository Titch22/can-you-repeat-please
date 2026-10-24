import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { RoomCodeSchema } from '@cyrp/shared';
import { GameView } from '../components/game/GameView';
import { Lobby } from '../components/Lobby';
import { ProfileFields, useProfile } from '../components/ProfileFields';
import { Button, Card, ErrorText, Page } from '../components/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { joinRoom } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { useGame } from '../store';

export function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const room = useGame((s) => s.room);
  const resuming = useGame((s) => s.resuming);
  const notice = useGame((s) => s.notice);

  if (notice) return <Navigate to="/" replace />;
  if (room?.code === code) {
    return room.phase === 'LOBBY' ? <Lobby room={room} /> : <GameView room={room} />;
  }
  if (resuming) {
    return (
      <Centered>
        <p className="animate-pulse text-muted">Reconnecting…</p>
      </Centered>
    );
  }
  if (!RoomCodeSchema.safeParse(code).success) {
    return (
      <Centered>
        <p className="text-center">
          “{code}” is not a valid room code.{' '}
          <Link to="/" className="font-semibold text-accent underline underline-offset-2">
            Go home
          </Link>
        </p>
      </Centered>
    );
  }
  return <JoinCard code={code} />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <Page>
      <div className="m-auto flex flex-col items-center gap-6">{children}</div>
    </Page>
  );
}

/** Shown when arriving from an invite link without a seat in the room yet. */
function JoinCard({ code }: { code: string }) {
  const { profile, raw, update, valid } = useProfile();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(`Join ${code}`);

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
      <div className="m-auto flex w-full max-w-md animate-enter flex-col items-center gap-6">
        <Card className="w-full">
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <h1 className="font-display text-2xl font-extrabold">
              Join room <span className="font-mono tracking-widest text-accent">{code}</span>
            </h1>
            <ProfileFields value={raw} onChange={update} />
            <Button type="submit" size="lg" disabled={!valid || busy}>
              Join
            </Button>
            <ErrorText>{error}</ErrorText>
            <Link
              to="/"
              className="text-center text-sm text-muted underline underline-offset-2 hover:text-ink"
            >
              Back to home
            </Link>
          </form>
        </Card>
      </div>
    </Page>
  );
}
