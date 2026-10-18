import { MAX_ROOMS } from '@cyrp/shared';
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
  /** Open rooms at once (default MAX_ROOMS); the e2e tests raise it. */
  maxRooms: Number(process.env.MAX_ROOMS ?? MAX_ROOMS),
  /** RATE_LIMITS=off disables per-client limits (e2e tests: every player is on localhost). */
  rateLimits: process.env.RATE_LIMITS !== 'off',
  /** The sound library service (apps/sounds), as reached from this server. */
  soundsUrl: process.env.SOUNDS_INTERNAL_URL ?? 'http://localhost:3100',
  /** The sound library as browsers reach it (allowed by the web app's CSP). */
  soundsPublicUrl: process.env.SOUNDS_PUBLIC_URL,
  paths: {
    tmpRooms: path.join(repoRoot, 'tmp/rooms'),
    /** Built web app (`pnpm --filter @cyrp/web build`); served when present, i.e. in production. */
    webDist: path.join(repoRoot, 'apps/web/dist'),
  },
};
