// createMainWindow：在已创建的宿主窗口上挂载窗口策略与加载逻辑。
// 浏览器 IPC 在 ipc/registerBrowserIpc.ts（§7 目标目录）；桌面服务 IPC 在 registerDesktopIpc.ts。
// — English: createMainWindow wires window policy and renderer loading. Browser IPC
//   lives in ipc/registerBrowserIpc.ts (§7 layout); desktop-service IPC in
//   registerDesktopIpc.ts.
import { type BrowserWindow } from 'electron';
import { join } from 'node:path';

export interface MainWindowDeps {
  host: BrowserWindow;
}

export function createMainWindow(deps: MainWindowDeps): BrowserWindow {
  const { host: window } = deps;

  // 外部窗口请求：一律拒绝（远程页面只允许进入 WebContentsView，不新开窗口）。
  // — English: window.open is blocked — remote pages may only live inside a
  //   WebContentsView, never spawn new windows.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return window;
}
