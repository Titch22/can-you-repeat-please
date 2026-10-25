import { createSoundsApp } from './app.js';
import { config } from './config.js';
import { Library } from './library.js';
import { createAligner } from './align.js';
import { createTranscriber } from './transcribe.js';
import { createDownloader } from './download.js';

const library = new Library(config.dataDir, config.publicUrl);

const app = createSoundsApp({
  library,
  secret: config.secret,
  quotaBytes: config.quotaBytes,
  clientOrigin: config.clientOrigin,
  transcribe: createTranscriber(config.dataDir),
  align: createAligner(config.dataDir),
  download: createDownloader(),
});
app.listen(config.port, () => {
  console.log(`[sounds] ${library.count()} sounds, listening on http://localhost:${config.port}`);
});
