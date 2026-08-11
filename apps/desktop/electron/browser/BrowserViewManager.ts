// BrowserViewManager：管理 WebContentsView 生命周期（创建/布局/显示/隐藏/销毁）。
// 用户与 Agent 操作的是同一个 View——远程页面绝不挂载 Nexus preload，也不获得
// 任何 Nexus IPC（架构文档 §3.3 / 迁移计划 §3.1）。
// — English: BrowserViewManager owns WebContentsView lifecycle
//   (create/layout/show/hide/destroy). Users and the agent operate the SAME view;
//   remote pages never get the Nexus preload or any Nexus IPC.
import { app, BaseWindow, session, WebContentsView } from 'electron';
import { join } from 'node:path';
import type { BrowserDesktopEvent, BrowserTabState, CreateBrowserTabInput, BrowserViewBounds } from '../contracts/browserTypes.js';
import { BrowserEngineAdapter } from './BrowserEngineAdapter.js';

// 独立 session partition：不复用用户日常 Chrome profile（迁移计划 §3.3）。
// — English: a dedicated session partition — never reuses the user's daily Chrome profile.
const SESSION_PARTITION = 'persist:nexus-browser';

interface ManagedView {
  tabId: string;
  view: WebContentsView;
  url: string;
  title: string;
  visible: boolean;
  favicon?: string;
  loading: boolean;
}

export class BrowserViewManager {
  private readonly views = new Map<string, ManagedView>();
  private readonly host: BaseWindow;
  private readonly emit: (event: BrowserDesktopEvent) => void;
  private nextId = 1;
  // 当前活动标签（用户可见 View；Agent 会话绑定它）。
  // — English: the currently active tab (the user-visible view the agent
  //   session binds to).
  private activeTabId: string | null = null;

  constructor(deps: { host: BaseWindow; emit: (event: BrowserDesktopEvent) => void }) {
    this.host = deps.host;
    this.emit = deps.emit;
    this.hardenBrowserSession();
  }

  // 浏览器会话加固 + 下载管理（单一持久化 partition 会话，Phase 4）。
  // — English: browser session hardening + download management (the single
  //   persistent partition session, Phase 4).
  private hardenBrowserSession(): void {
    const browserSession = session.fromPartition(SESSION_PARTITION);

    // 权限：只放行必要权限，其余一律拒绝（无定位/摄像头/麦克风/通知）。
    // — English: allow only essential permissions; deny everything else.
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
      callback(allowed.has(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) => {
      const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
      return allowed.has(permission);
    });

    // 下载：默认保存到系统下载目录；进度/完成/失败事件转发 UI。
    // — English: downloads save to the system downloads folder; progress / done /
    //   failed events forward to the UI.
    browserSession.on('will-download', (_event, item, webContents) => {
      const tabId = this.tabIdFor(webContents);
      this.emit({ type: 'download-started', tabId, filename: item.getFilename() });
      item.setSavePath(join(app.getPath('downloads'), item.getFilename()));
      item.on('updated', (_e, state) => {
        if (state === 'interrupted') {
          this.emit({ type: 'download-failed', tabId, filename: item.getFilename() });
        } else {
          this.emit({
            type: 'download-progress',
            tabId,
            filename: item.getFilename(),
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
          });
        }
      });
      item.on('done', (_e, state) => {
        if (state === 'completed') {
          this.emit({ type: 'download-completed', tabId, filename: item.getFilename() });
        } else {
          this.emit({ type: 'download-failed', tabId, filename: item.getFilename() });
        }
      });
    });
  }

  // 按 webContents 反查 tabId（下载/权限事件归属）。
  // — English: reverse-map a webContents to its tabId.
  private tabIdFor(webContents: Electron.WebContents): string {
    for (const [tabId, managed] of this.views) {
      if (managed.view.webContents === webContents) return tabId;
    }
    return '';
  }

  // 创建并挂载 View，返回 tabId。远程页面无 preload、无 Node 权限。
  // — English: creates and mounts the view; remote pages have no preload/Node access.
  createTab(input: CreateBrowserTabInput): BrowserTabState {
    const tabId = `tab-${this.nextId++}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: SESSION_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // 关键：远程页面不挂载 Nexus preload（架构文档 §3.3）。
        // — English: critical — remote pages never mount the Nexus preload.
        preload: undefined,
      },
    });
    const managed: ManagedView = {
      tabId,
      view,
      url: input.url,
      title: '',
      visible: true,
      loading: true,
    };
    this.views.set(tabId, managed);
    this.activeTabId = tabId;
    this.host.contentView.addChildView(view);
    this.setBounds(tabId, input.bounds);

    // 页面生命周期事件 → Renderer（Phase 2 子集：loading/title/favicon/navigation/crash）。
    // — English: page lifecycle events → Renderer (Phase 2 subset).
    view.webContents.on('did-start-loading', () => {
      managed.loading = true;
      this.emit({ type: 'loading', tabId, loading: true });
    });
    view.webContents.on('did-stop-loading', () => {
      managed.loading = false;
      this.emit({ type: 'loading', tabId, loading: false });
    });
    view.webContents.on('did-navigate', (_event, url) => {
      managed.url = url;
      this.emit({ type: 'did-navigate', tabId, url });
    });
    view.webContents.on('page-title-updated', (_event, title) => {
      managed.title = title;
      this.emit({ type: 'page-title', tabId, title });
    });
    view.webContents.on('page-favicon-updated', (_event, favicons: string[]) => {
      managed.favicon = favicons[0];
      this.emit({ type: 'favicon', tabId, favicon: favicons[0] });
    });
    // F12 → DevTools（用户可见网页的调试入口；与 Chrome 习惯一致）。
    // — English: F12 toggles DevTools for the user-visible page (Chrome habit).
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        if (view.webContents.isDevToolsOpened()) {
          view.webContents.closeDevTools();
        } else {
          view.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });
    // 页面 console 日志 → Renderer 事件（BrowserWorkbench 可展示）+ Main 终端。
    // Electron 32+ 的 console-message 是 event 对象签名（level/message/lineNumber/sourceId）。
    // — English: page console messages → renderer event + Main terminal.
    //   Electron 32+ uses the event-object signature for console-message.
    view.webContents.on('console-message', (event) => {
      const params = event as unknown as {
        level?: 'info' | 'warning' | 'error' | 'debug';
        message?: string;
        lineNumber?: number;
        sourceId?: string;
      };
      const level = (params.level === 'warning' || params.level === 'error' ? params.level : 'info') as 'info' | 'warning' | 'error';
      const message = params.message ?? '';
      const line = params.lineNumber ?? 0;
      const sourceId = params.sourceId ?? '';
      const text = `${message} (${sourceId}:${line})`;
      this.emit({ type: 'console', tabId, level, message: text });
      console.log(`[browser:${tabId}] ${text}`);
    });
    view.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') {
        this.emit({ type: 'page-crashed', tabId });
      }
    });
    view.webContents.on('destroyed', () => {
      this.emit({ type: 'tab-closed', tabId });
    });

    // popup：在新标签打开（禁止独立窗口）。
    // — English: popups open as new tabs (standalone windows are blocked).
    view.webContents.setWindowOpenHandler(({ url }) => {
      this.createTab({ url, bounds: managed.view.getBounds() });
      return { action: 'deny' };
    });

    void view.webContents.loadURL(input.url).catch((err: unknown) => {
      // 加载失败由 did-fail-load 等事件呈现；这里仅记录。
      // — English: load failures surface via did-fail-load; log here only.
      console.error(`[browser] loadURL failed for ${tabId}: ${String(err)}`);
    });
    this.emit({ type: 'tab-created', tabId, url: input.url });
    return this.stateOf(managed);
  }

  // 网页四周留边距 + 圆角（视觉上与 Electron 窗口融合更好看）。
  // — English: the web page gets an inset margin and rounded corners so it
  //   blends nicely with the Electron window.
  private static readonly VIEW_INSET = 8;
  private static readonly VIEW_RADIUS = 12;

  setBounds(tabId: string, bounds: BrowserViewBounds): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    const inset = BrowserViewManager.VIEW_INSET;
    const padded: BrowserViewBounds = {
      x: bounds.x + inset,
      y: bounds.y + inset,
      width: Math.max(bounds.width - inset * 2, 1),
      height: Math.max(bounds.height - inset * 2, 1),
    };
    managed.view.setBounds(padded);
    try {
      managed.view.setBorderRadius(BrowserViewManager.VIEW_RADIUS);
    } catch {
      // 老版本 Electron 无 setBorderRadius——忽略（仅影响圆角）。
      // — English: older Electron lacks setBorderRadius — ignore (corners only).
    }
  }

  setVisible(tabId: string, visible: boolean): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    managed.visible = visible;
    if (visible) {
      this.host.contentView.addChildView(managed.view);
    } else {
      this.host.contentView.removeChildView(managed.view);
    }
    this.emit({ type: 'tab-visible', tabId, visible });
  }

  navigate(tabId: string, url: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    managed.url = url;
    void managed.view.webContents.loadURL(url);
  }

  // 激活标签：隐藏其余 View，目标保持可见并置于最前（不抢其它面板焦点）。
  // — English: activate a tab — hide the others, keep the target visible and on
  //   top (no focus stealing from other panels).
  activateTab(tabId: string): void {
    const target = this.views.get(tabId);
    if (target === undefined) throw new Error(`unknown tab: ${tabId}`);
    this.activeTabId = tabId;
    for (const managed of this.views.values()) {
      const visible = managed.tabId === tabId;
      if (visible !== managed.visible) {
        managed.visible = visible;
        if (visible) {
          this.host.contentView.addChildView(managed.view);
        } else {
          this.host.contentView.removeChildView(managed.view);
        }
        this.emit({ type: 'tab-visible', tabId: managed.tabId, visible });
      }
    }
  }

  // 前进/后退：返回是否成功（导航历史可用）。
  // — English: back/forward — returns whether the navigation happened.
  back(tabId: string): boolean {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    if (!managed.view.webContents.navigationHistory.canGoBack()) return false;
    managed.view.webContents.navigationHistory.goBack();
    return true;
  }

  forward(tabId: string): boolean {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    if (!managed.view.webContents.navigationHistory.canGoForward()) return false;
    managed.view.webContents.navigationHistory.goForward();
    return true;
  }

  reload(tabId: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    managed.view.webContents.reload();
  }

  stop(tabId: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    managed.view.webContents.stop();
  }

  focus(tabId: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    managed.view.webContents.focus();
  }

  toggleDevTools(tabId: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    if (managed.view.webContents.isDevToolsOpened()) {
      managed.view.webContents.closeDevTools();
    } else {
      managed.view.webContents.openDevTools({ mode: 'detach' });
    }
  }

  viewFor(tabId: string): WebContentsView {
    const managed = this.views.get(tabId);
    if (managed === undefined) throw new Error(`unknown tab: ${tabId}`);
    return managed.view;
  }

  // 统一 CDP Adapter 缓存（按 webContents.id）：同一 View 永远只有一个 adapter，
  // 避免两个 debugger 附着同一 target（ElectronWebContentsRuntime 与 UI IPC 共用）。
  // — English: unified CDP adapter cache (keyed by webContents.id) — one adapter
  //   per view, shared by ElectronWebContentsRuntime and the UI IPC.
  adapterForView(view: WebContentsView): BrowserEngineAdapter {
    const id = view.webContents.id;
    let adapter = this.adapters.get(id);
    if (adapter === undefined) {
      adapter = new BrowserEngineAdapter(view);
      this.adapters.set(id, adapter);
    }
    return adapter;
  }

  // 关闭标签时释放 CDP adapter（视图销毁后不再附着）。
  // — English: release the CDP adapter when the tab closes.
  private readonly adapters = new Map<number, BrowserEngineAdapter>();

  listTabs(): BrowserTabState[] {
    return [...this.views.values()].map((m) => this.stateOf(m));
  }

  // 关闭标签立即回收 View；不存在不可见页面持续占用。
  // — English: closing a tab recycles its view immediately.
  destroy(tabId: string): void {
    const managed = this.views.get(tabId);
    if (managed === undefined) return;
    this.views.delete(tabId);
    this.host.contentView.removeChildView(managed.view);
    this.adapters.get(managed.view.webContents.id)?.detach();
    this.adapters.delete(managed.view.webContents.id);
    if (!managed.view.webContents.isDestroyed()) {
      managed.view.webContents.close();
    }
  }

  // 退出时回收全部 View（无残留进程）。
  // — English: recycle every view on shutdown (no residual processes).
  dispose(): void {
    for (const tabId of [...this.views.keys()]) {
      this.destroy(tabId);
    }
  }

  // 关闭浏览器面板时回收全部 View（React 卸载不会销毁原生 View，必须显式清理，
  // 否则页面残留在窗口上）。
  // — English: recycle every view when the browser panel closes (React unmount
  //   does not destroy native views — without this the page stays on screen).
  // 当前活动标签（无活动标签时回退第一个）。Agent 会话绑定用户可见的 View。
  // — English: the active tab (falls back to the first); the agent session
  //   binds the user-visible view.
  activeTabOrFirst(): { tabId: string; view: WebContentsView } {
    const tabs = this.listTabs();
    if (tabs.length === 0) throw new Error('no browser tab open');
    const tabId = this.activeTabId !== null && tabs.some((t) => t.tabId === this.activeTabId)
      ? this.activeTabId
      : tabs[0].tabId;
    return { tabId, view: this.viewFor(tabId) };
  }

  destroyAll(): void {
    this.dispose();
  }

  private stateOf(managed: ManagedView): BrowserTabState {
    return {
      tabId: managed.tabId,
      url: managed.url,
      title: managed.title,
      visible: managed.visible,
      loading: managed.loading,
      favicon: managed.favicon,
    };
  }
}
