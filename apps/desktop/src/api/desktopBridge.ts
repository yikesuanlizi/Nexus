// 桌面桥（迁移计划 Phase 1）：从 Tauri invoke 切换到 Electron preload typed API
// （window.nexusDesktop）。Web 环境无 preload 时保持原有降级语义。
// — English: desktop bridge (Phase 1) — switched from Tauri invoke to the Electron
//   preload typed API (window.nexusDesktop). The old fallback semantics remain in
//   web environments where the preload is absent.
export interface DesktopCapabilities {
  desktop: boolean;
  weixinBridge: {
    managedAvailable: boolean;
    rpcUrl: string;
    reason?: 'not_bundled' | 'unsupported' | string;
  };
}

// preload 暴露的 typed API 结构（与 electron/preload/index.ts 的 NexusDesktopApi 对应；
// electron 目录是独立 CJS 编译边界，这里保持局部结构类型）。
// — English: the preload-exposed typed API shape (mirrors NexusDesktopApi in
//   electron/preload/index.ts; the electron dir is a separate CJS build boundary,
//   so the shape is declared locally).
interface NexusDesktopBridge {
  desktop?: {
    capabilities?(): Promise<DesktopCapabilities>;
    openPath?(path: string): Promise<boolean>;
  };
}

declare global {
  interface Window {
    nexusDesktop?: NexusDesktopBridge;
  }
}

// 向桌面端（Electron Main）查询能力信息：当前环境是否为桌面端、微信桥接是否可用等。
// — English: queries the desktop side (Electron Main) for capabilities.
export async function readDesktopCapabilities(): Promise<DesktopCapabilities> {
  const desktopApi = window.nexusDesktop?.desktop;
  if (!desktopApi?.capabilities) return fallbackCapabilities('unsupported');
  try {
    return await desktopApi.capabilities();
  } catch {
    return fallbackCapabilities('unsupported');
  }
}

// 构造一个表示"当前环境不具备桌面端能力"的 fallback 对象。
// — English: builds a fallback object for "no desktop capabilities in this environment".
function fallbackCapabilities(reason: DesktopCapabilities['weixinBridge']['reason']): DesktopCapabilities {
  return {
    desktop: false,
    weixinBridge: {
      managedAvailable: false,
      rpcUrl: '',
      reason,
    },
  };
}

/**
 * 在系统默认编辑器中打开文件（或目录）。
 * 仅桌面端（Electron Main）可用，Web 端调用返回 false。
 * — English: open a file (or directory) in the system default editor.
 * Only available on desktop (Electron Main); returns false on web.
 */
export async function openInSystemEditor(filePath: string): Promise<boolean> {
  const openPath = window.nexusDesktop?.desktop?.openPath;
  if (!openPath) return false;
  try {
    return await openPath(filePath);
  } catch {
    return false;
  }
}
