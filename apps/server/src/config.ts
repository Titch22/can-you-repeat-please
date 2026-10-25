import { MAX_ROOMS } from '@cyrp/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  /** Enables debug-only socket events (e.g. the lobby "test recording mute" button). */
  debug: process.env.NODE_ENV !== 'production',
  /** Behind HTTPS: session cookies are sent over HTTPS only. */
  production: process.env.NODE_ENV === 'production',
  accounts: {
    /** ACCOUNT_CREATION=open: anyone can sign up. Otherwise a code from an admin is needed. */
    openSignup: process.env.ACCOUNT_CREATION === 'open',
    /** Usernames (case-insensitive) with the account admin pages. */
    admins: (process.env.ADMIN_USERNAMES ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  },
  livekit: {
    /** Used by the server to call the LiveKit API. */
    url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    /** Handed to browsers; differs from `url` when LiveKit is reached through a public hostname. */
    publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: required('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: required('LIVEKIT_API_SECRET', 'secret'),
  },
  /** Open rooms at once (default MAX_ROOMS); the e2e tests raise it. */
  maxRooms: Number(process.env.MAX_ROOMS ?? MAX_ROOMS),
  /** RATE_LIMITS=off disables per-client limits (e2e tests: every player is on localhost). */
  rateLimits: process.env.RATE_LIMITS !== 'off',
  /** The sound library service (apps/sounds), as reached from this server. */
  soundsUrl: process.env.SOUNDS_INTERNAL_URL ?? 'http://localhost:3100',
  /** Signs the tokens the sounds service accepts (the same SOUNDS_SECRET as there). */
  soundsSecret: soundsSecret(),
  /** The sound library as browsers reach it (allowed by the web app's CSP). */
  soundsPublicUrl: process.env.SOUNDS_PUBLIC_URL,
  paths: {
    /** Lasting data (the accounts database). A Docker volume in production. */
    data: process.env.DATA_DIR ?? path.join(repoRoot, 'data/game'),
    tmpRooms: path.join(repoRoot, 'tmp/rooms'),
    /** Built web app (`pnpm --filter @cyrp/web build`); served when present, i.e. in production. */
    webDist: path.join(repoRoot, 'apps/web/dist'),
  },
};

/** An env variable; in development, `devDefault` if unset. Production refuses to start without it. */
function required(name: string, devDefault: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  return devDefault;
}

function soundsSecret() {
  const secret =
    process.env.SOUNDS_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-sounds-secret');
  if (secret.length < 16 && process.env.NODE_ENV === 'production') {
    throw new Error('SOUNDS_SECRET must be set (16+ characters) in production');
  }
  return secret;
}
