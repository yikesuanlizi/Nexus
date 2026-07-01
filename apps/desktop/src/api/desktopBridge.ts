export interface DesktopCapabilities {
  desktop: boolean;
  weixinBridge: {
    managedAvailable: boolean;
    rpcUrl: string;
    reason?: 'not_bundled' | 'unsupported' | string;
  };
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
    };
  }
}

// 向桌面端（Tauri）查询能力信息：当前环境是否为桌面端、微信桥接是否可用等
// Chinese translation: Queries the desktop side (Tauri) for capabilities: whether this is a desktop environment and whether the WeChat bridge is available.
export async function readDesktopCapabilities(): Promise<DesktopCapabilities> {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return fallbackCapabilities('unsupported');
  try {
    return await invoke<DesktopCapabilities>('desktop_capabilities');
  } catch {
    return fallbackCapabilities('unsupported');
  }
}

// 构造一个表示"当前环境不具备桌面端能力"的 fallback 对象
// Chinese translation: Builds a fallback object representing "the current environment lacks desktop capabilities".
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
