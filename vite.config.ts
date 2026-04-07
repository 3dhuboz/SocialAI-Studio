import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// When VITE_CLIENT_ID is set (e.g. on a branded Netlify deploy), redirect the
// client.config import to the matching file in src/client.configs/.
// Unset → falls through to the default src/client.config.ts (socialaistudio.au).
const clientId = process.env.VITE_CLIENT_ID;

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          clerk: ['@clerk/react'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  resolve: clientId ? {
    alias: [
      {
        find: /.*\/client\.config(\.ts)?$/,
        replacement: path.resolve(__dirname, `src/client.configs/${clientId}.ts`),
      },
    ],
  } : {},
});
