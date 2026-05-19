import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Shopify embedded app build. Outputs to dist/; the static bundle is hosted
// on Cloudflare Pages at the URL configured in shopify.app.toml as
// `application_url` (e.g. https://shopify.socialaistudio.au).
//
// The Shopify API key is injected into index.html at build time via the
// VITE_SHOPIFY_API_KEY env var so App Bridge can identify the app. The
// worker API base URL is read from VITE_API_BASE_URL at runtime.
//
// During `vite dev`, Shopify CLI typically tunnels HTTPS in front of this
// HTTP dev server; no extra config needed here. Port chosen to not clash
// with the main app (5174) or its preview (5173).
export default defineConfig({
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
});
