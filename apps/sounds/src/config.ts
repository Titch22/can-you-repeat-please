import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const production = process.env.NODE_ENV === 'production';

const adminToken = process.env.SOUNDS_ADMIN_TOKEN ?? (production ? '' : 'dev-admin');
if (production && adminToken.length < 16) {
  throw new Error('SOUNDS_ADMIN_TOKEN must be set (16+ characters) in production');
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  /** Bearer token for the write endpoints (admin page). */
  adminToken,
  /**
   * Prefix of the file URLs handed out: the public origin in production
   * (https://sounds.example.com), the web dev server's proxy path in development.
   */
  publicUrl: (process.env.SOUNDS_PUBLIC_URL ?? '/sounds-api').replace(/\/$/, ''),
  /** Holds library.db and files/. A Docker volume in production. */
  dataDir: process.env.SOUNDS_DATA_DIR ?? path.join(repoRoot, 'data/sounds'),
};
