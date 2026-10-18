import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { DEFAULT_TIMING, FAST_TIMING } from './game/timing.js';
import { createLibraryClient } from './sounds/library.js';
import { createLiveKitVoice } from './voice/livekit.js';

const storage = createAudioStorage(config.paths.tmpRooms);
await storage.wipeAll();

const voice = createLiveKitVoice(config.livekit);
const library = createLibraryClient(config.soundsUrl);
const timing = process.env.GAME_FAST === '1' ? FAST_TIMING : DEFAULT_TIMING;

const { server } = createApp({ storage, voice, library, timing });
server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
