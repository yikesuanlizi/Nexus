// 浏览器命令 TCP 服务（Agent 链路）：Electron Main 监听本机端口，运行
// Sidecar 协议服务端，其 runtime 绑定当前活动标签的 ElectronWebContentsRuntime。
// API 进程的 BrowserTool 经 TCP 客户端驱动真实 View——用户与 Agent 同会话。
// 安全：连接首帧必须携带会话级 capability token（NEXUS_BROWSER_TOKEN，
// 每次桌面会话启动时由 start-desktop 生成随机值注入），校验通过才建 Sidecar。
// — English: the browser-command TCP service (agent link): Electron Main listens
//   on a local port and runs the Sidecar protocol server whose runtime binds the
//   current tab's ElectronWebContentsRuntime. The API process's BrowserTool
//   drives the real view over TCP — the user and the agent share one session.
//   Security: the first frame of a connection must carry a per-desktop-session
//   capability token (NEXUS_BROWSER_TOKEN, a random value start-desktop injects
//   on every launch); the Sidecar is only created after it checks out.
import { randomBytes } from 'node:crypto';
import type { WebContentsView } from 'electron';
import { ElectronWebContentsRuntime } from '../browser/ElectronWebContentsRuntime.js';
import type { BrowserViewManager } from '../browser/BrowserViewManager.js';

export interface BrowserServerHandle {
  close(): Promise<void>;
  port(): number;
  started: boolean;
  error: string | null;
}

// 默认端口；测试/多实例用 NEXUS_BROWSER_PORT 覆盖。
// — English: default port; NEXUS_BROWSER_PORT overrides it (tests / instances).
const DEFAULT_PORT = 19230;

// 每次桌面会话的随机 capability token（start-desktop.mjs 生成并注入 API/Electron）。
// — English: a per-desktop-session random capability token (start-desktop.mjs
//   generates it and injects it into the API/Electron processes).
export function resolveBrowserToken(): string {
  const fromEnv = process.env.NEXUS_BROWSER_TOKEN;
  if (fromEnv !== undefined && fromEnv.length >= 16) return fromEnv;
  // 兜底：Main 自身生成（API 侧拿不到时 BrowserTool 会拒绝连接）。
  // — English: fallback — Main generates one itself (if the API side cannot
  //   read it, BrowserTool refuses to connect).
  return randomBytes(24).toString('hex');
}

export async function startBrowserCommandServer(deps: {
  manager: BrowserViewManager;
  port?: number;
}): Promise<BrowserServerHandle> {
  const port = deps.port ?? Number(process.env.NEXUS_BROWSER_PORT ?? DEFAULT_PORT);
  const token = resolveBrowserToken();
  const { createTcpSidecarServer } = await import('@nexus/browser-runtime');
  const server = await createTcpSidecarServer({
    port,
    authToken: token,
    createRuntime: () => {
      // 绑定当前活动标签的 View（用户可见的真实页面）。
      // — English: bind the active tab's view (the page the user sees).
      const { view } = deps.manager.activeTabOrFirst();
      return new ElectronWebContentsRuntime({ view, adapter: deps.manager.adapterForView(view) });
    },
    log: (line: string) => console.log(`[browser-server] ${line}`),
  });
  const handle: BrowserServerHandle = {
    async close(): Promise<void> {
      await server.close();
    },
    port: () => server.port(),
    started: true,
    error: null,
  };
  console.log(`[browser-server] listening on 127.0.0.1:${server.port()} (auth enabled)`);
  return handle;
}

// 仅供测试/工具使用：生成一个随机 token。
// — English: test/utility helper: generate a random token.
export function generateBrowserToken(): string {
  return randomBytes(24).toString('hex');
}
