import { useEffect } from 'react';
import { useGame } from '../store';
import { loadSession } from '../lib/storage';
import { connectVoice, disconnectVoice } from '../lib/voice';

/** Keeps the LiveKit connection in step with room membership. Mount once, at the app root. */
export function useVoiceConnection() {
  const code = useGame((s) => s.room?.code);
  const playerId = useGame((s) => s.playerId);

  useEffect(() => {
    const session = loadSession();
    if (!code || !playerId || session?.code !== code) return;
    void connectVoice(code, session.sessionToken);
    return () => void disconnectVoice();
  }, [code, playerId]);
}
