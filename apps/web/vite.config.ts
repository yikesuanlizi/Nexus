import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const apiTarget = (process.env.NEXUS_API_URL || 'http://127.0.0.1:4127').replace(/\/+$/, '');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@nexus/protocol': resolve(appDir, '../../packages/protocol/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
    watch: {
      ignored: ['**/node_modules/**', '**/node_modules.*/**', '**/dist/**', '**/dist-types/**'],
    },
    proxy: {
      '/api': apiTarget,
    },
  },
});
