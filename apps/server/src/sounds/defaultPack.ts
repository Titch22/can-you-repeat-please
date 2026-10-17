import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SoundRef } from '@cyrp/shared';

const Manifest = z.object({
  sounds: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      label: z.string(),
      durationMs: z.number().int().positive(),
    }),
  ),
});

/** Reads sounds/default/manifest.json. Files are served statically at /sounds/default/. */
export function loadDefaultPack(dir: string): SoundRef[] {
  const manifest = Manifest.parse(
    JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
  );
  return manifest.sounds.map((s) => ({
    id: `default:${s.id}`,
    label: s.label,
    durationMs: s.durationMs,
    url: `/sounds/default/${encodeURIComponent(s.file)}`,
  }));
}
