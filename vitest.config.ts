import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@nexus/protocol': resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@nexus/model-gateway': resolve(__dirname, 'packages/model-gateway/src/index.ts'),
      '@nexus/sandbox': resolve(__dirname, 'packages/sandbox/src/index.ts'),
      '@nexus/storage': resolve(__dirname, 'packages/storage/src/index.ts'),
      '@nexus/tools': resolve(__dirname, 'packages/tools/src/index.ts'),
      '@nexus/memory': resolve(__dirname, 'packages/memory/src/index.ts'),
      '@nexus/extensions': resolve(__dirname, 'packages/extensions/src/index.ts'),
      '@nexus/i18n': resolve(__dirname, 'packages/i18n/src/index.ts'),
      '@nexus/bot': resolve(__dirname, 'packages/bot/src/index.ts'),
      '@nexus/runtime': resolve(__dirname, 'packages/runtime/src/index.ts'),
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
