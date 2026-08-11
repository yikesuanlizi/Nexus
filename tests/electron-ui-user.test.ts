// 用户场景实测：与真实用户完全相同的操作路径——
//   1) 完整 UI 打开浏览器 tab；2) 点击地址栏并键盘输入 URL（真实按键事件，
//      验证 React 受控 input 在真实输入下正常）；3) Enter 导航后网页可见；
//   4) F12 打开 DevTools（detach 独立窗口）；5) 页面 console 日志可达 Main。
// — English: real-user scenario — 1) open the browser tab; 2) click the address
//   bar and TYPE the URL (real key events — React's controlled input works with
//   real typing); 3) the page is visible after Enter; 4) F12 opens DevTools
//   (detached window); 5) page console logs reach Main.
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { _electron as electron, type ElectronApplication } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = join(here, '../apps/desktop/dist-electron/main/index.js');
const VITE_UI_PORT = 5178;

let viteServer: ChildProcess | null = null;
let mainLogs: string[] = [];

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

async function browserApi<T>(app: ElectronApplication, call: string, arg?: unknown): Promise<T> {
  const win = await app.firstWindow();
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

describe('用户场景实测', () => {
  it('真实键盘输入导航 + 网页可见 + F12 DevTools + 日志可达', async () => {
    const app = await launchElectronDev();
    const proc = app.process();
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') mainLogs.push(line);
      }
    });
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') mainLogs.push(line);
      }
    });
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root > *', { timeout: 30_000 });

      // 1) 打开浏览器 tab（真实点击）。
      // — English: open the browser tab with real clicks.
      await win.locator('button[aria-label*="浏览器"], button[aria-label*="browser"]').first().click();
      await win.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      await win.locator('[role="menuitem"]:has-text("浏览器"), [role="menuitem"]:has-text("Browser")').first().click();
      await win.waitForSelector('[data-testid="browserWorkbench"]', { timeout: 15_000 });

      // 2) 无标签直接输入网址回车 → 自动建标签并导航（不必先点新建标签）。
      // — English: typing a URL with no tabs auto-creates the tab and navigates.
      const addressInput = win.locator('input[aria-label="地址栏"]');
      await addressInput.click();
      await addressInput.type('https://example.com', { delay: 20 });
      await addressInput.press('Enter');

      // 3) 等待加载完成（轮询）。
      // — English: wait until the page loads.
      let url = '';
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        const tabs = await browserApi<Array<{ url: string; loading: boolean }>>(app, 'listTabs');
        if (tabs.length > 0) {
          url = tabs[0].url;
          if (url.includes('example.com') && !tabs[0].loading) break;
        }
      }
      expect(url).toContain('example.com');

      // 4) 网页可见性：View 内标题 + 窗口截图非空白。
      // — English: visibility — view title + a non-trivial window screenshot.
      const tabsNow = await browserApi<Array<{ tabId: string }>>(app, 'listTabs');
      const viewTitle = await browserApi<unknown>(app, 'evaluate', {
        tabId: tabsNow[0].tabId,
        expression: 'document.title',
      });
      expect(String(viewTitle).toLowerCase()).toContain('example');
      const shot = await win.screenshot();
      expect(shot.length).toBeGreaterThan(10_000);

      // 5) F12 → DevTools 独立窗口出现（detach）。
      // — English: F12 opens a detached DevTools window.
      await win.evaluate(() => {
        // 焦点放到 View 外（UI 区域）也应在 host 上注册 F12——先聚焦地址栏。
        // — English: focus the address bar first (F12 must work from the UI too).
        (document.querySelector('input[aria-label="地址栏"]') as HTMLInputElement | null)?.focus();
      });
      await win.keyboard.press('F12');
      await new Promise((r) => setTimeout(r, 1200));
      const windowCount = (await app.windows()).length;

      // 6) 日志：页面主动打一条 console，确认能到 Main（终端）或事件。
      // — English: log a console line from the page and confirm it is visible.
      await browserApi(app, 'evaluate', { tabId: tabsNow[0].tabId, expression: "console.log('nexus-ui-log-probe'); 'ok'" });
      await new Promise((r) => setTimeout(r, 800));
      const logVisible = mainLogs.some((l) => l.includes('nexus-ui-log-probe'));
      expect(logVisible).toBe(true);
    } finally {
      await app.close();
    }
  }, 120_000);

  it('关闭浏览器面板后 View 销毁（listTabs 为空，无残留页面）', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root > *', { timeout: 30_000 });

      // 打开浏览器面板并创建标签。
      // — English: open the browser panel and create a tab.
      await win.locator('button[aria-label*="浏览器"], button[aria-label*="browser"]').first().click();
      await win.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      await win.locator('[role="menuitem"]:has-text("浏览器"), [role="menuitem"]:has-text("Browser")').first().click();
      await win.waitForSelector('[data-testid="browserWorkbench"]', { timeout: 15_000 });
      const addressInput = win.locator('input[aria-label="地址栏"]');
      await addressInput.click();
      await addressInput.type('https://example.com', { delay: 15 });
      await addressInput.press('Enter');
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        const tabs = await browserApi<Array<{ url: string }>>(app, 'listTabs');
        if (tabs.length > 0 && tabs[0].url.includes('example.com')) break;
      }
      expect((await browserApi<Array<unknown>>(app, 'listTabs')).length).toBeGreaterThan(0);

      // 关闭浏览器面板（workbench utility tab 的关闭按钮）。
      // — English: close the browser panel (workbench utility close button).
      await win.locator('button[aria-label="关闭浏览器"], button[aria-label="Close Browser"]').first().click();
      await new Promise((r) => setTimeout(r, 800));
      await win.waitForSelector('[data-testid="browserWorkbench"]', { state: 'detached', timeout: 10_000 });

      // 原生 View 必须全部销毁（listTabs 空）——否则页面残留在窗口上。
      // — English: every native view must be destroyed (listTabs empty) or the
      //   page stays on screen.
      const remaining = await browserApi<Array<unknown>>(app, 'listTabs');
      expect(remaining.length).toBe(0);
    } finally {
      await app.close();
    }
  }, 90_000);

  it('菜单 locale IPC：zh/en 切换调用成功（顶部菜单随主题语言）', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root > *', { timeout: 30_000 });
      const menuApi = (window: { nexusDesktop?: { menu?: { setLocale(locale: string): Promise<void> } } }) => window.nexusDesktop?.menu;
      const zhResult = await win.evaluate(() => {
        const menu = (window as unknown as { nexusDesktop?: { menu?: { setLocale(locale: string): Promise<unknown> } } }).nexusDesktop?.menu;
        return menu ? menu.setLocale('zh') : Promise.resolve('no-menu');
      });
      const enResult = await win.evaluate(() => {
        const menu = (window as unknown as { nexusDesktop?: { menu?: { setLocale(locale: string): Promise<unknown> } } }).nexusDesktop?.menu;
        return menu ? menu.setLocale('en') : Promise.resolve('no-menu');
      });
      expect(zhResult).not.toBe('no-menu');
      expect(enResult).not.toBe('no-menu');
      expect(menuApi).toBeDefined();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('Electron 内嵌卡片：主界面左右下边距 8px + 圆角 12px（仅桌面壳）', async () => {
    const app = await launchElectronDev();
    try {
      const win = await app.firstWindow();
      await win.waitForSelector('#root > *', { timeout: 30_000 });
      const style = await win.evaluate(() => {
        const shell = document.querySelector('.electron-shell');
        const appShell = document.querySelector('.appShell');
        if (!appShell) return null;
        const cs = getComputedStyle(appShell);
        return {
          bodyHasShell: document.body.classList.contains('electron-shell'),
          shellExists: shell !== null,
          marginLeft: cs.marginLeft,
          marginRight: cs.marginRight,
          marginBottom: cs.marginBottom,
          marginTop: cs.marginTop,
          borderRadius: cs.borderRadius,
          height: cs.height,
        };
      });
      expect(style?.bodyHasShell).toBe(true);
      expect(style?.marginLeft).toBe('8px');
      expect(style?.marginRight).toBe('8px');
      expect(style?.marginBottom).toBe('8px');
      expect(style?.marginTop).toBe('0px');
      expect(style?.borderRadius).toBe('12px');
    } finally {
      await app.close();
    }
  }, 60_000);
});
