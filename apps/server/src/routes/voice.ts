import { Router } from 'express';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { VoiceService } from '../voice/livekit.js';
import { requireSession, type SessionLocals } from './auth.js';

export function voiceRoutes(rooms: RoomManager, voice: VoiceService) {
  const router = Router();

  router.post('/api/rooms/:code/voice-token', requireSession(rooms), async (_req, res) => {
    const { room, player } = res.locals as SessionLocals;
    const token = await voice.createToken(
      room.code,
      { identity: player.id, name: player.nickname },
      !room.voiceMuted,
    );
    res.json({ url: voice.publicUrl, token });
  });

  return router;
}
