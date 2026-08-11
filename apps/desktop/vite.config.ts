import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相对 base：打包产物用 file:// 加载（Electron 生产模式），web 独立构建不受影响。
  // — English: relative base so the packaged UI loads via file:// (Electron
  //   production mode); the standalone web build is unaffected.
  base: './',
  resolve: {
    alias: {
      '@nexus/protocol': resolve(appDir, '../../packages/protocol/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    watch: {
      ignored: ['**/node_modules/**', '**/node_modules.*/**', '**/dist/**', '**/dist-types/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:4127',
    },
  },
});
