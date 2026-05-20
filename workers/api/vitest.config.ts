// Vitest config for the API worker.
//
// Plain Node-environment vitest for the Worker package — picks up tests
// both colocated (src/**/__tests__) and at the top-level src/__tests__.
// Pinning the config here keeps the worker test run self-contained
// (without this file, vitest walks up and picks up the parent project's
// vite.config.ts, which pulls in the React plugin and emits noisy
// esbuild/oxc warnings).
//
// Why not @cloudflare/vitest-pool-workers? That pool spins up a real
// workerd runtime per test, and its setup (bindings, miniflare config,
// service workers entry point) is brittle and slow. The vast majority
// of our worker logic is pure — auth crypto, HMAC, prompt builders,
// classification, scoring — and runs perfectly in Node 18+ because
// crypto.subtle, TextEncoder, atob, btoa, fetch, etc. are globals.
//
// For the few tests that need D1 or Env bindings, write thin manual
// mocks (vi.fn() shapes that match c.env.DB.prepare(...).bind(...).run()).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
