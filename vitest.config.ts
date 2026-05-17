// Vitest config for the frontend.
//
// Without this file, vitest scans the entire repo and picks up worker tests
// under `workers/api/src/`, which import 'hono' — a worker dependency that
// the frontend doesn't install. Those tests run via `workers/api`'s own
// vitest config (npm test --prefix workers/api in CI).
//
// Exclude pattern keeps the frontend test runner scoped to `src/`.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      'workers/**',
      '.claude/**',
    ],
    environment: 'node',
  },
});
