import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
  },
  {
    entry: ['src/cli/index.ts'],
    format: ['cjs'],
    sourcemap: true,
    outDir: 'dist/cli',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
]);
