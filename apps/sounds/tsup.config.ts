import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', import: 'src/cli/import.ts' },
  format: 'esm',
  target: 'node24',
  clean: true,
  // The workspace packages ship TypeScript source, so bundle them into the output.
  // Their own dependencies (music-metadata…) stay external: list them in this package.json too.
  noExternal: ['@cyrp/shared', '@cyrp/audio'],
  // Keep "node:" in imports: `node:sqlite` only exists with the prefix.
  removeNodeProtocol: false,
});
