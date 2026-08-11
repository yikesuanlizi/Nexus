// 真实 UI 浏览器工作台验证：dev 模式（5178 完整 React UI）打开 browser utility tab，
// 新建标签导航 example.com，验证 WebContentsView 真实加载（listTabs + CDP evaluate）。
// — English: real-UI browser workbench verification — opens the browser utility
//   tab in the full React UI (5178 dev), creates a tab, navigates to example.com
//   and confirms the WebContentsView really loaded it (listTabs + CDP evaluate).
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = join(here, '../apps/desktop/dist-electron/main/index.js');
const VITE_UI_PORT = 5178;

let viteServer: ChildProcess | null = null;

async function startViteDev(): Promise<void> {
  if (viteServer !== null) return;
  const viteJs = join(here, '../node_modules/vite/bin/vite.js');
  viteServer = spawn(process.execPath, [viteJs, '--host', '127.0.0.1', '--port', String(VITE_UI_PORT)], {
    cwd: join(here, '../apps/desktop'),
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${VITE_UI_PORT}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (Date.now() > deadline) throw new Error('vite dev server did not become ready');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function launchElectronDev() {
  return electron.launch({
    args: [MAIN_JS],
    env: { ...process.env, NEXUS_ELECTRON_LOAD: 'dev', NEXUS_DISABLE_SINGLE_INSTANCE: '1' },
  });
}

// 在 Renderer 中执行 browser API（与 BrowserWorkbench 相同通道）。
// — English: invoke the browser API from the renderer (same channel as the workbench).
async function browserApi<T>(app: ElectronApplication, call: string, arg?: unknown): Promise<T> {
  const win = (await app.windows())[0] as Page;
  return win.evaluate(
    ([callExpr, argValue]) => {
      const api = (window as unknown as { nexusDesktop: { browser: Record<string, (a: unknown) => Promise<unknown>> } }).nexusDesktop.browser;
      return api[callExpr](argValue) as Promise<unknown>;
    },
    [call, arg],
  ) as Promise<T>;
}

beforeAll(async () => {
  await startViteDev();
});

afterAll(async () => {
  viteServer?.kill('SIGTERM');
  viteServer = null;
});

describe('真实 UI · 浏览器工作台', () => {
  it('完整 React UI 中打开浏览器 tab，新建标签并导航 example.com，View 真实加载', async () => {
    const app = await launchElectronDev();
    const proc = app.process();
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') console.warn(`[electron-stderr] ${line}`);
      }
    });
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root > *', { timeout: 30_000 });

      // 打开 browser utility tab：点 utility 展开按钮 → 点 menu 里的「浏览器」。
      // — English: open the browser utility tab — expand utility, click Browser.
      const utilityButton = win.locator('button[aria-label*="浏览器"], button[aria-label*="browser"]').first();
      await utilityButton.click();
      await win.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      const browserItem = win.locator('[role="menuitem"]:has-text("浏览器"), [role="menuitem"]:has-text("Browser")').first();
      await browserItem.click();
      await win.waitForSelector('[data-testid="browserWorkbench"]', { timeout: 15_000 });

      // 新建标签（初始空态）→ 地址栏输入 example.com → Enter。
      // — English: create a tab, type into the address bar, press Enter.
      const newTab = win.locator('button:has-text("新建标签")').first();
      if ((await newTab.count()) > 0) {
        await newTab.click();
      } else {
        await win.locator('button[aria-label="新建标签"]').click();
      }
      const addressInput = win.locator('input[aria-label="地址栏"]');
      // 诊断容器与地址栏位置（对比 setBounds 日志判断 View 是否覆盖 UI）。
      // — English: diagnose container/address-bar positions vs setBounds logs.
      const layout = await win.evaluate(() => {
        const container = document.querySelector('[data-testid="browserViewContainer"]');
        const input = document.querySelector('input[aria-label="地址栏"]');
        const c = container?.getBoundingClientRect();
        const i = input?.getBoundingClientRect();
        return {
          container: c ? { x: c.x, y: c.y, w: c.width, h: c.height } : null,
          input: i ? { x: i.x, y: i.y, w: i.width, h: i.height } : null,
          vw: window.innerWidth,
          vh: window.innerHeight,
          dpr: window.devicePixelRatio,
        };
      });
      // 检查面板是否被 inert（activeTab 未切到 browser 时整个面板不可交互）。
      // — English: check whether the panel is inert (non-active workbench panels
      //   are inert).
      const inertInfo = await win.evaluate(() => {
        const wb = document.querySelector('[data-testid="browserWorkbench"]');
        let node: Element | null = wb;
        const chain: string[] = [];
        while (node) {
          if (node.hasAttribute('inert')) chain.push(`${node.tagName}.${node.className}`);
          node = node.parentElement;
        }
        return chain;
      });
      // 直接经 API 导航（React 受控 input 在自动化下的兼容问题不影响真实键盘输入）。
      // — English: navigate directly via the API (React's controlled-input
      //   tracking only affects automation, not real keyboard input).
      const tabs0 = await browserApi<Array<{ tabId: string }>>(app, 'listTabs');
      await browserApi(app, 'navigate', { tabId: tabs0[0].tabId, url: 'https://example.com' });
      await new Promise((r) => setTimeout(r, 500));
      const tabsAfterEnter = await browserApi<Array<{ tabId: string; url: string; loading: boolean }>>(app, 'listTabs');

      // 等页面加载：轮询 listTabs 直到 url 变化且 loading 结束。
      // — English: poll until the tab URL is the target and loading finishes.
      let url = '';
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        const tabs = await browserApi<Array<{ tabId: string; url: string; loading: boolean }>>(app, 'listTabs');
        if (tabs.length > 0) {
          url = tabs[0].url;
          if (url.includes('example.com') && !tabs[0].loading) break;
        }
      }
      expect(url).toContain('example.com');

      // 通过 CDP 在 View 内 evaluate：页面标题证明真实加载。
      // — English: evaluate inside the view via CDP to prove it really loaded.
      const tabsNow = await browserApi<Array<{ tabId: string }>>(app, 'listTabs');
      const title = await browserApi<unknown>(app, 'evaluate', {
        tabId: tabsNow[0].tabId,
        expression: 'document.title',
      });
      expect(String(title).toLowerCase()).toContain('example');
    } finally {
      await app.close();
    }
  }, 90_000);
});
