import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  clean: true,
  // The workspace packages ship TypeScript source, so bundle them into the server output.
  // Their own dependencies (music-metadata…) stay external: list them in this package.json too.
  noExternal: ['@cyrp/shared', '@cyrp/audio'],
});
