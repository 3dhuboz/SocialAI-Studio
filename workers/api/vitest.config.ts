import { defineConfig } from 'vitest/config';

// Plain Node-environment vitest for the Worker package.
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
//
// All tests live alongside the code under test in a __tests__ folder.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
