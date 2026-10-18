import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { DEFAULT_TIMING, FAST_TIMING } from './game/timing.js';
import { defaultLimits, noLimits } from './limits.js';
import { createLibraryClient } from './sounds/library.js';
import { createLiveKitVoice } from './voice/livekit.js';

const storage = createAudioStorage(config.paths.tmpRooms);
await storage.wipeAll();

const voice = createLiveKitVoice(config.livekit);
const library = createLibraryClient(config.soundsUrl);
const timing = process.env.GAME_FAST === '1' ? FAST_TIMING : DEFAULT_TIMING;

const { server } = createApp({
  storage,
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
