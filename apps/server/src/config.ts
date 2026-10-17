import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  livekit: {
    url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  },
  paths: {
    defaultSounds: path.join(repoRoot, 'sounds/default'),
    tmpRooms: path.join(repoRoot, 'tmp/rooms'),
  },
};
