import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  /** Enables debug-only socket events (e.g. the lobby "test recording mute" button). */
  debug: process.env.NODE_ENV !== 'production',
  livekit: {
    /** Used by the server to call the LiveKit API. */
    url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    /** Handed to browsers; differs from `url` when LiveKit is reached through a public hostname. */
    publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  },
  paths: {
    defaultSounds: path.join(repoRoot, 'sounds/default'),
    tmpRooms: path.join(repoRoot, 'tmp/rooms'),
  },
};
