import { useEffect, useState } from 'react';
import { useGame } from '../store';

/** Current time on the server's clock (all deadlines and `startsAt` use it). */
export const serverNow = () => Date.now() + useGame.getState().clockOffset;

/** Re-renders every `intervalMs` with the current server time, for countdowns. */
export function useServerNow(intervalMs = 100) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
