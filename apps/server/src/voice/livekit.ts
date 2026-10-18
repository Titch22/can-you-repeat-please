import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

export interface VoiceParticipant {
  identity: string;
  name: string;
}

/** What the game server needs from the voice backend. Faked in tests. */
export interface VoiceService {
  publicUrl: string;
  createToken(code: string, who: VoiceParticipant, canPublish: boolean): Promise<string>;
  /** Grants or revokes mic publishing for everyone currently in the voice room. */
  setPublishAllowed(code: string, allowed: boolean): Promise<void>;
  removeParticipant(code: string, identity: string): Promise<void>;
  closeRoom(code: string): Promise<void>;
}

export const voiceRoomName = (code: string) => `cyrp-${code}`;

/** Voice only: no camera, no screen share, no data messages. */
const permission = (canPublish: boolean) => ({
  canPublish,
  canPublishSources: [TrackSource.MICROPHONE],
  canSubscribe: true,
  canPublishData: false,
});

/** Errors from LiveKit (participant already gone, room never created…) must not break the game. */
const swallow = (what: string) => (err: unknown) => {
  console.warn(`[voice] ${what} failed:`, err instanceof Error ? err.message : err);
};

export function createLiveKitVoice(opts: {
  url: string;
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
}): VoiceService {
  const api = new RoomServiceClient(opts.url.replace(/^ws/, 'http'), opts.apiKey, opts.apiSecret);

  return {
    publicUrl: opts.publicUrl,

    async createToken(code, who, canPublish) {
      const token = new AccessToken(opts.apiKey, opts.apiSecret, {
        identity: who.identity,
        name: who.name,
        // Only needs to be valid when connecting (a fresh one is fetched for every connection):
        // short, so a kicked player can't come back with the one they had.
        ttl: '2m',
      });
      token.addGrant({
        room: voiceRoomName(code),
        roomJoin: true,
        ...permission(canPublish),
      });
      return token.toJwt();
    },

    async setPublishAllowed(code, allowed) {
      const room = voiceRoomName(code);
      const participants = await api.listParticipants(room).catch(() => []);
      await Promise.all(
        participants.map((p) =>
          api
            .updateParticipant(room, p.identity, { permission: permission(allowed) })
            .catch(swallow(`updateParticipant ${p.identity}`)),
        ),
      );
    },

    async removeParticipant(code, identity) {
      await api.removeParticipant(voiceRoomName(code), identity).catch(() => {});
    },

    async closeRoom(code) {
      await api.deleteRoom(voiceRoomName(code)).catch(() => {});
    },
  };
}
