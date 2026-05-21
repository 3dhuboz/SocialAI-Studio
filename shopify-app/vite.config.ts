import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Shopify embedded app build. Outputs to dist/; the static bundle is hosted
// on Cloudflare Pages at the URL configured in shopify.app.toml as
// `application_url` (https://app.socialaistudio.au — Pages project
// `socialai-shopify` with that domain as a custom CNAME, because Shopify
// Partners rejects URLs containing "shopify" in the hostname).
//
// The Shopify API key is injected into index.html at build time via the
// VITE_SHOPIFY_API_KEY env var so App Bridge can identify the app. The
// worker API base URL is read from VITE_API_BASE_URL at runtime.
//
// During `vite dev`, Shopify CLI typically tunnels HTTPS in front of this
// HTTP dev server; no extra config needed here. Port chosen to not clash
// with the main app (5174) or its preview (5173).
//
// Fail-fast guard (build only): if VITE_SHOPIFY_API_KEY is unset, the
// 2026-05-21 outage repeats — Vite ships the literal `%VITE_SHOPIFY_API_KEY%`
// placeholder into dist/index.html, App Bridge can't identify the app, and
// merchants see a frozen "Connecting to your shop…" spinner with no
// console error. Bail loudly here so we never ship a broken bundle again.
// The check is gated to `command === 'build'` so dev mode (which surfaces
// the same problem as a recoverable browser-console error) isn't blocked.
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), '');
    if (!env.VITE_SHOPIFY_API_KEY) {
      console.error(
        '\n[shopify-app] BUILD FAILED: VITE_SHOPIFY_API_KEY is not set.\n' +
        '\n' +
        '  Required so App Bridge can identify this app at runtime. Without\n' +
        '  it, the built HTML contains the literal `%VITE_SHOPIFY_API_KEY%`\n' +
        '  placeholder and merchants get a permanent "Connecting to your\n' +
        '  shop…" hang.\n' +
        '\n' +
        '  Fix one of two ways:\n' +
        '    a) Inline:  VITE_SHOPIFY_API_KEY=<client-id> npm run build\n' +
        '    b) .env.local:  copy .env.example → .env.local + fill the value\n' +
        '\n' +
        '  Get the value from /shopify.app.toml `client_id` or\n' +
        '  Partners → Apps → SocialAI Studio → API credentials.\n',
      );
      process.exit(1);
    }
  }
  return {
    plugins: [react()],
    server: { port: 5180 },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            polaris: ['@shopify/polaris'],
            icons: ['@shopify/polaris-icons'],
            appbridge: ['@shopify/app-bridge-react'],
          },
        },
      },
    },
  };
});
