import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@nexus/bot': resolve(__dirname, 'packages/bot/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: [
      'tests/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/.nexus/**',
      '**/outputs/**',
    ],
  },
});
