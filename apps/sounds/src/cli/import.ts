/**
 * Adds a folder of sounds to the library.
 *   pnpm --filter @cyrp/sounds import <dir> [--tag meme] [--tag animal]
 *   (in the container: node dist/import.js <dir> --tag meme)
 */
import { parseArgs } from 'node:util';
import { TagListSchema } from '@cyrp/shared';
import { config } from '../config.js';
import { importDir } from '../importDir.js';
import { Library } from '../library.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { tag: { type: 'string', multiple: true, default: [] } },
});
const dir = positionals[0];
const tags = TagListSchema.safeParse(values.tag);
if (!dir || !tags.success) {
  console.error(
    'Usage: import <dir> [--tag <tag>]…  (tags: lowercase letters, digits, - and spaces)',
  );
  process.exit(1);
}

const library = new Library(config.dataDir, config.publicUrl);
const report = await importDir(library, dir, tags.data);
library.close();
for (const s of report.skipped) console.log(`skipped ${s.file}: ${s.reason}`);
console.log(`added ${report.added.length} sounds, skipped ${report.skipped.length}`);
