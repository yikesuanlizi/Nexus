// 桌面服务 IPC：窗口控制、能力查询、open_path（替换 Tauri desktop_capabilities / open_path）。
// 每个 handler 都校验参数并只在宿主窗口有效时操作。
// — English: desktop service IPC — window controls, capability query, open_path
//   (replacing Tauri desktop_capabilities / open_path). Every handler validates
//   its args and only acts while the host window is alive.
import { ipcMain, shell, type BrowserWindow } from 'electron';
import type { DesktopCapabilitiesContract } from '../contracts/browserTypes.js';

export interface DesktopIpcDeps {
  host: BrowserWindow;
}

function capabilities(): DesktopCapabilitiesContract {
  return {
    desktop: true,
    weixinBridge: {
      managedAvailable: false,
      rpcUrl: '',
      // 微信桥接在 Phase 4 迁移（当前沿用"未提供"语义）。
      // — English: the WeChat bridge migrates in Phase 4 (same "not provided" semantics).
      reason: 'not_bundled',
    },
  };
}

export function registerDesktopIpc(deps: DesktopIpcDeps): void {
  const { host } = deps;

  // 最大化状态事件 → Renderer（TitleBar 图标同步）。
  // — English: maximize state events → Renderer (TitleBar icon sync).
  const emitMaximized = (): void => {
    if (!host.isDestroyed()) {
      host.webContents.send('window:maximized-changed', host.isMaximized());
    }
  };
  host.on('maximize', emitMaximized);
  host.on('unmaximize', emitMaximized);

  ipcMain.handle('window:minimize', () => {
    host.minimize();
  });
  ipcMain.handle('window:toggleMaximize', () => {
    if (host.isMaximized()) {
      host.unmaximize();
    } else {
      host.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    host.close();
  });
  ipcMain.handle('window:isMaximized', () => host.isMaximized());
  // Electron 无程序化拖拽 API：默认 frame 由系统标题栏处理拖拽；
  // Phase 4 自定义 frame 时改用 CSS -webkit-app-region: drag。
  // — English: Electron has no programmatic drag API — the default frame's
  //   system title bar handles dragging; Phase 4 custom frames will use CSS.
  ipcMain.handle('window:startDragging', () => {
    // no-op
  });

  ipcMain.handle('desktop:capabilities', () => capabilities());

  ipcMain.handle('desktop:openPath', async (_event, path: unknown) => {
    if (typeof path !== 'string' || path === '') {
      throw new Error('path 必须为非空字符串');
    }
    const error = await shell.openPath(path);
    return error === '';
  });
}
