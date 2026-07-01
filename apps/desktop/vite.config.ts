import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
