// Vitest config for the API worker.
//
// Without this file, vitest walks up the directory tree and picks up the
// parent project's vite.config.ts — which pulls in the React plugin and
// emits a couple of harmless but noisy esbuild/oxc warnings.  Pinning the
// config here keeps the worker test run self-contained and silent.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
  },
});
