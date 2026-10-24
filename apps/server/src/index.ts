import path from 'node:path';
import { createAccounts } from './accounts/store.js';
import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { DEFAULT_TIMING, FAST_TIMING } from './game/timing.js';
import { defaultLimits, noLimits } from './limits.js';
import { createLibraryClient } from './sounds/library.js';
import { createLiveKitVoice } from './voice/livekit.js';

const storage = createAudioStorage(config.paths.tmpRooms);
await storage.wipeAll();

const accounts = createAccounts(path.join(config.paths.data, 'accounts.db'), config.accounts);
const firstCode = accounts.firstAccountCode();
if (firstCode) console.log(`[accounts] no account yet: sign up with the code ${firstCode}`);

const voice = createLiveKitVoice(config.livekit);
const library = createLibraryClient(config.soundsUrl, config.soundsSecret);
const timing = process.env.GAME_FAST === '1' ? FAST_TIMING : DEFAULT_TIMING;

const { server } = createApp({
  storage,
  accounts,
  voice,
  library,
  timing,
  maxRooms: config.maxRooms,
  limits: config.rateLimits ? defaultLimits() : noLimits(),
});
if (!config.rateLimits) console.warn('[server] rate limits are OFF (RATE_LIMITS=off)');
server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
