import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.tsx' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: false,
    target: 'node20',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: { lib: 'src/lib.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    target: 'node20',
  },
]);
