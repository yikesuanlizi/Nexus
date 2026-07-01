import type {
  Checkpoint,
  ThreadEvent,
  ThreadId,
  ThreadItem,
  ThreadMeta,
  ThreadRuntimeState,
  TurnId,
  Usage,
  UserInput,
} from '@nexus/protocol';
import type { ChatMessage, ToolCall, ToolDefinition as ModelToolDefinition } from '@nexus/model-gateway';
import type { RunEvent, RunEventLevel, ThreadStore } from '@nexus/storage';
import type { SandboxLevel } from '@nexus/sandbox';
import type { ToolContext, ToolDefinition, ToolResult } from '@nexus/tools';
import type { Locale } from '@nexus/i18n';
import type { ThreadStateManager } from './state.js';
import type { RunProfile } from './runProfile.js';
import type { WebSearchMode } from './webSearchPolicy.js';

// RuntimeTurnContext：单 turn 的运行时上下文，提供执行所需的数据与操作入口
export interface RuntimeTurnContext {
  tenantId: string;
  threadId: ThreadId;
  turnId: TurnId;
  thread: ThreadMeta;
  userInput: UserInput;
  workspaceRoot: string;
  locale: Locale;
  runProfile: RunProfile;
  webSearchMode: WebSearchMode;
  runtimeState: ThreadRuntimeState;
  checkpoint: Checkpoint;
  collectedItems: ThreadItem[];
  store: ThreadStore;
  stateManager: ThreadStateManager;
  emit: (event: ThreadEvent) => void;
  audit?: (event: {
    category: RunEvent['category'];
    type: string;
    level?: RunEventLevel;
    message: string;
    toolName?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  permissions: {
    level: SandboxLevel;
    networkAllowed: boolean;
    presetId?: string;
  };
  maxSubagents: number;
  dynamicContextProvider?: (ctx: RuntimeTurnContext) => Promise<string | string[]>;
}

// 模型调用请求：messages / tools / tool_choice / signal
export interface RuntimeModelRequest {
  messages: ChatMessage[];
  tools?: ModelToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  signal?: AbortSignal;
}

// 模型调用响应：生成的消息和 token 使用统计
export interface RuntimeModelResponse {
  message: ChatMessage;
  usage: Usage | null;
}

// 工具调用请求：包含 toolCall 对象、工具名称、参数、工具定义与 toolContext
export interface RuntimeToolRequest {
  toolCall: ToolCall;
  requestedToolName: string;
  toolName: string;
  args: Record<string, unknown>;
  toolDef?: ToolDefinition;
  toolContext: ToolContext;
}

// 工具调用响应：扩展 ToolResult 并携带可选的禁用 web_search 标志
export interface RuntimeToolResponse extends ToolResult {
  disableWebSearch?: boolean;
}

// 模型 next 函数签名：接收请求并返回响应，供 wrapModel 包裹
export type RuntimeModelNext = (request: RuntimeModelRequest) => Promise<RuntimeModelResponse>;
// 工具 next 函数签名：接收请求并返回响应，供 wrapTool 包裹
export type RuntimeToolNext = (request: RuntimeToolRequest) => Promise<RuntimeToolResponse>;

// 回合执行结果：completed / interrupted / failed，以及 usage 和可选错误
export interface RuntimeTurnResult {
  status: 'completed' | 'interrupted' | 'failed';
  usage: Usage | null;
  error?: unknown;
}

// Runtime middleware 定义：提供多个生命周期钩子，供自定义逻辑插入 turn 流程
export interface RuntimeMiddleware {
  beforeTurn?: (ctx: RuntimeTurnContext) => Promise<void> | void;
  beforeModel?: (ctx: RuntimeTurnContext, request: RuntimeModelRequest) => Promise<RuntimeModelRequest | void> | RuntimeModelRequest | void;
  wrapModel?: (ctx: RuntimeTurnContext, request: RuntimeModelRequest, next: RuntimeModelNext) => Promise<RuntimeModelResponse>;
  afterModel?: (ctx: RuntimeTurnContext, request: RuntimeModelRequest, response: RuntimeModelResponse) => Promise<void> | void;
  beforeTool?: (ctx: RuntimeTurnContext, request: RuntimeToolRequest) => Promise<RuntimeToolResponse | void> | RuntimeToolResponse | void;
  wrapTool?: (ctx: RuntimeTurnContext, request: RuntimeToolRequest, next: RuntimeToolNext) => Promise<RuntimeToolResponse>;
  afterTool?: (ctx: RuntimeTurnContext, request: RuntimeToolRequest, response: RuntimeToolResponse) => Promise<void> | void;
  afterTurn?: (ctx: RuntimeTurnContext, result: RuntimeTurnResult) => Promise<void> | void;
}

// 组合多个 middleware：按顺序执行 before* 钩子，逆序注册 wrap* 包裹，按顺序执行 after* 钩子
export function composeRuntimeMiddleware(middleware: RuntimeMiddleware[]) {
  return {
    async beforeTurn(ctx: RuntimeTurnContext): Promise<void> {
      for (const entry of middleware) await entry.beforeTurn?.(ctx);
    },
    async beforeModel(ctx: RuntimeTurnContext, request: RuntimeModelRequest): Promise<RuntimeModelRequest> {
      let current = request;
      for (const entry of middleware) {
        const next = await entry.beforeModel?.(ctx, current);
        if (next) current = next;
      }
      return current;
    },
    async wrapModel(ctx: RuntimeTurnContext, request: RuntimeModelRequest, core: RuntimeModelNext): Promise<RuntimeModelResponse> {
      let next = core;
      for (let index = middleware.length - 1; index >= 0; index -= 1) {
        const entry = middleware[index];
        if (!entry.wrapModel) continue;
        const inner = next;
        next = (wrappedRequest) => entry.wrapModel!(ctx, wrappedRequest, inner);
      }
      return next(request);
    },
    async afterModel(ctx: RuntimeTurnContext, request: RuntimeModelRequest, response: RuntimeModelResponse): Promise<void> {
      for (const entry of middleware) await entry.afterModel?.(ctx, request, response);
    },
    async beforeTool(ctx: RuntimeTurnContext, request: RuntimeToolRequest): Promise<RuntimeToolResponse | undefined> {
      for (const entry of middleware) {
        const response = await entry.beforeTool?.(ctx, request);
        if (response) return response;
      }
      return undefined;
    },
    async wrapTool(ctx: RuntimeTurnContext, request: RuntimeToolRequest, core: RuntimeToolNext): Promise<RuntimeToolResponse> {
      let next = core;
      for (let index = middleware.length - 1; index >= 0; index -= 1) {
        const entry = middleware[index];
        if (!entry.wrapTool) continue;
        const inner = next;
        next = (wrappedRequest) => entry.wrapTool!(ctx, wrappedRequest, inner);
      }
      return next(request);
    },
    async afterTool(ctx: RuntimeTurnContext, request: RuntimeToolRequest, response: RuntimeToolResponse): Promise<void> {
      for (const entry of middleware) await entry.afterTool?.(ctx, request, response);
    },
    async afterTurn(ctx: RuntimeTurnContext, result: RuntimeTurnResult): Promise<void> {
      for (const entry of middleware) await entry.afterTurn?.(ctx, result);
    },
  };
}

// 稳定性中间件：限制单 turn 内的重复工具调用、连续失败次数、web_search 搜索预算与子 agent 数量
export function createStabilityMiddleware(options: {
  maxRepeatedToolCalls: number;
  maxConsecutiveToolErrors: number;
  maxWebSearchCallsPerTurn: number;
  maxDuplicateWebSearchQueryPerTurn: number;
}): RuntimeMiddleware {
  const states = new Map<TurnId, {
    toolCounts: Map<string, number>;
    consecutiveToolErrors: number;
    searchCalls: number;
    searchQueries: Map<string, number>;
    toolsDisabled: boolean;
    disabledReason?: string;
  }>();

  // 获取或初始化某个 turn 的状态
  const stateFor = (turnId: TurnId) => {
    let state = states.get(turnId);
    if (!state) {
      state = {
        toolCounts: new Map(),
        consecutiveToolErrors: 0,
        searchCalls: 0,
        searchQueries: new Map(),
        toolsDisabled: false,
      };
      states.set(turnId, state);
    }
    return state;
  };

  return {
    beforeModel: (ctx, request) => {
      const state = stateFor(ctx.turnId);
      // 工具未被禁用时直接放行
      if (!state.toolsDisabled) return;
      // 工具已禁用：将 tools 清空并追加提示消息，强制模型给出最终回答
      return {
        ...request,
        tools: [],
        tool_choice: 'none',
        messages: [
          ...request.messages,
          {
            role: 'user',
            content: state.disabledReason ?? (
              ctx.locale === 'zh'
                ? '工具治理已停止本轮继续调用工具。请基于已有结果给出最终回答，或说明当前阻塞。'
                : 'Runtime tool governance stopped further tool calls for this turn. Give the final answer from existing results or explain the blocker.'
            ),
          },
        ],
      };
    },
    beforeTool: async (ctx, request) => {
      const state = stateFor(ctx.turnId);
      // 连续工具失败次数上限保护
      if (state.consecutiveToolErrors >= options.maxConsecutiveToolErrors) {
        const message = ctx.locale === 'zh'
            ? `连续工具失败已达到 ${options.maxConsecutiveToolErrors} 次上限。请停止重试同类工具，改用已有结果说明当前阻塞。`
            : `Consecutive tool failures reached the limit of ${options.maxConsecutiveToolErrors}. Stop retrying tools and explain the blocker from existing results.`;
        state.toolsDisabled = true;
        state.disabledReason = message;
        return failedToolResponse(message, 'TOOL_ERROR_LIMIT_REACHED');
      }

      // 子 agent 数量保护：打开中的子 agent 达到上限时拒绝新的 spawn_agent
      if (request.toolName === 'spawn_agent') {
        const openEdges = await ctx.store.listThreadSpawnDescendants(ctx.threadId, 'open');
        if (openEdges.length >= ctx.maxSubagents) {
          return failedToolResponse(`Maximum open subagents reached: ${ctx.maxSubagents}`, 'SUBAGENT_LIMIT_REACHED');
        }
      }

      // 对相同工具+参数的调用次数做哈希计数，超过阈值则终止循环
      const signature = `${request.toolName}:${stableJson(request.args)}`;
      const count = (state.toolCounts.get(signature) ?? 0) + 1;
      state.toolCounts.set(signature, count);
      if (count > options.maxRepeatedToolCalls) {
        const message = ctx.locale === 'zh'
            ? `检测到重复调用同一工具和参数已超过 ${options.maxRepeatedToolCalls} 次。请停止循环工具调用，基于已有结果回答或说明阻塞。`
            : `Repeated calls to the same tool and arguments exceeded ${options.maxRepeatedToolCalls}. Stop looping and answer or explain the blocker from existing results.`;
        state.toolsDisabled = true;
        state.disabledReason = message;
        return failedToolResponse(message, 'TOOL_LOOP_DETECTED');
      }

      // web_search search action 的配额控制：总次数和相同 query 重复次数
      const webBudgetError = consumeWebSearchBudget(ctx, request, state, options);
      return webBudgetError ? { ...failedToolResponse(webBudgetError, 'WEB_SEARCH_LIMIT_REACHED'), disableWebSearch: true } : undefined;
    },
    afterTool: (_ctx, _request, response) => {
      const state = stateFor(_ctx.turnId);
      if (response.status === 'failed') {
        state.consecutiveToolErrors += 1;
      } else {
        state.consecutiveToolErrors = 0;
      }
    },
    afterTurn: (ctx) => {
      states.delete(ctx.turnId);
    },
  };
}

// 动态上下文中间件：在每次调用模型前，注入一份描述时间、权限、运行状态、文件变更和用户扩展的 system prompt
export function createDynamicContextMiddleware(): RuntimeMiddleware {
  return {
    beforeModel: async (ctx, request) => {
      const text = await buildDynamicContext(ctx);
      if (!text) return;
      const message: ChatMessage = { role: 'system', content: text };
      const [first, ...rest] = request.messages;
      // 将动态上下文插入到第一条消息和后续消息之间，保持原始第一条位置
      request.messages = first ? [first, message, ...rest] : [message];
    },
  };
}

// 构建动态上下文文本：整合日期时间、权限、运行状态、最近文件变更和外部 provider 文本
async function buildDynamicContext(ctx: RuntimeTurnContext): Promise<string> {
  const recentItems = await ctx.store.getRecentItems(ctx.threadId, 50);
  const openSubagents = await ctx.store.listThreadSpawnDescendants(ctx.threadId, 'open');
  const providerText = await ctx.dynamicContextProvider?.(ctx);
  const providerLines = Array.isArray(providerText) ? providerText : providerText ? [providerText] : [];
  const fileChanges = recentItems
    .filter((item) => item.type === 'file_change')
    .slice(-5)
    .flatMap((item) => item.changes.map((change) => `${change.kind} ${change.path}${change.summary ? `：${change.summary}` : ''}`));
  const checkpoint = ctx.runtimeState.checkpoint;
  const lines = [
    '<dynamic_context>',
    `当前日期时间：${new Date().toISOString()}`,
    `租户：tenantId=${ctx.tenantId}`,
    `工作区路径：${ctx.workspaceRoot}`,
    `运行状态：status=${ctx.runtimeState.status}; resumable=${ctx.runtimeState.resumable}; stale=${ctx.runtimeState.stale}; checkpoint=${checkpoint ? `${checkpoint.status ?? 'unknown'}@${checkpoint.itemIndex}` : 'none'}`,
    `运行配置：runProfile=${ctx.runProfile}; webSearchMode=${ctx.webSearchMode}; 权限 preset=${ctx.permissions.presetId ?? 'custom'}; sandbox=${ctx.permissions.level}; network=${ctx.permissions.networkAllowed}`,
    `最近上传/图片数量=${countImages(ctx.userInput)}`,
    `最近文件变更：${fileChanges.length > 0 ? fileChanges.join(' | ') : '无'}`,
    `子 agent 打开数量=${openSubagents.length}`,
    ...providerLines,
    '</dynamic_context>',
  ];
  return lines.join('\n');
}

// 消耗 web_search search action 预算：按总次数和相同 query 重复次数做双层保护
function consumeWebSearchBudget(
  ctx: RuntimeTurnContext,
  request: RuntimeToolRequest,
  state: { searchCalls: number; searchQueries: Map<string, number> },
  options: { maxWebSearchCallsPerTurn: number; maxDuplicateWebSearchQueryPerTurn: number },
): string | null {
  if (request.toolName !== 'web_search' || !isWebSearchAction(request.args)) return null;
  const query = typeof request.args.query === 'string' ? request.args.query.trim().replace(/\s+/g, ' ') : '';
  const normalizedQuery = query.toLowerCase();
  const duplicateCount = (state.searchQueries.get(normalizedQuery) ?? 0) + 1;
  state.searchCalls += 1;
  state.searchQueries.set(normalizedQuery, duplicateCount);

  if (state.searchCalls > options.maxWebSearchCallsPerTurn) {
    return ctx.locale === 'zh'
      ? `本轮 web_search 的 search action 已达到 ${options.maxWebSearchCallsPerTurn} 次上限。请停止继续搜索，改用已有搜索结果回答；如果需要读取具体页面，请使用 web_search 的 open_page action 抓取明确 URL。`
      : `web_search search action reached the per-turn limit of ${options.maxWebSearchCallsPerTurn}. Stop searching and answer from existing results; use web_search open_page for a specific URL if needed.`;
  }
  if (normalizedQuery && duplicateCount > options.maxDuplicateWebSearchQueryPerTurn) {
    return ctx.locale === 'zh'
      ? '本轮重复搜索相同 query 已达到上限。请停止重复 search action，改用已有结果回答或使用 web_search 的 open_page action 抓取明确 URL。'
      : 'Repeated web_search search action for the same query reached the per-turn limit. Stop repeating the search and answer from existing results or use web_search open_page for a specific URL.';
  }
  return null;
}

// 构造统一的工具失败响应
function failedToolResponse(message: string, code: string): RuntimeToolResponse {
  return {
    output: message,
    status: 'failed',
    error: { message, code },
  };
}

// 统计用户输入中的图片数量（image_path / image_url 类型）
function countImages(input: UserInput): number {
  if (input.type === 'text') return 0;
  return input.parts.filter((part) => part.type === 'image_path' || part.type === 'image_url').length;
}

// 将任意值稳定序列化为 JSON：对象按键排序后拼接，保证相同语义得到相同字符串
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// 判断 web_search 的 action 是否为“搜索”：open_page 与 find_in_page 不占搜索预算
function isWebSearchAction(args: Record<string, unknown>): boolean {
  const action = typeof args.action === 'string' ? args.action : '';
  if (action === 'open_page' || action === 'find_in_page') return false;
  return true;
}
