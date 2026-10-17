import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import { config } from './config.js';
import { createLiveKitVoice } from './voice/livekit.js';

const storage = createAudioStorage(config.paths.tmpRooms);
await storage.wipeAll();

const voice = createLiveKitVoice(config.livekit);

const { server } = createApp({ storage, voice });
server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
