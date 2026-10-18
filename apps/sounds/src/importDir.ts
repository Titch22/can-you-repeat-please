import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SoundLabelSchema } from '@cyrp/shared';
import type { Library } from './library.js';
import { checkAudio, LibraryError } from './validate.js';

const AUDIO_EXT = /\.(mp3|ogg|wav|webm|m4a)$/i;

/** Optional manifest.json: stable ids and nicer labels for the files. */
const Manifest = z.object({
  sounds: z.array(z.object({ id: z.string(), file: z.string(), label: z.string() })),
});

export interface ImportReport {
  added: string[];
  skipped: { file: string; reason: string }[];
}

/**
 * Adds every audio file of `dir` to the library with `tags`. Files already in the library
 * (same bytes) or failing the upload rules are skipped and reported.
 */
export async function importDir(library: Library, dir: string, tags: string[]) {
  const report: ImportReport = { added: [], skipped: [] };
  const manifestPath = path.join(dir, 'manifest.json');
  const entries = fs.existsSync(manifestPath)
    ? Manifest.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).sounds
    : fs
        .readdirSync(dir)
        .filter((f) => AUDIO_EXT.test(f))
        .sort()
        .map((file) => ({ id: undefined, file, label: file.replace(AUDIO_EXT, '') }));

  for (const entry of entries) {
    try {
      const data = fs.readFileSync(path.join(dir, entry.file));
      const { format, durationMs } = await checkAudio(data);
      if (library.findDuplicate(data)) throw new LibraryError('DUPLICATE');
      const label = SoundLabelSchema.safeParse(entry.label);
      const sound = library.add({
        id: entry.id,
        label: label.success ? label.data : entry.label.trim().slice(0, 40) || 'Sound',
        tags,
        durationMs,
        format,
        data,
      });
      report.added.push(sound.id);
    } catch (err) {
      const reason = err instanceof LibraryError ? err.code : String(err);
      report.skipped.push({ file: entry.file, reason });
    }
  }
  return report;
}
