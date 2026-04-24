import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3000';
const wsTarget = apiTarget.replace(/^http/, 'ws');

// Build ID threads through to the service worker registration URL so
// every frontend build produces a fresh SW (browsers key SWs by byte
// identity, and the version lives in the ?v= query string).
const BUILD_ID = process.env.BUILD_ID || String(Date.now());

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
