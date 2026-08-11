// BrowserTool：让 Agent（AgentLoop 的工具链）操作桌面浏览器真实页面。
// 经 TCP Sidecar 桥驱动 Electron Main 的 ElectronWebContentsRuntime——
// 用户与 Agent 共享同一 WebContentsView（同一 DOM/Cookie/会话）。
// 写操作（navigate/act）requiresApproval + 网络主机 requestAccess 双保险；
// ctx.signal 贯通取消。
// — English: BrowserTool lets the agent (AgentLoop's tool chain) operate the
//   desktop browser's real page — driving Electron Main's
//   ElectronWebContentsRuntime over the TCP Sidecar bridge, sharing one
//   WebContentsView with the user (same DOM/Cookie/session). Writes
//   (navigate/act) are gated by requiresApproval plus a per-host
//   requestAccess; ctx.signal flows through to cancellation.
import type { AccessDecision, AccessRequest, ActionIntent, Observation } from '@nexus/protocol';
import { type ToolContext, type ToolDefinition, type ToolResult } from './registry.js';

// 默认端口与 Main 的 browserServer 一致；NEXUS_BROWSER_PORT 覆盖（测试/多实例）。
// — English: the default port matches Main's browserServer; NEXUS_BROWSER_PORT
//   overrides it (tests / multiple instances).
const DEFAULT_BROWSER_PORT = 19230;

// 会话内记住最近一次观察（act 需要 observationId/epoch 对齐）。
// — English: the latest observation is remembered per thread (act needs its
//   observationId/epoch) — thread-scoped so [eN] refs can never leak across
//   threads/turns.
let clientPromise: Promise<unknown> | null = null;
const observationsByThread = new Map<string, Observation>();

function browserPort(): number {
  const raw = process.env.NEXUS_BROWSER_PORT;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BROWSER_PORT;
}

// capability token：start-desktop 每次桌面会话注入；缺失时握手会被服务端拒绝。
// — English: the capability token start-desktop injects per desktop session;
//   when missing, the server rejects the handshake.
function browserToken(): string {
  return process.env.NEXUS_BROWSER_TOKEN ?? '';
}

// 单个 TCP 连接（服务端"连接=会话"，多连接会对同一 View 重复附着 CDP）。
// 观察状态按线程隔离；客户端 pending 队列天然串行，无并发竞态。
// — English: a single TCP connection (the server treats a connection as a
//   session; extra connections would double-attach CDP to the same view).
//   Observation state is thread-scoped; the client's pending queue serializes
//   commands, so there is no concurrency race.

// 本地 structural 类型（避免 tools → browser-runtime 的包依赖；运行时经动态
// import 取实现）。
// — English: local structural types (no tools → browser-runtime package edge;
//   implementations come from a runtime dynamic import).
interface BrowserSessionHandleShape {
  observe(input?: { signal?: AbortSignal; pageId?: string }): Promise<Observation>;
  navigate(input: { url: string; signal?: AbortSignal }): Promise<Observation>;
  act(input: { intent: ActionIntent; signal?: AbortSignal }): Promise<{
    status: string;
    reason?: string;
    error?: { code?: string; message?: string };
    evidence?: { observed?: { url?: string } };
  }>;
  close(reason?: string): Promise<void>;
}

async function getClient(taskId: string, signal?: AbortSignal): Promise<BrowserSessionHandleShape> {
  if (clientPromise === null) {
    clientPromise = (async (): Promise<BrowserSessionHandleShape> => {
      // 变量 specifier：避免 tsconfig paths 把包静态解析到 src（rootDir 冲突），
      // 运行时仍经 node_modules 解析到 dist。
      // — English: a variable specifier keeps tsc from resolving the package to
      //   its src via paths (rootDir conflict); at runtime node_modules/dist wins.
      const { createTcpSidecarTransport, createSidecarClient } = await import('@nexus/browser-runtime');
      const { transport, ready } = createTcpSidecarTransport({ port: browserPort(), authToken: browserToken() });
      await ready;
      return createSidecarClient({
        taskId,
        transport: transport as never,
        signal,
      }) as Promise<BrowserSessionHandleShape>;
    })().catch((err: unknown) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise as Promise<BrowserSessionHandleShape>;
}

function toolError(message: string): ToolResult {
  return { output: '', error: { message }, status: 'failed' };
}

function networkRequest(url: string): AccessRequest {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  return {
    access: 'network',
    target: { kind: 'network', host },
    threadId: '',
    turnId: '',
    description: `浏览器导航 ${host}`,
  };
}

async function ensureAllowed(ctx: ToolContext, url: string): Promise<AccessDecision | null> {
  if (typeof ctx.requestAccess !== 'function') return null;
  return ctx.requestAccess(networkRequest(url));
}

// ─── browser_observe ─────────────────────────────────────────────────────────
// — English: browser_observe.

const browserObserveTool: ToolDefinition = {
  name: 'browser_observe',
  description:
    '观察桌面浏览器当前页面：返回可见元素列表（[e1]..[eN]，含 role/name）、URL 与标题。' +
    '页面由浏览器工作台呈现，用户可见。使用 click/type 前先 observe 拿元素引用。',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  requiredPolicy: 'readonly',
  supportsParallelToolCalls: false,
  execute: async (_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const client = await getClient(ctx.threadId, ctx.signal);
      const observation = await client.observe({ signal: ctx.signal });
      observationsByThread.set(ctx.threadId, observation);
      const obs = observation;
      const lines = [
        `URL: ${obs.url}`,
        `标题: ${obs.title}`,
        `epoch: ${obs.navigationEpoch}`,
      ];
      for (const el of obs.elements.slice(0, 60)) {
        lines.push(`${el.ref} ${el.role ?? ''} ${el.name ?? ''}`.trim());
      }
      if (obs.elements.length > 60) {
        lines.push(`… 另有 ${obs.elements.length - 60} 个元素`);
      }
      return { output: lines.join('\n'), status: 'completed' };
    } catch (err) {
      return toolError(`浏览器观察失败: ${String(err)}（桌面浏览器未启动或无标签页？）`);
    }
  },
};

// ─── browser_navigate ────────────────────────────────────────────────────────
// — English: browser_navigate.

const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: '导航桌面浏览器当前标签到指定 URL（用户可见的真实页面）。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标 URL（http/https）' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  requiredPolicy: 'workspace_write',
  requiresApproval: true,
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (url === '') return toolError('browser_navigate 需要 url');
    try {
      const decision = await ensureAllowed(ctx, url);
      if (decision?.decision === 'deny') {
        return toolError(`导航被策略拒绝: ${url}`);
      }
      const client = await getClient(ctx.threadId, ctx.signal);
      const observation = await client.navigate({ url, signal: ctx.signal });
      observationsByThread.set(ctx.threadId, observation);
      return {
        output: `已导航到 ${observation.url}\n标题: ${observation.title}`,
        status: 'completed',
      };
    } catch (err) {
      return toolError(`导航失败: ${String(err)}`);
    }
  },
};

// ─── browser_act ─────────────────────────────────────────────────────────────
// — English: browser_act.

const BROWSER_ACT_KINDS = ['click', 'type', 'scroll', 'wait'] as const;

const browserActTool: ToolDefinition = {
  name: 'browser_act',
  description:
    '在桌面浏览器当前页面执行交互动作（用户可见）。' +
    'kind: click（targetRef 必须来自最近一次 browser_observe 的 [eN]）、type（targetRef + value）、' +
    'scroll（dy 像素）、wait（durationMs）。',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...BROWSER_ACT_KINDS], description: '动作类型' },
      targetRef: { type: 'string', description: '元素引用 [eN]（来自最近 observe）' },
      value: { type: 'string', description: 'type 的输入文本' },
      dy: { type: 'number', description: 'scroll 垂直偏移像素' },
      durationMs: { type: 'number', description: 'wait 时长毫秒' },
      rationale: { type: 'string', description: '动作理由（模型解释）' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  requiredPolicy: 'workspace_write',
  requiresApproval: true,
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const kind = args.kind as (typeof BROWSER_ACT_KINDS)[number] | undefined;
    if (kind === undefined || !BROWSER_ACT_KINDS.includes(kind)) {
      return toolError(`browser_act 需要合法 kind: ${BROWSER_ACT_KINDS.join('/')}`);
    }
    const lastObservation = observationsByThread.get(ctx.threadId);
    if (lastObservation === undefined) {
      return toolError('请先 browser_observe 获取元素引用');
    }
    const obs = lastObservation;
    const intent: ActionIntent = {
      actionId: `act-${ctx.turnId}-${Date.now()}`,
      taskId: ctx.threadId,
      pageId: obs.pageId,
      observationId: obs.observationId,
      expectedNavigationEpoch: obs.navigationEpoch,
      kind,
      targetRef: typeof args.targetRef === 'string' && args.targetRef !== '' ? args.targetRef : undefined,
      arguments: {
        ...(typeof args.value === 'string' ? { value: args.value } : {}),
        ...(typeof args.dy === 'number' ? { dy: args.dy } : {}),
        ...(typeof args.durationMs === 'number' ? { durationMs: args.durationMs } : {}),
      },
      rationale: typeof args.rationale === 'string' ? args.rationale : `browser_act ${kind}`,
      effect: 'local',
      risk: kind === 'type' ? 'medium' : 'low',
      postcondition: { kind: 'none' },
    };
    try {
      const client = await getClient(ctx.threadId, ctx.signal);
      const result = await client.act({ intent, signal: ctx.signal });
      if (result.status === 'failed') {
        return toolError(`动作失败: ${String(result.error?.message ?? 'unknown')}（${result.error?.code}）`);
      }
      const lines = [`动作 ${kind} ${result.status}`, `URL: ${result.evidence?.observed?.url ?? ''}`];
      if (result.reason !== undefined) {
        lines.push(`原因: ${result.reason}`);
      }
      return { output: lines.join('\n'), status: 'completed' };
    } catch (err) {
      return toolError(`动作失败: ${String(err)}`);
    }
  },
};

export const browserTools: ToolDefinition[] = [browserObserveTool, browserNavigateTool, browserActTool];
