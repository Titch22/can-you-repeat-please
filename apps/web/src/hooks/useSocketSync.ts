import { useEffect } from 'react';
import type { RoomState } from '@cyrp/shared';
import { useGame } from '../store';
import { endSession, resumeSession } from '../lib/actions';
import { measureClockOffset, socket } from '../lib/socket';
import { onGameMute } from '../lib/voice';

/** Mirrors server events into the store. Mount once, at the app root. */
export function useSocketSync() {
  useEffect(() => {
    const onConnect = () => {
      useGame.setState({ connected: true });
      void resumeSession();
      void measureClockOffset().then((clockOffset) => useGame.setState({ clockOffset }));
    };
    const onDisconnect = () => useGame.setState({ connected: false });
    const onState = (room: RoomState) => useGame.setState({ room });
    const onKicked = ({ reason }: { reason: string }) => endSession(reason);
    const onClosed = () => endSession('The room was closed.');
    const onVoiceMute = ({ muted }: { muted: boolean }) => onGameMute(muted);

    if (socket.connected) onConnect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:kicked', onKicked);
    socket.on('room:closed', onClosed);
    socket.on('voice:mute', onVoiceMute);
    return () => {
      socket.off('voice:mute', onVoiceMute);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:kicked', onKicked);
      socket.off('room:closed', onClosed);
    };
  }, []);
}
