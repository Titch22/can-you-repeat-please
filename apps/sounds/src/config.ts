import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const production = process.env.NODE_ENV === 'production';

// Shared with the game server, which signs the tokens of logged-in users (see soundsToken.ts).
const secret = process.env.SOUNDS_SECRET ?? (production ? '' : 'dev-sounds-secret');
if (production && secret.length < 16) {
  throw new Error('SOUNDS_SECRET must be set (16+ characters) in production');
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  /** Checks the tokens the game server signs for logged-in users. */
  secret,
  /** Each user's sounds together (files as uploaded, backgrounds included). */
  quotaBytes: Number(process.env.USER_SOUNDS_QUOTA_MB ?? 200) * 1024 * 1024,
  /**
   * Prefix of the file URLs handed out: the public origin in production
   * (https://sounds.example.com), the web dev server's proxy path in development.
   */
  publicUrl: (process.env.SOUNDS_PUBLIC_URL ?? '/sounds-api').replace(/\/$/, ''),
  /** Holds library.db and files/. A Docker volume in production. */
  dataDir: process.env.SOUNDS_DATA_DIR ?? path.join(repoRoot, 'data/sounds'),
};
