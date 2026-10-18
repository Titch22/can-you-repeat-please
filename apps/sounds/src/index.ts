import { createSoundsApp } from './app.js';
import { config } from './config.js';
import { Library } from './library.js';

const library = new Library(config.dataDir, config.publicUrl);

const app = createSoundsApp({
  library,
  adminToken: config.adminToken,
  clientOrigin: config.clientOrigin,
});
app.listen(config.port, () => {
  console.log(`[sounds] ${library.count()} sounds, listening on http://localhost:${config.port}`);
});
