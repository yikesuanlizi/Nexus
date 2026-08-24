import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'nexus-source-imports',
      enforce: 'pre',
      resolveId(source, importer) {
        if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) return null;
        const sourcePath = resolve(importer, '..', `${source.slice(0, -3)}.ts`);
        return existsSync(sourcePath) ? sourcePath : null;
      },
    },
  ],
  resolve: {
    alias: {
      '@nexus/protocol': resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@nexus/context': resolve(__dirname, 'packages/context/src/index.ts'),
      '@nexus/model-gateway': resolve(__dirname, 'packages/model-gateway/src/index.ts'),
      '@nexus/sandbox': resolve(__dirname, 'packages/sandbox/src/index.ts'),
      '@nexus/storage': resolve(__dirname, 'packages/storage/src/index.ts'),
      '@nexus/tools': resolve(__dirname, 'packages/tools/src/index.ts'),
      '@nexus/memory': resolve(__dirname, 'packages/memory/src/index.ts'),
      '@nexus/extensions': resolve(__dirname, 'packages/extensions/src/index.ts'),
      '@nexus/i18n': resolve(__dirname, 'packages/i18n/src/index.ts'),
      '@nexus/bot': resolve(__dirname, 'packages/bot/src/index.ts'),
      '@nexus/runtime': resolve(__dirname, 'packages/runtime/src/index.ts'),
      '@nexus/browser-runtime': resolve(__dirname, 'packages/browser-runtime/src/index.ts'),
      '@nexus/wiki-core': resolve(__dirname, 'packages/wiki-core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    // 真实浏览器集成测试（Electron/Chromium）在文件间并发时会互相竞争资源
    // （多个 Electron/Chromium 实例、固定端口 5178）。改为文件级串行：
    // 一次只执行一个测试文件，文件内用例仍可并行。
    // — English: file-level serial execution — the real-browser integration
    //   tests (Electron/Chromium) compete for resources (multiple instances,
    //   fixed port 5178) when files run concurrently.
    fileParallelism: false,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
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
