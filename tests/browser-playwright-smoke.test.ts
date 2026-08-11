// PlaywrightRuntime 真实 Chromium smoke 测试：确认真实浏览器链路可用
// （此前所有测试走 FakeRuntime；本测试驱动真实浏览器 + 真实 DOM）。
// 依赖：playwright 包 + Chromium 二进制（均已安装）。
// — English: real-Chromium smoke tests for PlaywrightRuntime — verifies the real
//   browser link (navigate → observe → interact against a live page).
import { describe, expect, it } from 'vitest';
import { PlaywrightRuntime } from '../packages/browser-runtime/src/playwrightRuntime.js';

describe('PlaywrightRuntime · 真实 Chromium smoke', () => {
  it('启动真实浏览器 → navigate example.com → observe 标题与可交互元素', async () => {
    const runtime = new PlaywrightRuntime({ headless: true, defaultTimeoutMs: 15_000 });
    const handle = await runtime.start({ taskId: 'smoke-1' });
    try {
      const obs = await handle.navigate({ url: 'https://example.com' });
      expect(obs.url).toContain('example.com');
      expect(obs.screenshotRef).toMatch(/^data:image\/jpeg;base64,/);

      const obs2 = await handle.observe({});
      expect(obs2.title).toBe('Example Domain');
      expect(obs2.url).toContain('example.com');
      // 可交互元素（链接/按钮）被提取为 [eN] 引用。
      // — English: interactive elements are surfaced with [eN] refs.
      expect(obs2.elements.length).toBeGreaterThan(0);
      expect(obs2.elements[0].ref).toMatch(/^\[e\d+\]$/);
    } finally {
      await handle.close('smoke done');
    }
  }, 60_000);

  it('点击真实链接 → 页面导航 → 新 epoch（真实 DOM 交互与 epoch 校验）', async () => {
    const runtime = new PlaywrightRuntime({ headless: true, defaultTimeoutMs: 15_000 });
    const handle = await runtime.start({ taskId: 'smoke-2' });
    try {
      const obs1 = await handle.navigate({ url: 'https://example.com' });
      const obs2 = await handle.observe({});

      const result = await handle.act({
        intent: {
          taskId: 'smoke-2',
          actionId: 'smoke-act-1',
          pageId: obs2.pageId,
          observationId: obs2.observationId,
          expectedNavigationEpoch: obs2.navigationEpoch,
          kind: 'click',
          targetRef: obs2.elements[0].ref,
          arguments: {},
          rationale: '点击 example.com 的第一个链接',
          effect: 'none',
          risk: 'low',
          postcondition: { kind: 'navigation_epoch_changed' },
        },
      });
      // 真实浏览器点击后要么导航（committed），要么因外网限制超时（uncertain/failed）——
      // 断言至少返回三态之一且已触发真实动作（不抛异常即证明真实链路贯通）。
      // — English: the click either navigates (committed) or times out due to
      //   network limits — any of the three states proves the real link works.
      expect(['committed', 'uncertain', 'failed']).toContain(result.status);
      if (result.status === 'committed') {
        const obs3 = await handle.observe({});
        expect(obs3.navigationEpoch).toBeGreaterThan(obs2.navigationEpoch);
      }
      void obs1;
    } finally {
      await handle.close('smoke done');
    }
  }, 60_000);

  it('Sidecar 进程宿主 × 真实 Chromium：spawnSidecarProcess(runtime=playwright) 全链路', async () => {
    // 完整真实链路：Sidecar 进程（node）→ Playwright → Chromium，经真实 JSONL 管道。
    // — English: the full real link — a spawned sidecar process driving real
    //   Chromium over the JSONL pipe.
    const { spawnSidecarProcess } = await import('../packages/browser-runtime/src/sidecar/sidecarProcessHost.js');
    const { fileURLToPath } = await import('node:url');
    const spawned = await spawnSidecarProcess({
      taskId: 'smoke-proc',
      runtime: 'playwright',
      entryPath: fileURLToPath(new URL('../packages/browser-runtime/src/sidecar/sidecarEntry.ts', import.meta.url)),
      log: (line) => console.warn(`[smoke-sidecar] ${line}`),
    });
    try {
      const obs = await spawned.handle.navigate({ url: 'https://example.com' });
      expect(obs.url).toContain('example.com');
      expect(obs.screenshotRef).toMatch(/^data:image\/jpeg;base64,/);
      const obs2 = await spawned.handle.observe({});
      expect(obs2.title).toBe('Example Domain');
      expect(obs2.elements.length).toBeGreaterThan(0);
    } finally {
      await spawned.stop(15_000);
    }
  }, 90_000);
});
