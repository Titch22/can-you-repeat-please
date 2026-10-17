import { useEffect, useState } from 'react';
import { measureClockOffset, socket } from './lib/socket';

type Status = { state: 'connecting' } | { state: 'connected'; offset: number } | { state: 'down' };

export function App() {
  const [status, setStatus] = useState<Status>({ state: 'connecting' });

  useEffect(() => {
    const onConnect = () =>
      measureClockOffset().then((offset) => setStatus({ state: 'connected', offset }));
    const onDisconnect = () => setStatus({ state: 'down' });

    if (socket.connected) onConnect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-4 text-slate-100">
      <h1 className="text-center text-4xl font-black tracking-tight sm:text-6xl">
        Can You Repeat Please?
      </h1>
      <p className="text-slate-400">Rooms and lobby coming in M1.</p>
      <p data-testid="server-status" className="text-sm">
        {status.state === 'connecting' && 'Connecting to server…'}
        {status.state === 'connected' &&
          `Server connected (clock offset ${Math.round(status.offset)} ms)`}
        {status.state === 'down' && 'Server unreachable'}
      </p>
    </main>
  );
}
