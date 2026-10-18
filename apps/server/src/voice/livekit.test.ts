import { describe, expect, it } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import { createLiveKitVoice, voiceRoomName } from './livekit.js';

const opts = {
  url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
  publicUrl: 'ws://public.test',
  apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
};
const voice = createLiveKitVoice(opts);

const livekitUp = await fetch(opts.url.replace(/^ws/, 'http'))
  .then((r) => r.ok)
  .catch(() => false);

describe('LiveKit voice adapter', () => {
  it('mints a short-lived, room-scoped, microphone-only token', async () => {
    const verifier = new TokenVerifier(opts.apiKey, opts.apiSecret);
    const claims = await verifier.verify(
      await voice.createToken('ABCD', { identity: 'p1', name: 'Alice' }, false),
    );
    expect(claims.sub).toBe('p1');
    expect(claims.name).toBe('Alice');
    expect(claims.video).toMatchObject({
      room: voiceRoomName('ABCD'),
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    });
    // Voice only (no camera or screen share), and only valid long enough to connect.
    expect(claims.video?.canPublishSources).toEqual(['microphone']);
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(120);
  });

  it.skipIf(!livekitUp)('tolerates rooms and participants that do not exist', async () => {
    await expect(voice.setPublishAllowed('ZZZZ', false)).resolves.toBeUndefined();
    await expect(voice.removeParticipant('ZZZZ', 'nobody')).resolves.toBeUndefined();
    await expect(voice.closeRoom('ZZZZ')).resolves.toBeUndefined();
  });
});
