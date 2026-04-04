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
    outDir: 'dist',
    outExtension: () => ({ js: '.js' }),
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/(.*)/],
    platform: 'node',
  },
]);
