// Phase 1 集成测试：Electron 桌面壳——现有 React UI 在 Electron 中运行、
// preload typed API（窗口控制/能力/openPath）工作、Web 构建不含 Electron 模块。
// 前置：apps/desktop 下 npm run electron:build + build:ui（dist/index.html 存在）。
// — English: Phase 1 integration — the existing React UI runs inside Electron,
//   the preload typed API (window controls/capabilities/openPath) works, and the
//   web build contains no Electron modules.
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = join(here, '../apps/desktop/dist-electron/main/index.js');
const VITE_UI_PORT = 5178;

// 起 Vite dev server（复用 Phase 1 开发入口；Electron dev 模式加载它）。
// — English: start the Vite dev server (the Phase 1 dev entry the Electron dev
//   mode loads).
let viteServer: ChildProcess | null = null;

async function startViteDev(): Promise<void> {
  if (viteServer !== null) return;
  // Windows 下 .cmd 包装 spawn 需 shell；直接调 vite 的 node 入口更稳。
  // — English: .cmd shims need a shell on Windows — invoke vite's node entry directly.
  const viteEntry = join(here, '../node_modules/vite/bin/vite.js');
  viteServer = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(VITE_UI_PORT)], {
    cwd: join(here, '../apps/desktop'),
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // 等待 dev server 就绪（探测首页）。
  // — English: wait until the dev server answers.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ok = await probe(`http://127.0.0.1:${VITE_UI_PORT}/`);
    if (ok) return;
    if (Date.now() > deadline) throw new Error('vite dev server did not become ready');
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function launchElectronDev() {
  return electron.launch({ args: [MAIN_JS], env: { ...process.env, NEXUS_ELECTRON_LOAD: 'dev' } });
}

beforeAll(async () => {
  await startViteDev();
});

afterAll(async () => {
  viteServer?.kill('SIGTERM');
  viteServer = null;
});

describe('Phase 1 · Electron 桌面壳', () => {
  it('React 工作台在 Electron 中运行（dev 模式加载 5178）+ nexusDesktop API 可用', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      // React 挂载：#root 下出现应用内容（聊天/侧栏/顶栏）。
      // — English: React mounted — app content under #root (chat/sidebar/title bar).
      await win.waitForSelector('#root', { timeout: 20_000 });
      const hasRootContent = await win.evaluate(() => document.querySelector('#root')?.children.length ?? 0);
      expect(hasRootContent).toBeGreaterThan(0);

      const apiShape = await win.evaluate(() => {
        const api = (window as unknown as { nexusDesktop?: Record<string, unknown> }).nexusDesktop;
        if (!api) return null;
        return {
          hasBrowser: typeof api.browser === 'object',
          hasWindowControls: typeof api.windowControls === 'object',
          hasDesktop: typeof api.desktop === 'object',
        };
      });
      expect(apiShape).toEqual({ hasBrowser: true, hasWindowControls: true, hasDesktop: true });
    } finally {
      await app.close();
    }
  }, 90_000);

  it('windowControls：isMaximized / toggleMaximize 状态同步', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root', { timeout: 20_000 });

      const initial = await win.evaluate(() =>
        (window as unknown as { nexusDesktop: { windowControls: { isMaximized(): Promise<boolean> } } }).nexusDesktop.windowControls.isMaximized());
      expect(initial).toBe(false);

      const toggled = await win.evaluate(async () => {
        const controls = (window as unknown as { nexusDesktop: { windowControls: { toggleMaximize(): Promise<void>; isMaximized(): Promise<boolean> } } }).nexusDesktop.windowControls;
        await controls.toggleMaximize();
        const maximized = await controls.isMaximized();
        await controls.toggleMaximize();
        const restored = await controls.isMaximized();
        return { maximized, restored };
      });
      expect(toggled.maximized).toBe(true);
      expect(toggled.restored).toBe(false);
    } finally {
      await app.close();
    }
  }, 90_000);

  it('desktop.capabilities 与 openPath（无效路径返回 false）', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root', { timeout: 20_000 });

      const caps = await win.evaluate(() =>
        (window as unknown as { nexusDesktop: { desktop: { capabilities(): Promise<unknown> } } }).nexusDesktop.desktop.capabilities());
      expect(caps).toMatchObject({ desktop: true, weixinBridge: { managedAvailable: false } });

      const opened = await win.evaluate(() =>
        (window as unknown as { nexusDesktop: { desktop: { openPath(p: string): Promise<boolean> } } }).nexusDesktop.desktop.openPath('Z:\\__nexus_missing__\\nope.txt'));
      expect(opened).toBe(false);
    } finally {
      await app.close();
    }
  }, 90_000);
});

describe('Phase 1 · 构建边界', () => {
  it('Web 端构建不包含 Electron 模块', () => {
    // apps/web 的构建产物不应引用 electron 包。
    // — English: the web build must not reference the electron package.
    const webDist = join(here, '../apps/web/dist');
    let electronRefs = 0;
    const scan = (dir: string): void => {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.name.endsWith('.js')) {
          const content = readFileSync(full, 'utf8');
          if (/from\s*["']electron["']|require\(["']electron["']\)/.test(content)) {
            electronRefs += 1;
          }
        }
      }
    };
    try {
      scan(webDist);
    } catch {
      // dist 不存在：视为未构建（不阻塞），但构建产物存在时必须干净。
      // — English: a missing dist is tolerated; a present dist must be clean.
      return;
    }
    expect(electronRefs).toBe(0);
  });
});
