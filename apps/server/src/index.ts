import { createApp } from './app.js';
import { createAudioStorage } from './audio/storage.js';
import { config } from './config.js';

const storage = createAudioStorage(config.paths.tmpRooms);
await storage.wipeAll();

const { server } = createApp({ storage });
server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
