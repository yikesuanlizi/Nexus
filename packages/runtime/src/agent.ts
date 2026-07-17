import type {
  ThreadId,
  TurnId,
  ThreadMeta,
  TurnMeta,
  ThreadItem,
  ThreadEvent,
  UserInput,
  ItemId,
  Usage,
  TextInput,
  CollabToolCallItem,
  CollabToolName,
  AgentTransferEnvelope,
  CheckpointStatus,
  ThreadRuntimeState,
  ThreadUsage,
  CompactedRange,
  EpisodeRecord,
  ThreadWorkingSetSnapshot,
  EpisodeMemoryMode,
} from '@nexus/protocol';
import { ModelGateway, type ChatMessage, type ToolCall } from '@nexus/model-gateway';
import { ToolRegistry, type ToolContext, type ToolDefinition, type WebProviderRouterOptions, BUILTIN_TOOLS } from '@nexus/tools';
import { Sandbox, resolveSandboxEffective, type SandboxConfig, type SandboxLevel, DenyAllApprovalHandler } from '@nexus/sandbox';
import type { ApprovalHandler } from '@nexus/sandbox';
import type { PermissionPreset } from '@nexus/sandbox';
import type { RunEvent, RunEventLevel, RunRecord, ThreadStore } from '@nexus/storage';
import type { RemoteAgentClient } from './a2aClient/remoteAgentClient.js';
import {
  DEFAULT_MEMORY_SETTINGS,
  compactThread,
  extractMemoryCandidates,
  getCompactionPressure,
  mergeMemoryCandidate,
  normalizeMemorySettings,
  resumeThread,
  rollbackTurns,
  searchColdMemories,
  buildOrReuseWorkingSet,
  getThreadWorkingSetSnapshot,
  saveThreadWorkingSetSnapshot,
  emptyWorkingSetSnapshot,
  createEpisodeRecord,
  getOpenEpisodeForThread,
  saveEpisodeRecord,
  sealEpisode,
  updateEpisodeFromTurn,
  recordEpisodeUsage,
  promoteEpisodeToWarm,
  invalidateEpisodesByTurnRange,
  getEpisodeMemorySettings,
  normalizeEpisodeMemorySettings,
  DEFAULT_EPISODE_MEMORY_SETTINGS,
  listLightMemories,
  type MemorySettings,
  type EpisodeMemorySettings,
} from '@nexus/memory';
import { loadAgentsMd, LocalSkillRegistry, LocalHookRegistry } from '@nexus/extensions';
import type { HookRegistry, SkillRegistry } from '@nexus/extensions';
import { createI18n, systemPromptKey } from '@nexus/i18n';
import type { Locale, I18n } from '@nexus/i18n';
import { ThreadStateManager } from './state.js';
import type { ThreadState } from './state.js';
import type { Checkpoint } from '@nexus/protocol';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { shouldEnableWebSearch, type WebSearchMode } from './webSearchPolicy.js';
import { parseMcpNamespacedToolName } from './mcpClient.js';
import { buildPromptCacheShape, comparePromptCacheShape, type PromptCacheShape } from './cacheShape.js';
import { compactionOptionsForRunProfile, normalizeRunProfile, type RunProfile } from './runProfile.js';
import { leaksToolProtocol, validateThreadItemsForPersistence } from './modelOutput.js';
import { NexusRuntimeError, affectsTurnStatus, isRecoverableStreamError, toNexusErrorInfo } from './runtimeError.js';
import type { RunTurnOptions, HarnessItemFields, HarnessResult } from './harness/types.js';
import { TaskHarnessEngine, type HarnessAgentLoop } from './harness/taskHarness.js';
import { DEFAULT_HARNESS_CONFIG } from './harness/types.js';
import type { EvaluatorModelGateway } from './harness/goalEvaluator.js';
import {
  composeRuntimeMiddleware,
  createDynamicContextMiddleware,
  createStabilityMiddleware,
  type RuntimeMiddleware,
  type RuntimeModelRequest,
  type RuntimeToolRequest,
  type RuntimeToolResponse,
  type RuntimeTurnResult,
  type RuntimeTurnContext,
} from './middleware.js';
import {
  createToolSearchTool,
  toolNamesFromSearchResult,
  TOOL_SEARCH_TOOL_NAME,
} from './toolSearch.js';
import { createToolGovernanceMiddleware, type ToolGovernanceConfig } from './toolGovernance.js';
import { createGuardianMiddleware, type GuardianConfig } from './guardian.js';
import { SystemMonitor, DEFAULT_SYSTEM_MONITOR_CONFIG, type SystemMonitorConfig } from './systemMonitor.js';
import type { SystemMonitorLevel, SystemMonitorStatus } from '@nexus/protocol';

const RUNNING_CHECKPOINT_TTL_MS = 30 * 60 * 1000;
const MAX_WEB_SEARCH_CALLS_PER_TURN = 6;
const MAX_DUPLICATE_WEB_SEARCH_QUERY_PER_TURN = 2;
const MODEL_HISTORY_TOKEN_BUDGET = 40_000;

export type ToolBindingMode = 'eager' | 'delayed';

export const DEFAULT_AGENT_ROLE_NAME = 'default';

export interface AgentRoleProfile {
  // 中文注释：展示给模型与 list_agents 调用者的人类可读用途说明。
  /** Human-readable purpose shown to the model and list_agents callers. */
  description?: string;
  // 中文注释：附加到子 agent 系统提示的角色特定指令。
  /** Role-specific instructions appended to the child system prompt. */
  instructions?: string;
  // 中文注释：instructions 的别名，与常见配置命名一致。
  /** Alias for instructions, matching common config naming. */
  systemPrompt?: string;
  // 中文注释：角色作用域内的技能。等价于 allowedSkills。
  /** Role-scoped skills. Equivalent to allowedSkills. */
  skills?: string[];
  // 中文注释：对使用此角色生成的子 agent 可见的技能名称。
  /** Skill names visible to spawned agents using this role. */
  allowedSkills?: string[];
  // 中文注释：对使用此角色生成的子 agent 可见且可执行的工具名称。
  /** Tool names visible and executable by spawned agents using this role. */
  allowedTools?: string[];
  // 中文注释：对使用此角色生成的子 agent 隐藏并拒绝的工具名称。
  /** Tool names hidden and rejected for spawned agents using this role. */
  blockedTools?: string[];
  // 中文注释：复制到子线程的元数据；不会切换继承的模型。
  /** Metadata copied to the child thread; it does not switch the inherited model. */
  serviceTier?: string;
  // 中文注释：此 agent 可生成的子 agent 的本地数量上限。
  /** Role-local limit for children spawned by this agent. */
  maxSubagents?: number;
  // 中文注释：角色本地的子 agent 嵌套深度上限。
  /** Role-local child-agent depth limit. */
  maxSubagentDepth?: number;
}

export interface ResolvedAgentRoleProfile extends AgentRoleProfile {
  name: string;
}

export type AgentRoleProfiles = Record<string, AgentRoleProfile>;

// ─── Config ─────────────────────────────────────────────────────────────────
// 中文注释：运行时配置接口。
export interface AgentConfig {
  // 中文注释：文件操作的工作区根目录。
  /** Workspace root for file operations. */
  workspaceRoot: string;
  // 中文注释：沙箱配置。
  /** Sandbox config. */
  sandbox: SandboxConfig;
  // 中文注释：模型网关实例。
  /** Model gateway instance. */
  model: ModelGateway;
  // 中文注释：线程存储。
  /** Thread store. */
  store: ThreadStore;
  // 中文注释：运行时租户隔离 ID。
  /** Runtime tenant isolation id. */
  tenantId?: string;
  // 中文注释：工具注册表（默认为 BUILTIN_TOOLS）。
  /** Tool registry (defaults to BUILTIN_TOOLS). */
  tools?: ToolRegistry;
  // 中文注释：从已启用的 MCP 服务器发现的 MCP 工具。
  /** MCP tools discovered from enabled MCP servers. */
  mcpTools?: ToolDefinition[];
  // 中文注释：审批处理器（默认为 DenyAllApprovalHandler）。
  /** Approval handler (defaults to DenyAllApprovalHandler). */
  approvalHandler?: ApprovalHandler;
  // 中文注释：每个回合 agent 循环的最大迭代次数。
  /** Max agent loop iterations per turn. */
  maxIterations?: number;
  // 中文注释：系统提示覆盖。
  /** System prompt override. */
  systemPrompt?: string;
  // 中文注释：技能注册表。
  /** Skills registry. */
  skills?: SkillRegistry;
  // 中文注释：hooks 注册表。
  /** Hooks registry. */
  hooks?: HookRegistry;
  // 中文注释：UI 与 agent 响应的语言（默认 'zh'）。
  /** UI + agent response locale (default: 'zh'). */
  locale?: Locale;
  // 中文注释：控制在提供者扩展可用时何时提供 web_search。
  /** Controls when web_search should be offered once a provider extension is available. */
  webSearchMode?: WebSearchMode;
  // 中文注释：传递给 web_search/web_fetch 工具的 Web 提供者设置。
  /** Web provider settings passed down to web_search/web_fetch tools. */
  webProvider?: WebProviderRouterOptions;
  // 中文注释：运行时权衡配置（缓存命中稳定性或长期追踪可追溯性）。
  /** Runtime trade-off profile: cache hit stability or long-running traceability. */
  runProfile?: RunProfile;
  // 中文注释：父线程下允许打开的已生成子 agent 最大数量。
  /** Maximum open spawned subagents below a parent thread. */
  maxSubagents?: number;
  // 中文注释：供回合/模型/工具流水线扩展使用的运行时中间件钩子。
  /** Runtime middleware hooks for turn/model/tool pipeline extension. */
  runtimeMiddleware?: RuntimeMiddleware[];
  // 中文注释：用于动态上下文注入的可选事实提供者。
  /** Optional fact provider for dynamic context injection. */
  dynamicContextProvider?: (ctx: RuntimeTurnContext) => Promise<string | string[]>;
  // 中文注释：每个回合重复执行相同工具调用的最大次数，超过则短路。
  /** Maximum repeated identical tool calls per turn before short-circuiting. */
  maxRepeatedToolCalls?: number;
  // 中文注释：连续工具响应失败的最大次数，超过则短路重试。
  /** Maximum consecutive failed tool responses before short-circuiting retries. */
  maxConsecutiveToolErrors?: number;
  // 中文注释：工具 schema 绑定策略。出于兼容性考虑，默认为 eager。
  /** Tool schema binding strategy. Defaults to eager for compatibility. */
  toolBindingMode?: ToolBindingMode;
  // 中文注释：在 delayed-binding 首次模型调用时暴露的工具名称。
  /** Tool names exposed on the first delayed-binding model call. */
  initialTools?: string[];
  // 中文注释：一次 tool_search 调用可返回并绑定的最大工具数。
  /** Maximum tools returned and bound by one tool_search call. */
  maxToolSearchResults?: number;
  // 中文注释：超出稳定性限制的运行时工具治理策略。
  /** Runtime tool governance policy beyond stability limits. */
  toolGovernance?: ToolGovernanceConfig;
  // 中文注释：子 agent 嵌套深度的最大值。根节点的子节点深度为 1。
  /** Maximum child-agent nesting depth. Root children are depth 1. */
  maxSubagentDepth?: number;
  // 中文注释：生成时模型/推理覆写的可选工厂。未设置时回退到继承模型。
  /** Optional factory for spawn-time model/reasoning overrides. Falls back to inherited model. */
  spawnModelFactory?: (override: {
    model?: string;
    reasoningEffort?: string;
    serviceTier?: string;
    agentRole?: string;
  }) => ModelGateway;
  // 中文注释：Codex 风格的 agent_type 角色配置。用户配置可按名称覆写内置配置。
  /** Codex-style agent_type profiles. User profiles override built-ins by name. */
  agentRoles?: AgentRoleProfiles;
  // 中文注释：此 AgentLoop 实例活动的角色配置；通常为已生成子 agent 设置。
  /** Active role profile for this AgentLoop instance; normally set for spawned children. */
  activeAgentRoleProfile?: ResolvedAgentRoleProfile | null;
  // 中文注释：在工具执行前的可选 Codex 风格 fail-closed 安全审查。
  /** Optional Codex-style fail-closed safety review before tool execution. */
  guardian?: GuardianConfig;
  // 中文注释：此运行时的热/温/冷记忆策略。
  /** Hot/warm/cold memory policy for this runtime. */
  memory?: Partial<MemorySettings>;
  // 中文注释：A2A 客户端配置 — 是否允许调用外部 A2A Agent。
  /** A2A client config — whether calling external A2A agents is allowed. */
  a2aClientEnabled?: boolean;
  // 中文注释：已注册的远程 A2A Agent 地址列表（用于工具描述提示）。
  /** Registered remote A2A agent URLs (used for tool description hints). */
  a2aRemotes?: string[];
  // 中文注释：系统监控配置（可开关）。启用后 agent 会收到主机 CPU/内存/磁盘压力的主动通知，
  //           并在工具执行/子 agent 委派时自动限流。
  /** System monitor config (toggleable). When enabled, the agent receives proactive
   *  host CPU/memory/disk pressure notifications and auto-throttles tool execution / subagent delegation. */
  systemMonitor?: Partial<SystemMonitorConfig>;
}

type ResolvedAgentConfig = Required<Omit<AgentConfig, 'memory' | 'a2aClientEnabled' | 'a2aRemotes' | 'systemMonitor'>> & {
  memory: MemorySettings;
  a2aClientEnabled?: boolean;
  a2aRemotes?: string[];
  systemMonitor: SystemMonitorConfig;
};

type ToolCallExecutionResult = {
  toolCall: ToolCall;
  output: string;
  disableWebSearch?: boolean;
  activateToolNames?: string[];
};

// ─── Agent Loop ─────────────────────────────────────────────────────────────
export class AgentLoop {
  private config: ResolvedAgentConfig;
  private tools: ToolRegistry;
  private i18n: I18n;
  private eventListeners: Array<(event: ThreadEvent) => void> = [];
  private subagentRuns = new Map<ThreadId, Promise<{ items: ThreadItem[]; usage: Usage | null }>>();
  private promptCacheShapes = new Map<ThreadId, PromptCacheShape>();
  private runMonitorSessions = new Map<TurnId, {
    runId: string;
    threadId: ThreadId;
    turnId: TurnId;
    sequence: number;
    startedAt: string;
    modelCallCount: number;
    toolCallCount: number;
    subagentCount: number;
    middlewareEventCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  }>();
  private runtimeMiddleware: ReturnType<typeof composeRuntimeMiddleware>;
  /** Per-thread episode working set snapshot (in-memory cache). */
  private threadWorkingSets = new Map<ThreadId, ThreadWorkingSetSnapshot>();
  /** Per-thread currently open episode (in-memory cache). */
  private threadOpenEpisodes = new Map<ThreadId, EpisodeRecord>();
  /** Per-thread state manager — process-level singleton by default. */
  readonly stateManager: ThreadStateManager;
  /** Resolved sandbox engine (lazy). */
  private _sandbox: Sandbox | null = null;
  /** Effective sandbox level from config (resolved from preset if set). */
  private _effectiveSandbox: { level: SandboxLevel; networkAllowed: boolean };
  // 中文注释：系统监控实例。仅在 config.systemMonitor.enabled=true 时启动后台采样。
  /** System monitor instance. Only starts background sampling when config.systemMonitor.enabled=true. */
  private _systemMonitor: SystemMonitor | null = null;
  // 中文注释：待注入给 agent 的系统压力通知（级别变化时写入，下一次模型调用前消费并清空）。
  /** Pending system-pressure notice to inject into the next model call (set on level change, consumed and cleared before next model call). */
  private _pendingSystemNotice: string | null = null;
  // 中文注释：取消 SystemMonitor 级别变化订阅的函数。
  /** Unsubscribe function for the SystemMonitor level-change listener. */
  private _systemMonitorUnsub: (() => void) | null = null;
  // 实施点 2：per-thread harness 字段标记，用于给 harness turn 产生的 items 打 harnessRunId
  // — English: per-thread harness fields marker, used to tag items produced by harness turns
  private harnessFieldsByThread = new Map<ThreadId, HarnessItemFields>();

  constructor(config: AgentConfig, stateManager?: ThreadStateManager) {
    const locale = config.locale ?? 'zh';
    this.i18n = createI18n(locale);
    this.stateManager = stateManager ?? ThreadStateManager.instance();
    this.config = {
      workspaceRoot: config.workspaceRoot,
      sandbox: config.sandbox,
      model: config.model,
      store: config.store,
      tenantId: safeRuntimeTenantId(config.tenantId ?? config.store.tenantId),
      tools: config.tools ?? createDefaultRegistry(),
      mcpTools: config.mcpTools ?? [],
      approvalHandler: config.approvalHandler ?? new DenyAllApprovalHandler(),
      maxIterations: config.maxIterations ?? 20,
      systemPrompt: config.systemPrompt ?? this.i18n.t(systemPromptKey(locale)),
      skills: config.skills ?? new LocalSkillRegistry(),
      hooks: config.hooks ?? new LocalHookRegistry(),
      locale,
      webSearchMode: config.webSearchMode ?? 'auto',
      webProvider: config.webProvider ?? { provider: 'native_fetch' },
      runProfile: normalizeRunProfile(config.runProfile),
      maxSubagents: config.maxSubagents ?? 4,
      runtimeMiddleware: config.runtimeMiddleware ?? [],
      dynamicContextProvider: config.dynamicContextProvider ?? (async () => []),
      maxRepeatedToolCalls: config.maxRepeatedToolCalls ?? 3,
      maxConsecutiveToolErrors: config.maxConsecutiveToolErrors ?? 3,
      toolBindingMode: config.toolBindingMode ?? 'eager',
      initialTools: config.initialTools ?? [],
      maxToolSearchResults: config.maxToolSearchResults ?? 8,
      toolGovernance: config.toolGovernance ?? {},
      maxSubagentDepth: config.maxSubagentDepth ?? Number.POSITIVE_INFINITY,
      spawnModelFactory: config.spawnModelFactory ?? (() => config.model),
      agentRoles: normalizeAgentRoleProfiles(config.agentRoles),
      activeAgentRoleProfile: config.activeAgentRoleProfile ?? null,
      guardian: config.guardian ?? {},
      memory: normalizeMemorySettings(config.memory ?? DEFAULT_MEMORY_SETTINGS),
      systemMonitor: {
        ...DEFAULT_SYSTEM_MONITOR_CONFIG,
        ...config.systemMonitor,
        thresholds: {
          ...DEFAULT_SYSTEM_MONITOR_CONFIG.thresholds,
          ...config.systemMonitor?.thresholds,
        },
      },
    };
    this.tools = this.config.tools;
    registerCollabTools(this.tools, {
      a2aClientEnabled: config.a2aClientEnabled,
      a2aRemotes: config.a2aRemotes,
    });
    registerOptionalTools(this.tools, this.config.mcpTools);
    if (this.config.toolBindingMode === 'delayed' && !this.tools.get(TOOL_SEARCH_TOOL_NAME)) {
      this.tools.register(createToolSearchTool(this.tools, {
        maxResults: this.config.maxToolSearchResults,
      }));
    }
    this._effectiveSandbox = resolveSandboxEffective(config.sandbox);
    this.runtimeMiddleware = composeRuntimeMiddleware([
      createStabilityMiddleware({
        maxRepeatedToolCalls: this.config.maxRepeatedToolCalls,
        maxConsecutiveToolErrors: this.config.maxConsecutiveToolErrors,
        maxWebSearchCallsPerTurn: MAX_WEB_SEARCH_CALLS_PER_TURN,
        maxDuplicateWebSearchQueryPerTurn: MAX_DUPLICATE_WEB_SEARCH_QUERY_PER_TURN,
      }),
      createGuardianMiddleware(this.config.guardian),
      createToolGovernanceMiddleware({
        approvalHandler: this.config.approvalHandler,
        preset: this.preset,
        sandbox: () => this.sandbox,
        governance: this.config.toolGovernance,
      }),
      createDynamicContextMiddleware(),
      ...this.config.runtimeMiddleware,
    ]);
    // 中文注释：初始化系统监控。仅当 enabled=true 时启动后台采样，并订阅级别变化用于主动通知。
    // — Chinese: init system monitor; only starts background sampling when enabled, subscribes for proactive notification
    this.initSystemMonitor();
  }

  /** 初始化系统监控并订阅级别变化事件。 */
  // — Chinese: init system monitor and subscribe to level-change events
  private initSystemMonitor(): void {
    const cfg = this.config.systemMonitor;
    if (!cfg.enabled) return;
    this._systemMonitor = new SystemMonitor(cfg);
    this._systemMonitorUnsub = this._systemMonitor.onLevelChange((status) => {
      this.handleSystemMonitorLevelChange(status);
    });
    this._systemMonitor.start();
  }

  /** 级别变化时：写入待注入通知 + 发射 warning 事件。 */
  // — Chinese: on level change: queue notice for next model call + emit warning event
  private handleSystemMonitorLevelChange(status: SystemMonitorStatus): void {
    if (status.level === 'none') {
      // 压力解除 — 注入恢复通知
      // — Chinese: pressure cleared — inject recovery notice
      this._pendingSystemNotice = `[System Monitor] Host pressure has returned to normal. You may resume normal tool execution and subagent delegation.`;
    } else {
      this._pendingSystemNotice = `[System Monitor] Host under ${status.level} pressure. ${status.recommendation} (CPU: ${status.snapshot.cpuUsage.toFixed(1)}%, Memory: ${status.snapshot.memUsage.toFixed(1)}%)`;
    }
    // 发射 warning 事件给 UI / 监听器
    // — Chinese: emit warning event to UI / listeners
    this.emit({
      type: 'warning',
      message: this._pendingSystemNotice,
    });
  }

  /** 获取当前系统监控级别（未启用时返回 'none'）。 */
  // — Chinese: get current system monitor level (returns 'none' if disabled)
  private get systemMonitorLevel(): SystemMonitorLevel {
    if (!this._systemMonitor || !this._systemMonitor.isEnabled()) return 'none';
    return this._systemMonitor.getStatus().level;
  }

  /** 消费待注入的系统通知，返回通知文本（无则返回 null）。 */
  // — Chinese: consume pending system notice, returns notice text or null
  private consumePendingSystemNotice(): string | null {
    const notice = this._pendingSystemNotice;
    this._pendingSystemNotice = null;
    return notice;
  }

  /**
   * 运行时更新系统监控配置（热更新开关/阈值）。
   * 启用时若尚未初始化则创建实例并启动；禁用时停止采样并释放资源。
   */
  /** Update system monitor config at runtime (hot-reload toggle / thresholds).
   *  Creates and starts the monitor if enabling; stops and disposes if disabling. */
  updateSystemMonitorConfig(partial: Partial<SystemMonitorConfig>): void {
    if (this._systemMonitor) {
      this._systemMonitor.updateConfig(partial);
      if (!this._systemMonitor.isEnabled()) {
        if (this._systemMonitorUnsub) {
          this._systemMonitorUnsub();
          this._systemMonitorUnsub = null;
        }
        this._systemMonitor = null;
      }
    } else if (partial.enabled) {
      const cfg: SystemMonitorConfig = {
        ...DEFAULT_SYSTEM_MONITOR_CONFIG,
        ...partial,
        thresholds: {
          ...DEFAULT_SYSTEM_MONITOR_CONFIG.thresholds,
          ...partial.thresholds,
        },
      };
      this._systemMonitor = new SystemMonitor(cfg);
      this._systemMonitorUnsub = this._systemMonitor.onLevelChange((status) => {
        this.handleSystemMonitorLevelChange(status);
      });
      this._systemMonitor.start();
    }
  }

  /** 释放系统监控资源（停止后台采样、取消订阅）。 */
  /** Dispose system monitor: stop background sampling and unsubscribe. */
  dispose(): void {
    if (this._systemMonitorUnsub) {
      this._systemMonitorUnsub();
      this._systemMonitorUnsub = null;
    }
    if (this._systemMonitor) {
      this._systemMonitor.stop();
      this._systemMonitor = null;
    }
  }

  /**
   * 共享父 agent 的 SystemMonitor 实例（不启动新采样）。
   * 子 agent 用此方法获得同一主机的监控状态，但不重复后台采样。
   */
  /**
   * Attach a shared SystemMonitor instance (without starting a new sampler).
   * Child agents use this to read the same host status without duplicate sampling.
   */
  attachSystemMonitor(monitor: SystemMonitor | null): void {
    // 不订阅级别变化 — 子 agent 的限流通过 systemMonitorLevel getter 实时读取
    // — Chinese: don't subscribe to level changes — child reads level via systemMonitorLevel getter
    this._systemMonitor = monitor;
  }

  /** Lazy Sandbox instance for exec policy evaluation. */
  private get sandbox(): Sandbox {
    if (!this._sandbox) {
      this._sandbox = new Sandbox(this.config.sandbox);
    }
    return this._sandbox;
  }

  /** Resolved effective sandbox level (from preset if set, else from config). */
  private get effectiveLevel(): SandboxLevel {
    return this._effectiveSandbox.level;
  }

  /** Resolved effective network access. */
  private get effectiveNetwork(): boolean {
    return this._effectiveSandbox.networkAllowed;
  }

  /** Resolved preset (if any). */
  private get preset(): PermissionPreset | undefined {
    return this.config.sandbox.preset;
  }

  /** Get the current locale. */
  get locale(): Locale {
    return this.config.locale;
  }

  private initialVisibleToolNames(): Set<string> {
    const names = new Set<string>([TOOL_SEARCH_TOOL_NAME]);
    for (const name of this.config.initialTools) {
      const resolved = resolveToolName(this.tools, name);
      if (this.tools.get(resolved)) {
        names.add(resolved);
      }
    }
    return names;
  }

  /** Get the i18n context (for UI to translate messages). */
  get i18nContext(): I18n {
    return this.i18n;
  }

  /** Get the thread state for a given thread. */
  getThreadState(threadId: ThreadId): ThreadState {
    return this.stateManager.get(threadId);
  }

  /**
   * 计算当前线程的上下文压力（不触发压缩、不发送事件）。
   * 供前端在加载/切换对话时主动查询。
   */
  async getContextPressure(threadId: ThreadId): Promise<{
    estimatedTokens: number;
    maxTokens: number;
    softThreshold: number;
    hardThreshold: number;
    ratio: number;
    status: 'ok' | 'soft' | 'hard';
  }> {
    const recentItems = await this.config.store.getRecentItems(threadId, 200);
    const thread = await this.config.store.getThread(threadId);
    const effectiveRecentItems = filterEffectiveCompactionItems(recentItems, thread?.tags?.compactedRanges);
    const compactionOptions = compactionOptionsForRunProfile(this.config.runProfile);
    const rolloutPressure = getCompactionPressure(effectiveRecentItems, compactionOptions);
    const estimatedTokens = rolloutPressure.estimatedTokens;
    const ratio = rolloutPressure.maxTokens > 0 ? estimatedTokens / rolloutPressure.maxTokens : 1;
    return {
      ...rolloutPressure,
      estimatedTokens,
      ratio,
      status: estimatedTokens >= rolloutPressure.hardThreshold
        ? 'hard' as const
        : estimatedTokens >= rolloutPressure.softThreshold
          ? 'soft' as const
          : 'ok' as const,
    };
  }

  async rollbackThread(threadId: ThreadId, count: number = 1): Promise<{ removedTurns: number }> {
    const requestId = `rollback_${generateId()}`;
    await this.beginControlRun(requestId, threadId, 'Thread rollback');
    const fail = async (message: string, error?: unknown): Promise<never> => {
      const info = toNexusErrorInfo(error ?? new Error(message));
      this.emit({
        type: 'thread.rollback.failed',
        threadId,
        error: { message, info },
      });
      await this.appendRunMonitorEvent(requestId, {
        category: 'rollback',
        type: 'rollback.failed',
        level: 'error',
        message,
        metadata: { requestId, count, status: 'failed', error: message },
      });
      await this.finishRunMonitor(requestId, 'failed', null, error ?? new Error(message));
      throw new Error(message);
    };

    if (!Number.isFinite(count) || count <= 0) {
      return fail('rollback count must be >= 1');
    }
    if (this.stateManager.isRunning(threadId)) {
      return fail(`Thread ${threadId} is running; rollback is not allowed during an active turn`);
    }
    if (!this.stateManager.beginRollback(threadId, requestId)) {
      return fail(`Thread ${threadId} already has a pending rollback`);
    }

    await this.appendRunMonitorEvent(requestId, {
      category: 'rollback',
      type: 'rollback.started',
      message: 'Thread rollback started',
      metadata: { requestId, count, status: 'started' },
    });
    try {
      const thread = await this.config.store.getThread(threadId);
      const result = await rollbackTurns(threadId, this.config.store, count);
      this.emit({
        type: 'thread.rollback.completed',
        threadId,
        checkpointTurnCount: Math.max(0, (thread?.turnCount ?? 0) - result.removedTurns),
      });
      await this.appendRunMonitorEvent(requestId, {
        category: 'rollback',
        type: 'rollback.completed',
        message: 'Thread rollback completed',
        metadata: { requestId, count, removedTurns: result.removedTurns, status: 'completed' },
      });
      const newTurnCount = Math.max(0, (thread?.turnCount ?? 0) - result.removedTurns);
      await this.invalidateEpisodesForRollback(threadId, newTurnCount, requestId);
      await this.finishRunMonitor(requestId, 'completed', null);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(message, error);
    } finally {
      this.stateManager.finishRollback(threadId, requestId);
    }
  }

  async getRuntimeState(threadId: ThreadId): Promise<ThreadRuntimeState> {
    const state = this.stateManager.get(threadId);
    const checkpoint = state.lastCheckpoint ?? await this.config.store.getLastCheckpoint(threadId);
    const stale = Boolean(checkpoint?.status === 'running' && checkpoint.expiresAt && checkpoint.expiresAt < new Date().toISOString());
    const status = stale
      ? 'stale'
      : state.status === 'idle' && checkpoint?.status === 'running'
        ? 'running'
        : state.status;
    return {
      threadId,
      status,
      checkpoint: checkpoint ? { ...checkpoint, status: stale ? 'stale' : checkpoint.status } : null,
      resumable: Boolean(checkpoint && checkpoint.status === 'running' && !stale),
      stale,
    };
  }

  /** Interrupt a running turn. */
  interrupt(threadId: ThreadId, requestId?: string): boolean {
    const state = this.stateManager.get(threadId);
    if (state.status !== 'running' || !state.activeTurnId) return false;
    const turnId = state.activeTurnId;
    this.stateManager.interruptTurn(threadId, turnId, requestId ?? generateId());
    this.emit({
      type: 'turn.completed',
      threadId,
      turnId,
      usage: null,
      status: 'interrupted',
    });
    return true;
  }

  /**
   * Resume a running turn after an interrupt, using the last checkpoint
   * to skip already-completed items.
   */
  async resumeRunning(
    threadId: ThreadId,
    userInput?: UserInput,
    signal?: AbortSignal,
  ): Promise<{ items: ThreadItem[]; usage: Usage | null }> {
    const state = this.stateManager.get(threadId);
    let ckpt = state.lastCheckpoint;
    if (!ckpt) {
      ckpt = await this.config.store.getLastCheckpoint(threadId);
      if (ckpt) {
        this.stateManager.setCheckpoint(threadId, ckpt);
      }
    }

    if (!ckpt) {
      if (!userInput) {
        throw new Error(`Thread ${threadId} has no checkpoint to resume`);
      }
      return this.runTurn(threadId, userInput, signal);
    }

    const thread = await this.config.store.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const turnId = ckpt.turnId;
    if (!userInput) {
      const turns = await this.config.store.getTurns(threadId);
      userInput = turns.find((turn) => turn.turnId === turnId)?.userInput;
      if (!userInput) {
        throw new Error(`Turn ${turnId} has no persisted user input to resume`);
      }
    }

    // Rehydrate already completed items so item ids remain stable.
    // 重新恢复已完成的条目，保持条目 id 稳定不变。
    const allItems = await this.config.store.getItems(threadId);
    const collectedItems: ThreadItem[] = allItems.slice(0, ckpt.itemIndex);

    // Clear interrupts and restart
    // 清除中断并重启
    this.stateManager.clearPendingInterrupts(threadId);
    const cancelController = this.stateManager.startTurn(threadId, turnId);
    const effectiveSignal = signal ?? cancelController.signal;

    this.emit({
      type: 'thread.resumed',
      threadId,
      turnIndex: thread.turnCount,
    });

    const updatedCkpt: Checkpoint = this.withCheckpointState(threadId, turnId, ckpt.itemIndex, 'running');
    const runtimeContext = await this.createRuntimeTurnContext(
      threadId,
      turnId,
      thread,
      userInput,
      updatedCkpt,
      collectedItems,
    );
    await this.beginRunMonitor({ threadId, turnId, title: thread.title, userInput });
    await this.maybeEmitWorkingSetRestored(threadId, turnId);

    const webSearchRecommended = shouldEnableWebSearch(this.config.webSearchMode, userInput);
    const webSearchToolAvailable = this.shouldOfferWebSearchTool();
    const messages = await this.buildMessages(threadId, userInput, thread, webSearchRecommended);
    let terminalTurnResult: RuntimeTurnResult | null = null;

    try {
      await this.appendRunMonitorEvent(turnId, {
        category: 'middleware',
        type: 'middleware.beforeTurn',
        message: 'beforeTurn middleware started',
      });
      await this.runtimeMiddleware.beforeTurn(runtimeContext);
      const result = await this.agentLoop(
        threadId,
        turnId,
        messages,
        collectedItems,
        effectiveSignal,
        updatedCkpt,
        webSearchToolAvailable,
        runtimeContext,
      );
      const turns = await this.config.store.getTurns(threadId);
      const turn = turns.find((candidate) => candidate.turnId === turnId);
      if (turn) {
        turn.status = 'completed';
        turn.completedAt = new Date().toISOString();
        await this.config.store.saveTurn(turn);
      }
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'completed'));
      this.stateManager.completeTurn(threadId, turnId);
      if (result.usage) await this.recordUsage(threadId, turnId, result.usage);
      this.emit({ type: 'turn.completed', threadId, turnId, usage: result.usage });
      terminalTurnResult = { status: 'completed', usage: result.usage };
      await this.finishRunMonitor(turnId, 'completed', result.usage);
      const resumedTurnIndex = turn?.index ?? thread.turnCount;
      await this.updateEpisodeFromCompletedTurn(thread, turnId, resumedTurnIndex, userInput, collectedItems);
      await this.maybeExtractColdMemories(thread, turnId, userInput, collectedItems);
      await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
      return result;
    } catch (err) {
      if (terminalTurnResult) throw err;
      if (isTurnCancelledError(err)) {
        const turns = await this.config.store.getTurns(threadId);
        const turn = turns.find((candidate) => candidate.turnId === turnId);
        if (turn) {
          turn.status = 'interrupted';
          turn.completedAt = new Date().toISOString();
          await this.config.store.saveTurn(turn);
        }
        await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'interrupted'));
        this.stateManager.completeInterruptedTurn(threadId, turnId);
        this.emit({ type: 'turn.completed', threadId, turnId, usage: null, status: 'interrupted' });
        terminalTurnResult = { status: 'interrupted', usage: null, error: err };
        await this.finishRunMonitor(turnId, 'interrupted', null, err);
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
        return { items: collectedItems, usage: null };
      }
      if (isRecoverableStreamError(err)) {
        const info = toNexusErrorInfo(err);
        const message = err instanceof Error ? err.message : String(err);
        const turns = await this.config.store.getTurns(threadId);
        const turn = turns.find((candidate) => candidate.turnId === turnId);
        if (turn) {
          turn.status = 'interrupted';
          turn.completedAt = new Date().toISOString();
          await this.config.store.saveTurn(turn);
        }
        await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'interrupted'));
        this.stateManager.completeInterruptedTurn(threadId, turnId);
        this.emit({
          type: 'stream.error',
          threadId,
          turnId,
          message,
          recoverable: true,
          error: { message, info },
        });
        this.emit({ type: 'turn.completed', threadId, turnId, usage: null, status: 'interrupted' });
        await this.appendRunMonitorEvent(turnId, {
          category: 'model',
          type: 'stream.error',
          level: 'warning',
          message,
          metadata: { info, recoverable: true },
        });
        terminalTurnResult = { status: 'interrupted', usage: null, error: err };
        await this.finishRunMonitor(turnId, 'interrupted', null, err);
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
        return { items: collectedItems, usage: null };
      }
      const errorMsg = String(err);
      const errorInfo = toNexusErrorInfo(err);
      this.stateManager.failTurn(threadId, turnId, {
        message: errorMsg,
        timestamp: new Date().toISOString(),
      });
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'failed'));
      this.emit({
        type: 'turn.failed',
        threadId,
        turnId,
        error: { message: errorMsg, info: errorInfo },
      });
      terminalTurnResult = { status: 'failed', usage: null, error: err };
      await this.finishRunMonitor(turnId, 'failed', null, err);
      try {
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
      } catch {
        // Preserve the original turn failure after afterTurn has had a chance to run.
        // 在 afterTurn 有机会执行后保留原始回合失败信息。
      }
      throw err;
    }
  }

  /**
   * Register a listener for streaming events.
   * 返回 unsubscribe 函数，调用后移除该监听器。
   * — Chinese: register listener; returns unsubscribe function.
   */
  onEvent(listener: (event: ThreadEvent) => void): () => void {
    this.eventListeners.push(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  /** Emit an event to all listeners. */
  private emit(event: ThreadEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // don't let listener errors crash the loop
        // 不让监听器错误导致循环崩溃
      }
    }
  }

  private discardTransientItem(
    threadId: ThreadId,
    turnId: TurnId,
    collectedItems: ThreadItem[],
    itemId?: string,
  ): void {
    if (!itemId) return;
    const itemIndex = collectedItems.findIndex((item) => item.id === itemId);
    if (itemIndex >= 0) collectedItems.splice(itemIndex, 1);
    this.emit({ type: 'item.discarded', threadId, turnId, itemId });
  }

  private async beginRunMonitor(options: {
    threadId: ThreadId;
    turnId: TurnId;
    title: string;
    userInput: UserInput;
  }): Promise<void> {
    const now = new Date().toISOString();
    const runId = `run_${options.turnId}`;
    const session = {
      runId,
      threadId: options.threadId,
      turnId: options.turnId,
      sequence: 0,
      startedAt: now,
      modelCallCount: 0,
      toolCallCount: 0,
      subagentCount: 0,
      middlewareEventCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    this.runMonitorSessions.set(options.turnId, session);
    await this.safeMonitorWrite(async () => {
      const record: RunRecord = {
        runId,
        tenantId: this.config.tenantId,
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'turn',
        status: 'running',
        title: options.title,
        caller: 'lead_agent',
        activeStep: 'turn',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        toolCallCount: 0,
        modelCallCount: 0,
        subagentCount: 0,
        middlewareEventCount: 0,
        firstHumanMessage: truncateMonitorText(userInputToText(options.userInput)),
        startedAt: now,
        updatedAt: now,
        metadata: { locale: this.config.locale, runProfile: this.config.runProfile },
      };
      await this.config.store.createRunRecord?.(record);
    });
    await this.appendRunMonitorEvent(options.turnId, {
      category: 'turn',
      type: 'turn.started',
      level: 'info',
      message: 'Turn started',
      metadata: { tenantId: this.config.tenantId },
    });
  }

  private async beginControlRun(runKey: TurnId, threadId: ThreadId, title: string): Promise<void> {
    const now = new Date().toISOString();
    const runId = `run_${runKey}`;
    const session = {
      runId,
      threadId,
      turnId: runKey,
      sequence: 0,
      startedAt: now,
      modelCallCount: 0,
      toolCallCount: 0,
      subagentCount: 0,
      middlewareEventCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    this.runMonitorSessions.set(runKey, session);
    await this.safeMonitorWrite(async () => {
      await this.config.store.createRunRecord?.({
        runId,
        tenantId: this.config.tenantId,
        threadId,
        turnId: null,
        kind: 'control',
        status: 'running',
        title,
        caller: 'lead_agent',
        activeStep: 'rollback',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        toolCallCount: 0,
        modelCallCount: 0,
        subagentCount: 0,
        middlewareEventCount: 0,
        startedAt: now,
        updatedAt: now,
        metadata: { tenantId: this.config.tenantId },
      });
    });
  }

  private async appendRunMonitorEvent(turnId: TurnId, event: {
    category: RunEvent['category'];
    type: string;
    level?: RunEventLevel;
    message: string;
    toolName?: string | null;
    model?: string | null;
    durationMs?: number | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const session = this.runMonitorSessions.get(turnId);
    if (!session) return;
    session.sequence += 1;
    if (event.category === 'model') session.modelCallCount += event.type === 'model.started' ? 1 : 0;
    if (event.category === 'tool') session.toolCallCount += event.type.endsWith('.started') ? 1 : 0;
    if (event.category === 'subagent') session.subagentCount += event.type.endsWith('.started') ? 1 : 0;
    if (event.category === 'middleware') session.middlewareEventCount += 1;
    const createdAt = new Date().toISOString();
    await this.safeMonitorWrite(async () => {
      await this.config.store.appendRunEvent?.({
        eventId: `${session.runId}_event_${session.sequence}`,
        runId: session.runId,
        tenantId: this.config.tenantId,
        threadId: session.threadId,
        turnId: session.turnId,
        sequence: session.sequence,
        category: event.category,
        type: event.type,
        level: event.level ?? 'info',
        message: event.message,
        toolName: event.toolName ?? null,
        model: event.model ?? null,
        durationMs: event.durationMs ?? null,
        metadata: event.metadata ?? {},
        createdAt,
      });
      await this.config.store.updateRunRecord?.(session.runId, {
        activeStep: event.category,
        updatedAt: createdAt,
        toolCallCount: session.toolCallCount,
        modelCallCount: session.modelCallCount,
        subagentCount: session.subagentCount,
        middlewareEventCount: session.middlewareEventCount,
      });
    });
  }

  private async finishRunMonitor(turnId: TurnId, status: RunRecord['status'], usage: Usage | null, error?: unknown): Promise<void> {
    const session = this.runMonitorSessions.get(turnId);
    if (!session) return;
    const completedAt = new Date().toISOString();
    await this.appendRunMonitorEvent(turnId, {
      category: 'turn',
      type: status === 'completed' ? 'turn.completed' : `turn.${status}`,
      level: status === 'failed' ? 'error' : status === 'interrupted' ? 'warning' : 'info',
      message: status === 'completed' ? 'Turn completed' : `Turn ${status}`,
      metadata: usage ? { usage } : {},
    });
    await this.safeMonitorWrite(async () => {
      await this.config.store.updateRunRecord?.(session.runId, {
        status,
        activeStep: 'done',
        inputTokens: session.inputTokens,
        cachedInputTokens: session.cachedInputTokens,
        outputTokens: session.outputTokens,
        reasoningOutputTokens: session.reasoningOutputTokens,
        toolCallCount: session.toolCallCount,
        modelCallCount: session.modelCallCount,
        subagentCount: session.subagentCount,
        middlewareEventCount: session.middlewareEventCount,
        error: error ? String(error instanceof Error ? error.message : error) : null,
        completedAt,
        updatedAt: completedAt,
      });
    });
    this.runMonitorSessions.delete(turnId);
  }

  private async safeMonitorWrite(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.emit({
        type: 'error',
        message: `Run monitor write failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  /** Start a new thread. */
  async startThread(title?: string, options: { workspaceRoot?: string; tags?: Record<string, string> } = {}): Promise<ThreadMeta> {
    const threadId = generateId();
    const now = new Date().toISOString();
    const meta: ThreadMeta = {
      threadId,
      tenantId: this.config.tenantId,
      title: title ?? 'Untitled',
      workspaceRoot: options.workspaceRoot ?? this.config.workspaceRoot,
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags: options.tags ?? {},
    };
    await this.config.store.createThread(meta);
    const event = { type: 'thread.started' as const, threadId, thread: meta };
    this.emit(event);
    await this.config.hooks.trigger('session_start', { threadId, workspaceRoot: this.config.workspaceRoot });
    return meta;
  }

  /** Resume an existing thread. */
  async resumeThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    const result = await resumeThread(threadId, this.config.store);
    if (!result) return null;
    this.emit({
      type: 'thread.resumed',
      threadId,
      turnIndex: result.turns.length,
    });
    const latestTurnId = result.turns.length > 0 ? result.turns[result.turns.length - 1].turnId : threadId;
    await this.emitCompactionPressure(threadId, latestTurnId);
    return result.thread;
  }

  async resumeTree(threadId: ThreadId): Promise<{
    threadId: ThreadId;
    children: Array<{
      threadId: ThreadId;
      status: ThreadRuntimeState['status'];
      checkpoint: Checkpoint | null;
      stale: boolean;
    }>;
  }> {
    const edges = await this.config.store.listThreadSpawnDescendants(threadId, 'open');
    const children = [];
    for (const edge of edges) {
      const state = await this.getRuntimeState(edge.childThreadId);
      if (state.checkpoint) {
        this.stateManager.setCheckpoint(edge.childThreadId, state.checkpoint);
      }
      if (state.stale && state.checkpoint?.turnId) {
        const turns = await this.config.store.getTurns(edge.childThreadId);
        const staleTurn = turns.find((turn) => turn.turnId === state.checkpoint?.turnId);
        if (staleTurn && staleTurn.status === 'running') {
          staleTurn.status = 'interrupted';
          staleTurn.completedAt = new Date().toISOString();
          await this.config.store.saveTurn(staleTurn);
        }
        await this.writeCheckpoint(edge.childThreadId, {
          ...state.checkpoint,
          status: 'stale',
          timestamp: new Date().toISOString(),
          expiresAt: undefined,
        });
      }
      children.push({
        threadId: edge.childThreadId,
        status: state.status,
        checkpoint: state.checkpoint,
        stale: state.stale,
      });
    }
    return { threadId, children };
  }

  /** Run a single turn (user input → agent → tool calls → ... → final response). */
  async runTurn(
    threadId: ThreadId,
    userInput: UserInput,
    signal?: AbortSignal,
    options?: RunTurnOptions,
  ): Promise<{ items: ThreadItem[]; usage: Usage | null }> {
    const thread = await this.config.store.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Check if already running
    // 检查是否已在运行
    if (this.stateManager.isRunning(threadId)) {
      throw new Error(`Thread ${threadId} already has an active turn`);
    }

    // Gap 3 / Gap 9: 解析 RunTurnOptions，设置 harness 字段标记和副作用控制
    // — English: parse RunTurnOptions for harness fields and side-effect control
    const harnessFields: HarnessItemFields | null = options?.harnessRunId
      ? {
          harnessRunId: options.harnessRunId,
          ...(options.harnessIteration !== undefined ? { harnessIteration: options.harnessIteration } : {}),
        }
      : null;
    if (harnessFields) {
      this.harnessFieldsByThread.set(threadId, harnessFields);
    }
    // 副作用控制：harness 续跑默认跳过 cold memory 提取，保留 episode 更新
    const skipColdMemory = options?.skipColdMemory ?? false;
    const extractMemory = options?.extractMemory ?? !skipColdMemory;
    const updateEpisode = options?.updateEpisode ?? true;

    const turnId = generateId();
    const turnIndex = thread.turnCount;
    const turn: TurnMeta = {
      turnId,
      threadId,
      index: turnIndex,
      userInput,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    // State machine: start turn
    // 状态机：启动回合
    const cancelController = this.stateManager.startTurn(threadId, turnId);
    const effectiveSignal = signal ?? cancelController.signal;

    // Write initial checkpoint
    // 写入初始检查点
    const checkpoint = this.withCheckpointState(threadId, turnId, 0, 'running');
    await this.writeCheckpoint(threadId, checkpoint);

    await this.config.store.saveTurn(turn);
    await this.config.store.updateThreadMetadata(threadId, {
      turnCount: turnIndex + 1,
    });

    await this.beginRunMonitor({ threadId, turnId, title: thread.title, userInput });
    this.emit({ type: 'turn.started', threadId, turnId, turnIndex });
    await this.config.hooks.trigger('turn_start', {
      threadId,
      turnId,
      workspaceRoot: this.config.workspaceRoot,
    });

    // Episode working set preparation (after turn_start hook, before compaction).
    await this.prepareEpisodeWorkingSet(thread, turnId, turnIndex, userInput);

    // Pre-turn auto compaction: visible item, then compacted summary enters context.
    // 回合前自动压缩：可见条目，然后压缩摘要进入上下文。
    await this.maybeAutoCompact(threadId, turnId);
    const refreshedThread = await this.config.store.getThread(threadId) ?? thread;

    // Build messages
    // 构建消息
    const webSearchRecommended = shouldEnableWebSearch(this.config.webSearchMode, userInput);
    const webSearchToolAvailable = this.shouldOfferWebSearchTool();
    const messages = await this.buildMessages(threadId, userInput, refreshedThread, webSearchRecommended);
    const userItem: ThreadItem = {
      id: generateItemId(turnId, 0),
      type: 'user_message',
      turnId,
      text: userInputToText(userInput),
      timestamp: turn.startedAt,
    };
    const collectedItems: ThreadItem[] = [userItem];
    this.emitItem(threadId, turnId, userItem);
    await this.persistItems(threadId, [userItem]);
    this.refreshRunningCheckpoint(checkpoint, threadId, turnId, collectedItems.length);
    await this.writeCheckpoint(threadId, checkpoint);
    const runtimeContext = await this.createRuntimeTurnContext(
      threadId,
      turnId,
      refreshedThread,
      userInput,
      checkpoint,
      collectedItems,
    );

    // Main agent loop
    // 主 agent 循环
    let terminalTurnResult: RuntimeTurnResult | null = null;
    try {
      await this.appendRunMonitorEvent(turnId, {
        category: 'middleware',
        type: 'middleware.beforeTurn',
        message: 'beforeTurn middleware started',
      });
      await this.runtimeMiddleware.beforeTurn(runtimeContext);
      const result = await this.agentLoop(
        threadId,
        turnId,
        messages,
        collectedItems,
        effectiveSignal,
        checkpoint,
        webSearchToolAvailable,
        runtimeContext,
      );
      turn.status = 'completed';
      turn.completedAt = new Date().toISOString();
      await this.config.store.saveTurn(turn);
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'completed'));
      this.stateManager.completeTurn(threadId, turnId);
      if (result.usage) await this.recordUsage(threadId, turnId, result.usage);
      this.emit({ type: 'turn.completed', threadId, turnId, usage: result.usage });
      terminalTurnResult = { status: 'completed', usage: result.usage };
      await this.finishRunMonitor(turnId, 'completed', result.usage);
      // Gap 9: 副作用控制 — harness 续跑按 options 决定是否更新 episode / 提取 cold memory
      if (updateEpisode) {
        await this.updateEpisodeFromCompletedTurn(refreshedThread, turnId, turnIndex, userInput, collectedItems);
      }
      if (extractMemory) {
        await this.maybeExtractColdMemories(refreshedThread, turnId, userInput, collectedItems);
      }
      await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
      return result;
    } catch (err) {
      if (terminalTurnResult) throw err;
      if (isTurnCancelledError(err)) {
        turn.status = 'interrupted';
        turn.completedAt = new Date().toISOString();
        await this.config.store.saveTurn(turn);
        await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'interrupted'));
        this.stateManager.completeInterruptedTurn(threadId, turnId);
        this.emit({ type: 'turn.completed', threadId, turnId, usage: null, status: 'interrupted' });
        terminalTurnResult = { status: 'interrupted', usage: null, error: err };
        await this.finishRunMonitor(turnId, 'interrupted', null, err);
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
        return { items: collectedItems, usage: null };
      }
      if (isRecoverableStreamError(err)) {
        const info = toNexusErrorInfo(err);
        const message = err instanceof Error ? err.message : String(err);
        turn.status = 'interrupted';
        turn.completedAt = new Date().toISOString();
        await this.config.store.saveTurn(turn);
        const errorItem: ThreadItem = {
          id: generateItemId(turnId, collectedItems.length),
          type: 'error',
          turnId,
          message,
          info,
          timestamp: new Date().toISOString(),
        };
        collectedItems.push(errorItem);
        this.emitItem(threadId, turnId, errorItem);
        await this.persistItems(threadId, [errorItem]);
        await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'interrupted'));
        this.stateManager.completeInterruptedTurn(threadId, turnId);
        this.emit({
          type: 'stream.error',
          threadId,
          turnId,
          message,
          recoverable: true,
          error: { message, info },
        });
        this.emit({ type: 'turn.completed', threadId, turnId, usage: null, status: 'interrupted' });
        await this.appendRunMonitorEvent(turnId, {
          category: 'model',
          type: 'stream.error',
          level: 'warning',
          message,
          metadata: { info, recoverable: true },
        });
        terminalTurnResult = { status: 'interrupted', usage: null, error: err };
        await this.finishRunMonitor(turnId, 'interrupted', null, err);
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
        return { items: collectedItems, usage: null };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorInfo = toNexusErrorInfo(err);
      const errorItem: ThreadItem = {
        id: generateItemId(turnId, collectedItems.length),
        type: 'error',
        turnId,
        message: errorMsg,
        info: errorInfo,
        timestamp: new Date().toISOString(),
      };
      collectedItems.push(errorItem);
      this.emitItem(threadId, turnId, errorItem);
      await this.persistItems(threadId, [errorItem]);
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'failed'));
      turn.status = 'failed';
      turn.completedAt = new Date().toISOString();
      await this.config.store.saveTurn(turn);
      this.stateManager.failTurn(threadId, turnId, {
        message: errorMsg,
        timestamp: new Date().toISOString(),
      });
      this.emit({
        type: 'turn.failed',
        threadId,
        turnId,
        error: { message: errorMsg, info: errorInfo },
      });
      terminalTurnResult = { status: 'failed', usage: null, error: err };
      await this.finishRunMonitor(turnId, 'failed', null, err);
      try {
        await this.finishTurnLifecycle(runtimeContext, terminalTurnResult);
      } catch {
        // Preserve the original turn failure after afterTurn has had a chance to run.
        // 在 afterTurn 有机会执行后保留原始回合失败信息。
      }
      throw err;
    } finally {
      // 实施点 2：清理 per-thread harness 字段标记，避免泄漏到后续 turn
      // — English: clear per-thread harness fields marker to avoid leaking to subsequent turns
      if (harnessFields) {
        this.harnessFieldsByThread.delete(threadId);
      }
    }
  }

  /**
   * Gap 1 / Gap 3: Task Harness Engine 入口。
   * 启动跨 turn 自主循环：Goal → Plan → Execute → Critique → Replan → Verify。
   * 调用方（API route）拿到 harnessRunId 后可立即返回，循环在后台进行。
   */
  async runHarness(
    threadId: ThreadId,
    userInput: UserInput,
    options?: {
      goal?: string;
      acceptanceCriteria?: string[];
      maxContinuations?: number;
      signal?: AbortSignal;
      /** Gap 1: 调用方预生成的 harnessRunId，用于 API 立即返回 */
      harnessRunId?: string;
    },
  ): Promise<HarnessResult> {
    // EvaluatorModelGateway adapter：把 ModelGateway.chat 包装成 completeOnce
    // — English: adapt ModelGateway.chat into EvaluatorModelGateway.completeOnce
    const evaluatorModel: EvaluatorModelGateway = {
      completeOnce: async (prompt, opts) => {
        const response = await this.config.model.chat(
          {
            messages: [{ role: 'user', content: prompt }],
          },
          { signal: opts?.signal },
        );
        const choice = response.choices[0];
        const content = choice?.message?.content;
        if (typeof content === 'string') return content;
        // 多模态 content 降级为空串（evaluator prompt 期望纯文本响应）
        return '';
      },
    };

    // 构造 TaskHarnessEngine：this 作为 HarnessAgentLoop（runTurn 已扩展为 4 参数）
    // — English: build TaskHarnessEngine with this agent as the loop delegate
    const engine = new TaskHarnessEngine(
      this as unknown as HarnessAgentLoop,
      evaluatorModel,
      this.config.store,
      DEFAULT_HARNESS_CONFIG,
    );

    return engine.runHarness(threadId, userInput, options);
  }

  // ─── Agent Loop Core ──────────────────────────────────────────────────────
  private async agentLoop(
    threadId: ThreadId,
    turnId: TurnId,
    messages: ChatMessage[],
    collectedItems: ThreadItem[],
    signal: AbortSignal,
    checkpoint: Checkpoint,
    webSearchToolAvailable: boolean,
    runtimeContext: RuntimeTurnContext,
  ): Promise<{ items: ThreadItem[]; usage: Usage | null }> {
    let iteration = 0;
    let usage: Usage | null = null;
    let webSearchDisabled = false;
    const visibleToolNames = this.config.toolBindingMode === 'delayed'
      ? this.initialVisibleToolNames()
      : undefined;

    while (iteration < this.config.maxIterations) {
      if (signal.aborted) throw new Error('Turn cancelled');

      // 中文注释：主动通知 — 若 SystemMonitor 级别变化，在下一次模型调用前注入系统通知
      // — Chinese: proactive notification — inject system notice before next model call if level changed
      const pendingNotice = this.consumePendingSystemNotice();
      if (pendingNotice) {
        messages.push({
          role: 'user',
          content: pendingNotice,
        });
        await this.appendRunMonitorEvent(turnId, {
          category: 'middleware',
          type: 'middleware.system_monitor_notice',
          level: 'warning',
          message: pendingNotice,
          metadata: { iteration },
        });
      }

      iteration++;
      const streamed = await this.runModelStream(
        threadId,
        turnId,
        collectedItems,
        messages,
        webSearchToolAvailable && !webSearchDisabled,
        runtimeContext,
        signal,
        visibleToolNames,
      );
      usage = streamed.usage;
      const message = streamed.message;

      // If no tool calls, this is the final response
      // 如果没有工具调用，就是最终响应
      if (!message.tool_calls || message.tool_calls.length === 0) {
        if (isTextToolPlaceholder(message.content) && iteration < this.config.maxIterations) {
          await this.appendRunMonitorEvent(turnId, {
            category: 'model',
            type: 'model.plain_text_tool_call',
            level: 'warning',
            message: 'Model emitted a plain-text tool call placeholder; requesting a structured retry',
            metadata: { iteration },
          });
          messages.push({
            role: 'assistant',
            content: message.content ?? '',
          });
          messages.push({
            role: 'user',
            content: this.config.locale === 'zh'
              ? '你刚才把工具调用写成了普通文本占位符。不要输出类似 [Tool xxx]、<|tool_calls|>、DSML 的文本工具调用。如果需要工具，请使用结构化 tool call；如果不需要工具，请直接给出完整最终回答。'
              : 'You wrote a tool call as plain text. Do not output placeholders like [Tool xxx], <|tool_calls|>, or DSML. If you need a tool, use a structured tool call; otherwise provide the complete final answer directly.',
          });
          continue;
        }
        return { items: collectedItems, usage };
      }

      // Process tool calls
      // 处理工具调用
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      const toolResults = await this.executeToolCallBatch(
        threadId,
        turnId,
        message.tool_calls,
        collectedItems,
        runtimeContext,
        signal,
        visibleToolNames,
      );

      for (const toolResult of toolResults) {
        if (toolResult.disableWebSearch) {
          webSearchDisabled = true;
        }
        if (visibleToolNames && toolResult.activateToolNames) {
          for (const name of toolResult.activateToolNames) {
            visibleToolNames.add(resolveToolName(this.tools, name));
          }
        }

        // Update checkpoint after each tool execution
        // 每次工具执行后更新检查点
        this.refreshRunningCheckpoint(checkpoint, threadId, turnId, collectedItems.length);
        await this.writeCheckpoint(threadId, checkpoint);

        messages.push({
          role: 'tool',
          content: toolResult.output,
          tool_call_id: toolResult.toolCall.id,
        });
      }

      const compacted = await this.maybeAutoCompact(threadId, turnId, 'mid_turn', messages);
      if (compacted) {
        const refreshedThread = await this.config.store.getThread(threadId);
        if (refreshedThread) {
          const webSearchRecommended = shouldEnableWebSearch(this.config.webSearchMode, runtimeContext.userInput);
          const rebuilt = await this.buildMessages(
            threadId,
            runtimeContext.userInput,
            refreshedThread,
            webSearchRecommended,
            false,
          );
          messages.splice(0, messages.length, ...rebuilt);
        }
      }
    }

    throw new Error(this.i18n.t('runtime.max_iterations', { max: this.config.maxIterations }));
  }

  private roleToolFilter(): { include?: string[]; exclude?: string[] } | undefined {
    const profile = this.config.activeAgentRoleProfile;
    if (!profile) return undefined;
    return {
      include: profile.allowedTools && profile.allowedTools.length > 0 ? profile.allowedTools : undefined,
      exclude: profile.blockedTools && profile.blockedTools.length > 0 ? profile.blockedTools : undefined,
    };
  }

  private isToolAllowedByRole(toolName: string): boolean {
    const profile = this.config.activeAgentRoleProfile;
    if (!profile) return true;
    if (profile.blockedTools?.includes(toolName)) return false;
    if (profile.allowedTools?.length && !profile.allowedTools.includes(toolName)) return false;
    return true;
  }

  private async runModelStream(
    threadId: ThreadId,
    turnId: TurnId,
    collectedItems: ThreadItem[],
    messages: ChatMessage[],
    webSearchToolAvailable: boolean,
    runtimeContext: RuntimeTurnContext,
    signal: AbortSignal,
    visibleToolNames?: ReadonlySet<string>,
  ): Promise<{ message: ChatMessage; usage: Usage | null }> {
    const roleToolFilter = this.roleToolFilter();
    const tools = this.tools
      .toOpenAITools(roleToolFilter)
      .filter((tool) => !visibleToolNames || visibleToolNames.has(tool.function.name))
      .filter((tool) => tool.function.name !== 'web_fetch')
      .filter((tool) => webSearchToolAvailable || tool.function.name !== 'web_search');

    let modelRequest: RuntimeModelRequest = {
      messages,
      tools,
      tool_choice: 'auto',
      signal,
    };
    await this.appendRunMonitorEvent(turnId, {
      category: 'middleware',
      type: 'middleware.beforeModel',
      message: 'beforeModel middleware started',
      metadata: { messageCount: messages.length, toolCount: tools.length },
    });
    modelRequest = await this.runtimeMiddleware.beforeModel(runtimeContext, modelRequest);
    const cacheShape = buildPromptCacheShape(modelRequest.messages, modelRequest.tools ?? []);
    const cacheComparison = comparePromptCacheShape(this.promptCacheShapes.get(threadId), cacheShape);
    this.promptCacheShapes.set(threadId, cacheShape);
    this.emit({
      type: 'cache.diagnostics',
      threadId,
      turnId,
      shape: cacheShape,
      stable: cacheComparison.stable,
      reasons: cacheComparison.reasons,
    });
    this.emit({
      type: 'context.token_estimate.updated',
      threadId,
      turnId,
      estimate: estimateRuntimeChatTokens(modelRequest.messages),
    });

    await this.appendRunMonitorEvent(turnId, {
      category: 'model',
      type: 'model.started',
      message: 'Model stream started',
      metadata: { messageCount: modelRequest.messages.length, toolCount: modelRequest.tools?.length ?? 0 },
    });
    let response: { message: ChatMessage; usage: Usage | null };
    try {
      response = await this.runtimeMiddleware.wrapModel(runtimeContext, modelRequest, async (request) => {
      let content = '';
      let usage: Usage | null = null;
      let agentItem: ThreadItem | null = null;
      const toolCalls = new Map<string, ToolCall>();
      const requestSignal = request.signal ?? signal;

      try {
      for await (const event of this.config.model.chatStream({
        messages: request.messages,
        tools: request.tools,
        tool_choice: request.tool_choice ?? 'auto',
      }, {
        signal: requestSignal,
        onRetry: (notice) => {
          this.emit({
            type: 'model.retry',
            threadId,
            turnId,
            attempt: notice.attempt,
            maxAttempts: notice.maxAttempts,
            delayMs: notice.delayMs,
            status: notice.status,
            error: notice.error,
          });
        },
      })) {
        if (requestSignal.aborted) throw new Error('Turn cancelled');
        if (event.type === 'delta') {
          if (!agentItem) {
            agentItem = {
              id: generateItemId(turnId, collectedItems.length),
              type: 'agent_message',
              turnId,
              text: '',
              timestamp: new Date().toISOString(),
            };
            collectedItems.push(agentItem);
            this.emit({ type: 'item.started', threadId, turnId, item: agentItem });
          }
          content += event.content;
          agentItem.text = content;
          this.emit({
            type: 'agent_message.delta',
            threadId,
            turnId,
            itemId: agentItem.id,
            delta: event.content,
          });
          this.emit({ type: 'item.updated', threadId, turnId, item: agentItem });
        } else if (event.type === 'tool_call_start' || event.type === 'tool_call_delta') {
          const id = event.id || `tool_${toolCalls.size}`;
          const existing = toolCalls.get(id) ?? {
            id,
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          if (event.type === 'tool_call_start') {
            existing.function.name = event.name;
          } else {
            existing.function.arguments = event.arguments;
          }
          toolCalls.set(id, existing);
        } else if (event.type === 'tool_call_end') {
          const id = event.id || `tool_${toolCalls.size}`;
          toolCalls.set(id, {
            id,
            type: 'function',
            function: {
              name: event.name,
              arguments: event.arguments,
            },
          });
        } else if (event.type === 'done') {
          usage = event.usage
            ? {
                inputTokens: event.usage.prompt_tokens,
                cachedInputTokens: event.usage.cached_tokens ?? 0,
                outputTokens: event.usage.completion_tokens,
                reasoningOutputTokens: 0,
                cacheStrategy: event.usage.cache_strategy,
              }
            : usage;
        } else if (event.type === 'error') {
          throw event.error;
        }
      }
      } catch (error) {
        if (agentItem && content.trim() && (isRecoverableStreamError(error) || isTurnCancelledError(error))) {
          const partialValidation = validateThreadItemsForPersistence([agentItem]);
          if (partialValidation.ok) {
            this.emit({ type: 'item.completed', threadId, turnId, item: agentItem });
            await this.persistItems(threadId, [agentItem]);
          } else {
            this.discardTransientItem(threadId, turnId, collectedItems, agentItem.id);
            this.emit({
              type: 'model.output.rejected',
              threadId,
              turnId,
              message: partialValidation.error.message,
              error: { message: partialValidation.error.message, info: partialValidation.error.info },
            });
            await this.appendRunMonitorEvent(turnId, {
              category: 'model',
              type: 'model.output.rejected',
              level: 'warning',
              message: partialValidation.error.message,
              metadata: { info: partialValidation.error.info },
            });
          }
        }
        const info = toNexusErrorInfo(error);
        throw new NexusRuntimeError(error instanceof Error ? error.message : String(error), info, { cause: error });
      }

      const plainTextToolPlaceholder = agentItem && toolCalls.size === 0 && isTextToolPlaceholder(content);
      if (plainTextToolPlaceholder) {
        this.discardTransientItem(threadId, turnId, collectedItems, agentItem?.id);
      } else if (agentItem) {
        const validation = validateThreadItemsForPersistence([agentItem]);
        if (!validation.ok) {
          this.discardTransientItem(threadId, turnId, collectedItems, agentItem.id);
          this.emit({
            type: 'model.output.rejected',
            threadId,
            turnId,
            message: validation.error.message,
            error: { message: validation.error.message, info: validation.error.info },
          });
          await this.appendRunMonitorEvent(turnId, {
            category: 'model',
            type: 'model.output.rejected',
            level: 'warning',
            message: validation.error.message,
            metadata: { info: validation.error.info },
          });
          throw validation.error;
        }
        this.emit({ type: 'item.completed', threadId, turnId, item: agentItem });
        await this.persistItems(threadId, [agentItem]);
      }

      if (!agentItem && toolCalls.size === 0) {
        throw new Error(this.i18n.t('runtime.no_response'));
      }

      return {
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls.size > 0 ? [...toolCalls.values()] : undefined,
        },
        usage,
      };
      });
    } catch (error) {
      await this.appendRunMonitorEvent(turnId, {
        category: 'model',
        type: 'model.failed',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await this.runtimeMiddleware.afterModel(runtimeContext, modelRequest, response);
    const session = this.runMonitorSessions.get(turnId);
    if (session && response.usage) {
      session.inputTokens += response.usage.inputTokens;
      session.cachedInputTokens += response.usage.cachedInputTokens;
      session.outputTokens += response.usage.outputTokens;
      session.reasoningOutputTokens += response.usage.reasoningOutputTokens;
    }
    await this.appendRunMonitorEvent(turnId, {
      category: 'model',
      type: 'model.completed',
      message: 'Model stream completed',
      metadata: response.usage ? { usage: response.usage } : {},
    });
    return response;
  }

  // ─── Tool Execution ───────────────────────────────────────────────────────
  private async executeToolCallBatch(
    threadId: ThreadId,
    turnId: TurnId,
    toolCalls: ToolCall[],
    collectedItems: ThreadItem[],
    runtimeContext: RuntimeTurnContext,
    signal: AbortSignal,
    visibleToolNames?: ReadonlySet<string>,
  ): Promise<ToolCallExecutionResult[]> {
    const results = new Array<ToolCallExecutionResult>(toolCalls.length);
    let index = 0;
    while (index < toolCalls.length) {
      if (signal.aborted) throw new Error('Turn cancelled');

      if (!this.supportsParallelToolCall(toolCalls[index], visibleToolNames)) {
        const toolCall = toolCalls[index];
        const result = await this.executeToolCall(
          threadId,
          turnId,
          toolCall,
          collectedItems,
          runtimeContext,
          visibleToolNames,
        );
        results[index] = { toolCall, ...result };
        index += 1;
        continue;
      }

      const start = index;
      index += 1;
      while (index < toolCalls.length && this.supportsParallelToolCall(toolCalls[index], visibleToolNames)) {
        index += 1;
      }
      const group = toolCalls.slice(start, index);
      // 中文注释：系统监控限流 — light 级别将并发批次减半
      // — Chinese: system monitor throttle — light level halves the parallel batch size
      const maxBatch = this.maxParallelBatchSize;
      if (maxBatch !== Number.POSITIVE_INFINITY && group.length > maxBatch) {
        // 分成更小的子批次依次执行
        // — Chinese: split into smaller sub-batches and execute sequentially
        for (let subStart = 0; subStart < group.length; subStart += maxBatch) {
          const subgroup = group.slice(subStart, subStart + maxBatch);
          const subResults = await this.runParallelGroup(
            threadId,
            turnId,
            subgroup,
            collectedItems,
            runtimeContext,
            visibleToolNames,
          );
          subResults.forEach((result, offset) => {
            results[start + subStart + offset] = result;
          });
        }
        continue;
      }
      if (group.length === 1) {
        const toolCall = group[0];
        const result = await this.executeToolCall(
          threadId,
          turnId,
          toolCall,
          collectedItems,
          runtimeContext,
          visibleToolNames,
        );
        results[start] = { toolCall, ...result };
        continue;
      }

      const groupResults = await this.runParallelGroup(
        threadId,
        turnId,
        group,
        collectedItems,
        runtimeContext,
        visibleToolNames,
      );
      groupResults.forEach((result, offset) => {
        results[start + offset] = result;
      });
    }
    return results;
  }

  /** 执行一组可并发的工具调用（含事件追踪）。 */
  /** Execute a group of parallel-safe tool calls (with event tracking). */
  private async runParallelGroup(
    threadId: ThreadId,
    turnId: TurnId,
    group: ToolCall[],
    collectedItems: ThreadItem[],
    runtimeContext: RuntimeTurnContext,
    visibleToolNames?: ReadonlySet<string>,
  ): Promise<ToolCallExecutionResult[]> {
    const toolNames = group.map((toolCall) => resolveToolName(this.tools, toolCall.function.name));
    await this.appendRunMonitorEvent(turnId, {
      category: 'tool',
      type: 'tool.batch.started',
      message: `Parallel tool batch started (${toolNames.join(', ')})`,
      metadata: { parallel: true, toolCount: group.length, toolNames },
    });
    try {
      const groupResults = await Promise.all(group.map(async (toolCall) => {
        const result = await this.executeToolCall(
          threadId,
          turnId,
          toolCall,
          collectedItems,
          runtimeContext,
          visibleToolNames,
        );
        return { toolCall, ...result };
      }));
      await this.appendRunMonitorEvent(turnId, {
        category: 'tool',
        type: 'tool.batch.completed',
        message: `Parallel tool batch completed (${toolNames.join(', ')})`,
        metadata: { parallel: true, toolCount: group.length, toolNames },
      });
      return groupResults;
    } catch (error) {
      await this.appendRunMonitorEvent(turnId, {
        category: 'tool',
        type: 'tool.batch.failed',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        metadata: { parallel: true, toolCount: group.length, toolNames },
      });
      throw error;
    }
  }

  private supportsParallelToolCall(
    toolCall: ToolCall,
    visibleToolNames?: ReadonlySet<string>,
  ): boolean {
    const toolName = resolveToolName(this.tools, toolCall.function.name);
    if (visibleToolNames && !visibleToolNames.has(toolName)) return false;
    if (isCollabTool(toolName)) return false;
    if (!this.isToolAllowedByRole(toolName)) return false;
    const toolDef = this.tools.get(toolName);
    if (toolDef?.supportsParallelToolCalls !== true
      || toolDef.requiredPolicy !== 'readonly'
      || toolDef.requiresApproval === true) {
      return false;
    }
    // 中文注释：系统监控限流 — moderate 及以上强制串行
    // — Chinese: system monitor throttle — moderate+ forces sequential execution
    const level = this.systemMonitorLevel;
    if (level === 'moderate' || level === 'severe') return false;
    return true;
  }

  /** 根据系统监控级别返回并发工具批次的最大大小。 */
  /** Max parallel batch size based on system monitor level. */
  private get maxParallelBatchSize(): number {
    const level = this.systemMonitorLevel;
    switch (level) {
      case 'severe':
      case 'moderate':
        return 1; // 全串行
      case 'light':
        return 2; // 并发数减半（限制为 2）
      case 'none':
      default:
        return Number.POSITIVE_INFINITY; // 不限制
    }
  }

  private async executeToolCall(
    threadId: ThreadId,
    turnId: TurnId,
    toolCall: ToolCall,
    collectedItems: ThreadItem[],
    runtimeContext: RuntimeTurnContext,
    visibleToolNames?: ReadonlySet<string>,
  ): Promise<{ output: string; disableWebSearch?: boolean; activateToolNames?: string[] }> {
    const requestedToolName = toolCall.function.name;
    const toolName = resolveToolName(this.tools, requestedToolName);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }

    const ctx: ToolContext = {
      workspaceRoot: this.config.workspaceRoot,
      threadId,
      turnId,
      approved: false,
      signal: this.stateManager.get(threadId).cancelController?.signal,
      webProvider: this.config.webProvider,
      // 中文注释：注入系统监控引用，工具内部可调用 get_system_status 查询主机状态
      // — Chinese: inject system monitor reference so tools can query host status
      systemMonitor: this._systemMonitor ?? undefined,
    };

    // Check sandbox policy
    // 检查沙箱策略
    const toolDef = this.tools.get(toolName);
    if (!toolDef) {
      const msg = this.i18n.t('runtime.unknown_tool', { tool: toolName });
      const errorItem: ThreadItem = {
        id: generateItemId(turnId, collectedItems.length),
        type: 'error',
        turnId,
        message: msg,
        timestamp: new Date().toISOString(),
      };
      collectedItems.push(errorItem);
      this.emitItem(threadId, turnId, errorItem);
      return { output: msg };
    }
    // 中文注释：系统监控限流 — severe 级别只允许 readonly 工具，阻止写操作
    // — Chinese: system monitor throttle — severe level only allows readonly tools, blocks writes
    if (this.systemMonitorLevel === 'severe' && toolDef.requiredPolicy !== 'readonly') {
      const blockedMsg = `[System Monitor] Host under severe pressure. Write/dangerous tools are temporarily blocked. Only readonly tools are allowed. Please wait for load to decrease.`;
      const response: RuntimeToolResponse = {
        status: 'failed',
        output: blockedMsg,
        error: { message: 'Tool blocked by system monitor (severe level).', code: 'SYSTEM_MONITOR_SEVERE_BLOCK' },
      };
      const runtimeToolRequest: RuntimeToolRequest = {
        toolCall,
        requestedToolName,
        toolName,
        args,
        toolDef,
        toolContext: ctx,
      };
      await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, response);
      const output = await this.recordMiddlewareToolResponse(
        threadId,
        turnId,
        toolName,
        args,
        collectedItems,
        response,
      );
      return { output };
    }
    if (!this.isToolAllowedByRole(toolName)) {
      const response: RuntimeToolResponse = {
        status: 'failed',
        output: `Tool ${toolName} is not allowed by active agent role ${this.config.activeAgentRoleProfile?.name}.`,
        error: { message: 'Tool blocked by active agent role.', code: 'TOOL_BLOCKED_BY_AGENT_ROLE' },
      };
      const runtimeToolRequest: RuntimeToolRequest = {
        toolCall,
        requestedToolName,
        toolName,
        args,
        toolDef,
        toolContext: ctx,
      };
      await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, response);
      const output = await this.recordMiddlewareToolResponse(
        threadId,
        turnId,
        toolName,
        args,
        collectedItems,
        response,
      );
      return { output };
    }

    const runtimeToolRequest: RuntimeToolRequest = {
      toolCall,
      requestedToolName,
      toolName,
      args,
      toolDef,
      toolContext: ctx,
    };
    await this.appendRunMonitorEvent(turnId, {
      category: 'middleware',
      type: 'middleware.beforeTool',
      message: `beforeTool middleware started for ${toolName}`,
      toolName,
    });
    const middlewareShortCircuit = await this.runtimeMiddleware.beforeTool(runtimeContext, runtimeToolRequest);
    if (middlewareShortCircuit) {
      await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, middlewareShortCircuit);
      const output = await this.recordMiddlewareToolResponse(
        threadId,
        turnId,
        toolName,
        args,
        collectedItems,
        middlewareShortCircuit,
      );
      await this.appendRunMonitorEvent(turnId, {
        category: 'tool',
        type: middlewareShortCircuit.status === 'failed' ? 'tool.failed' : 'tool.completed',
        level: middlewareShortCircuit.status === 'failed' ? 'warning' : 'info',
        message: middlewareShortCircuit.output,
        toolName,
        metadata: { status: middlewareShortCircuit.status, shortCircuited: true },
      });
      return { output, disableWebSearch: middlewareShortCircuit.disableWebSearch };
    }

    if (visibleToolNames && !visibleToolNames.has(toolName)) {
      const response: RuntimeToolResponse = {
        status: 'failed',
        output: this.config.locale === 'zh'
          ? `工具 "${toolName}" 尚未绑定。请先调用 ${TOOL_SEARCH_TOOL_NAME} 搜索并绑定需要的工具 schema，然后再调用该工具。`
          : `Tool "${toolName}" is not bound yet. Call ${TOOL_SEARCH_TOOL_NAME} first to search and bind the needed tool schema, then call this tool again.`,
        error: {
          code: 'TOOL_NOT_BOUND',
          message: `Tool "${toolName}" is not visible in the current delayed binding set`,
        },
        data: {
          requestedToolName,
          toolName,
          visibleTools: [...visibleToolNames].sort(),
        },
      };
      await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, response);
      const output = await this.recordMiddlewareToolResponse(
        threadId,
        turnId,
        toolName,
        args,
        collectedItems,
        response,
      );
      await this.appendRunMonitorEvent(turnId, {
        category: 'tool',
        type: 'tool.failed',
        level: 'warning',
        message: response.output,
        toolName,
        metadata: { status: response.status, code: response.error?.code },
      });
      return { output };
    }

    if (isCollabTool(toolName)) {
      const itemCountBeforeWrap = collectedItems.length;
      const response = await this.runtimeMiddleware.wrapTool(runtimeContext, runtimeToolRequest, async () => {
        const result = await this.executeCollabToolCall(threadId, turnId, toolName, args, collectedItems);
        return { output: result.output, status: 'completed' };
      });
      await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, response);
      if (collectedItems.length === itemCountBeforeWrap) {
        const output = await this.recordMiddlewareToolResponse(
          threadId,
          turnId,
          toolName,
          args,
          collectedItems,
          response,
        );
        return { output, disableWebSearch: response.disableWebSearch };
      }
      return { output: response.output, disableWebSearch: response.disableWebSearch };
    }

    // Pre-tool hook
    // 工具前钩子
    await this.config.hooks.trigger('pre_tool_use', {
      threadId,
      turnId,
      toolName: requestedToolName === toolName ? toolName : `${requestedToolName} -> ${toolName}`,
      toolArgs: args,
      workspaceRoot: this.config.workspaceRoot,
    });

    // Start item
    // 启动条目
    const itemId = generateItemId(turnId, collectedItems.length);
    const mcpIdentity = parseMcpNamespacedToolName(toolName);
    const toolItem: ThreadItem = {
      id: itemId,
      type: mcpIdentity ? 'mcp_tool_call' : 'tool_call',
      turnId,
      ...(mcpIdentity
        ? {
            server: mcpIdentity.serverId,
            tool: mcpIdentity.toolName,
            arguments: args,
          }
        : {
            toolName,
            arguments: args,
          }),
      status: 'in_progress',
      timestamp: new Date().toISOString(),
    } as ThreadItem;
    collectedItems.push(toolItem);
    this.emit({ type: 'item.started', threadId, turnId, item: toolItem });
    await this.appendRunMonitorEvent(turnId, {
      category: 'tool',
      type: 'tool.started',
      message: `Tool ${toolName} started`,
      toolName,
      metadata: { args: redactMonitorArgs(args) },
    });

    const prePatchSnapshots = toolName === 'apply_patch'
      ? await capturePrePatchSnapshots(args, this.config.workspaceRoot)
      : toolName === 'write_file'
        ? await captureWriteFilePathSnapshot(args, this.config.workspaceRoot)
        : new Map<string, string | null>();

    // Execute
    // 执行
    const result = await this.runtimeMiddleware.wrapTool(
      runtimeContext,
      runtimeToolRequest,
      (request) => this.tools.execute(request.toolName, request.args, request.toolContext),
    );

    // Update item
    // 更新条目
    (toolItem as ThreadItem & { status: typeof result.status }).status = result.status;
    if (result.error) {
      (toolItem as ThreadItem & { error?: { message: string } }).error = result.error;
    }
    if (mcpIdentity) {
      const data = result.data && typeof result.data === 'object'
        ? result.data as { content?: unknown[]; structuredContent?: unknown }
        : {};
      (toolItem as ThreadItem & { result?: unknown }).result = {
        content: Array.isArray(data.content) ? data.content : [result.output],
        structuredContent: data.structuredContent ?? null,
      };
    } else {
      (toolItem as ThreadItem & { result?: unknown }).result = result.data ?? result.output;
    }
    this.emit({ type: 'item.completed', threadId, turnId, item: toolItem });

    // Persist
    // 持久化
    await this.persistItems(threadId, [toolItem]);

    if ((toolName === 'apply_patch' || toolName === 'write_file') && result.status === 'completed') {
      const changes = toolName === 'apply_patch'
        ? normalizeFileChanges(result.data)
        : buildWriteFileChanges(args, prePatchSnapshots);
      if (changes.length > 0) {
        const fileItem: ThreadItem = {
          id: generateItemId(turnId, collectedItems.length),
          type: 'file_change',
          turnId,
          changes,
          hunks: changes.flatMap((change) => change.hunks ?? []),
          summary: changes.map((change) => change.summary ?? `${change.kind} ${change.path}`).join('\n'),
          status: 'completed',
          timestamp: new Date().toISOString(),
        };
        collectedItems.push(fileItem);
        this.emit({ type: 'item.started', threadId, turnId, item: fileItem });
        this.emit({ type: 'item.completed', threadId, turnId, item: fileItem });
        await this.persistItems(threadId, [fileItem]);
        const projectCheckpoint = await createProjectCheckpointItem({
          threadId,
          turnId,
          itemId: generateItemId(turnId, collectedItems.length),
          turnCount: await activeTurnCount(this.config.store, threadId),
          workspaceRoot: this.config.workspaceRoot,
          changes,
          beforeSnapshots: prePatchSnapshots,
        });
        if (projectCheckpoint.files.length > 0) {
          collectedItems.push(projectCheckpoint);
          this.emit({ type: 'item.started', threadId, turnId, item: projectCheckpoint });
          this.emit({ type: 'item.completed', threadId, turnId, item: projectCheckpoint });
          await this.persistItems(threadId, [projectCheckpoint]);
        }
        this.emit({
          type: 'turn.diff.updated',
          threadId,
          turnId,
          diff: changes.map((change) => `${change.kind} ${change.path} +${change.addedLines ?? 0}/-${change.removedLines ?? 0}`).join('\n'),
        });
      }
    }

    // Post-tool hook
    // 工具后钩子
    await this.config.hooks.trigger('post_tool_use', {
      threadId,
      turnId,
      toolName,
      toolArgs: args,
      toolResult: result,
      workspaceRoot: this.config.workspaceRoot,
    });

    await this.runtimeMiddleware.afterTool(runtimeContext, runtimeToolRequest, result);
    await this.appendRunMonitorEvent(turnId, {
      category: 'tool',
      type: result.status === 'failed' ? 'tool.failed' : 'tool.completed',
      level: result.status === 'failed' ? 'error' : 'info',
      message: result.status === 'failed' ? (result.error?.message ?? result.output) : `Tool ${toolName} completed`,
      toolName,
      metadata: { status: result.status },
    });

    return {
      output: result.output,
      disableWebSearch: result.disableWebSearch,
      activateToolNames: toolName === TOOL_SEARCH_TOOL_NAME
        ? toolNamesFromSearchResult(result.data)
        : undefined,
    };
  }

  private async recordMiddlewareToolResponse(
    threadId: ThreadId,
    turnId: TurnId,
    toolName: string,
    args: Record<string, unknown>,
    collectedItems: ThreadItem[],
    response: RuntimeToolResponse,
  ): Promise<string> {
    if (isCollabTool(toolName)) {
      const item: CollabToolCallItem = {
        id: generateItemId(turnId, collectedItems.length),
        type: 'collab_tool_call',
        turnId,
        tool: toolName,
        status: response.status,
        senderThreadId: threadId,
        receiverThreadId: stringArg(args, 'threadId') ?? stringArg(args, 'agentId'),
        prompt: stringArg(args, 'prompt'),
        error: response.error,
        result: response.data ?? response.output,
        timestamp: new Date().toISOString(),
      };
      collectedItems.push(item);
      this.emit({ type: 'item.started', threadId, turnId, item });
      this.emit({ type: 'item.completed', threadId, turnId, item });
      await this.persistItems(threadId, [item]);
      return response.output;
    }

    const mcpIdentity = parseMcpNamespacedToolName(toolName);
    const toolItem: ThreadItem = {
      id: generateItemId(turnId, collectedItems.length),
      type: mcpIdentity ? 'mcp_tool_call' : 'tool_call',
      turnId,
      ...(mcpIdentity
        ? {
            server: mcpIdentity.serverId,
            tool: mcpIdentity.toolName,
            arguments: args,
          }
        : {
            toolName,
            arguments: args,
          }),
      status: response.status,
      error: response.error,
      result: response.data ?? response.output,
      timestamp: new Date().toISOString(),
    } as ThreadItem;
    collectedItems.push(toolItem);
    this.emit({ type: 'item.started', threadId, turnId, item: toolItem });
    this.emit({ type: 'item.completed', threadId, turnId, item: toolItem });
    await this.persistItems(threadId, [toolItem]);
    return response.output;
  }

  private async executeCollabToolCall(
    threadId: ThreadId,
    turnId: TurnId,
    toolName: CollabToolName,
    args: Record<string, unknown>,
    collectedItems: ThreadItem[],
  ): Promise<{ output: string }> {
    const item: CollabToolCallItem = {
      id: generateItemId(turnId, collectedItems.length),
      type: 'collab_tool_call',
      turnId,
      tool: toolName,
      status: 'in_progress',
      senderThreadId: threadId,
      receiverThreadId: stringArg(args, 'threadId') ?? stringArg(args, 'agentId'),
      prompt: stringArg(args, 'prompt'),
      timestamp: new Date().toISOString(),
    };
    collectedItems.push(item);
    this.emit({ type: 'item.started', threadId, turnId, item });

    try {
      const result = await this.runCollabTool(threadId, toolName, args, item);
      item.status = 'completed';
      item.result = result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
      item.status = 'failed';
      item.error = code ? { message, code } : { message };
      item.result = code ? { error: message, code } : { error: message };
    }

    this.emit({ type: 'item.completed', threadId, turnId, item });
    await this.persistItems(threadId, [item]);
    return { output: formatCollabToolOutput(item, this.config.locale) };
  }

  private async runCollabTool(
    parentThreadId: ThreadId,
    toolName: CollabToolName,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    switch (toolName) {
      case 'spawn_agent':
        return this.spawnSubagent(parentThreadId, args, item);
      case 'send_input':
        return this.sendInputToSubagent(parentThreadId, args, item);
      case 'send_message':
        return this.sendInterAgentMessage(parentThreadId, args, item, false);
      case 'followup_task':
        return this.sendInterAgentMessage(parentThreadId, args, item, true);
      case 'resume_agent':
        return this.resumeSubagent(parentThreadId, args, item);
      case 'wait':
      case 'wait_agent':
        return this.waitForSubagents(parentThreadId, args, item);
      case 'list_agents':
        return this.listSubagents(parentThreadId, args, item);
      case 'close_agent':
        return this.closeSubagent(parentThreadId, args, item);
      case 'spawn_remote_agent':
        return this.spawnRemoteAgent(parentThreadId, args, item);
      default:
        throw new Error(`Unknown collaboration tool: ${toolName}`);
    }
  }

  /**
   * 委派任务到外部 A2A Agent（跨框架协作）。
   * 通过 @a2a-js/sdk 的 ClientFactory 与远程 Agent 通信。
   *
   * 优先使用流式接口（sendMessageStream），将远程 Agent 的中间状态
   * 实时以 item.updated 事件回传给父线程；若远程 Agent 不支持流式
   * 或建立流失败，则回退到阻塞式 sendMessage。
   */
  // — Chinese: delegate task to remote A2A agent. Prefers streaming with real-time
  // status feedback; falls back to blocking mode if streaming unavailable.
  private async spawnRemoteAgent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const agentUrl = stringArg(args, 'agentUrl');
    if (!agentUrl) throw new Error('spawn_remote_agent requires agentUrl');
    const task = stringArg(args, 'task');
    if (!task) throw new Error('spawn_remote_agent requires task');
    const context = stringArg(args, 'context');

    // 把任务描述记录到 collab tool call item 上，便于前端展示与回放
    // — Chinese: record task description on collab tool call item for UI display
    item.prompt = task;
    item.agentStatus = 'running';
    item.receiverThreadId = agentUrl;

    const { RemoteAgentClient } = await import('./a2aClient/remoteAgentClient.js');
    const remoteClient = new RemoteAgentClient();

    let result;
    try {
      // 流式模式：实时消费远程事件并转发 item.updated 到父线程
      // — Chinese: streaming mode: consume remote events, forward as item.updated
      result = await this.consumeRemoteAgentStream(remoteClient, agentUrl, task, context, parentThreadId, item);
    } catch (streamError) {
      // 流式建立失败（远程 Agent 不支持 streaming 或连接异常）→ 回退到阻塞模式
      // — Chinese: streaming setup failed (unsupported or connection error) → fall back to blocking
      result = await remoteClient.sendTask(agentUrl, task, context);
    }

    // 把远程 Agent 的 URL 与最终状态记到 item 上
    // — Chinese: record remote agent URL and final status on item
    item.agentStatus = result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'running';

    let output = `Remote agent response (${agentUrl}):\n${result.text || '(no text reply)'}`;
    if (result.artifacts.length > 0) {
      output += '\n\nArtifacts:';
      for (const a of result.artifacts) {
        output += `\n${a.name || 'unnamed'}: ${a.text || '(empty)'}`;
      }
    }
    if (result.error) {
      output += `\n\nError: ${result.error}`;
    }

    return {
      agentUrl,
      taskId: result.taskId,
      status: result.status,
      text: result.text,
      artifacts: result.artifacts,
      error: result.error,
      output,
    };
  }

  /**
   * 消费远程 Agent 的流式事件，实时把状态变化以 item.updated 事件转发到父线程。
   * 同时累积状态轨迹（remoteStatusTrail）和中间文本流（remoteTextStream）到 item 上，
   * 供前端展示 working → input-required → completed 的过程与流式文本。
   * 返回与 sendTask 相同结构的聚合结果。
   */
  // — Chinese: consume remote agent stream events, forward status as item.updated.
  // Accumulates status trail and text stream on item for UI display.
  private async consumeRemoteAgentStream(
    remoteClient: RemoteAgentClient,
    agentUrl: string,
    task: string,
    context: string | undefined,
    parentThreadId: ThreadId,
    item: CollabToolCallItem,
  ): Promise<{
    taskId?: string;
    status: 'completed' | 'failed' | 'working';
    text: string;
    artifacts: Array<{ name?: string; text: string }>;
    error?: string;
  }> {
    const turnId = item.turnId;
    const artifacts: Array<{ name?: string; text: string }> = [];
    let text = '';
    let taskId: string | undefined;
    let finalStatus: 'completed' | 'failed' | 'working' = 'working';

    // 初始化轨迹和文本流容器（仅在首次调用时创建）
    // — Chinese: init trail and text stream containers (only on first call)
    if (!item.remoteStatusTrail) item.remoteStatusTrail = [];
    if (!item.remoteTextStream) item.remoteTextStream = [];

    for await (const event of remoteClient.sendTaskStream(agentUrl, task, context)) {
      switch (event.type) {
        case 'status': {
          const statusEvent = event.data as { taskId?: string; status?: { state?: string; timestamp?: string; message?: { parts?: Array<{ kind: string; text?: string }> } } } | undefined;
          if (statusEvent?.taskId) taskId = statusEvent.taskId;
          const state = statusEvent?.status?.state ?? 'unknown';
          const eventTimestamp = statusEvent?.status?.timestamp ?? new Date().toISOString();

          // 更新 item 状态
          // — Chinese: update item agentStatus based on state
          if (state === 'working') {
            item.agentStatus = 'running';
          } else if (state === 'completed') {
            item.agentStatus = 'completed';
            finalStatus = 'completed';
          } else if (state === 'failed' || state === 'canceled' || state === 'rejected') {
            item.agentStatus = 'failed';
            finalStatus = 'failed';
          } else if (state === 'input-required') {
            item.agentStatus = 'running';
          }

          // 从 status.message 中提取中间文本（如果有）
          // — Chinese: extract intermediate text from status.message if present
          let intermediateText: string | undefined;
          const messageParts = statusEvent?.status?.message?.parts;
          if (messageParts) {
            intermediateText = messageParts
              .filter((p) => p.kind === 'text')
              .map((p) => p.text ?? '')
              .join('');
          }

          // 追加到状态轨迹
          // — Chinese: append to status trail
          item.remoteStatusTrail.push({
            timestamp: eventTimestamp,
            state,
            text: intermediateText,
          });

          // 若有中间文本，同时追加到文本流
          // — Chinese: if intermediate text present, also append to text stream
          if (intermediateText) {
            item.remoteTextStream.push({
              timestamp: eventTimestamp,
              text: intermediateText,
            });
          }

          this.emit({ type: 'item.updated', threadId: parentThreadId, turnId, item });
          break;
        }
        case 'message': {
          // 远程 Agent 的最终消息 → 提取文本
          // — Chinese: remote agent's final message → extract text
          const message = event.data as { parts?: Array<{ kind: string; text?: string }> } | undefined;
          if (message?.parts) {
            const messageText = message.parts
              .filter((p) => p.kind === 'text')
              .map((p) => p.text ?? '')
              .join('\n');
            if (messageText) text = text ? `${text}\n${messageText}` : messageText;
          }
          break;
        }
        case 'artifact': {
          // 远程 Agent 的产物 → 收集
          // — Chinese: remote agent artifact → collect
          const artifactEvent = event.data as { artifact?: { name?: string; parts?: Array<{ kind: string; text?: string }> } } | undefined;
          const artifact = artifactEvent?.artifact;
          if (artifact) {
            const artifactText = (artifact.parts ?? [])
              .filter((p) => p.kind === 'text')
              .map((p) => p.text ?? '')
              .join('\n');
            artifacts.push({ name: artifact.name, text: artifactText });
          }
          break;
        }
        case 'task': {
          // 完整 Task 对象 → 提取 taskId
          // — Chinese: full Task object → extract taskId
          const taskObj = event.data as { id?: string } | undefined;
          if (taskObj?.id) taskId = taskObj.id;
          break;
        }
        case 'error': {
          finalStatus = 'failed';
          item.agentStatus = 'failed';
          // 错误也记入状态轨迹，便于前端展示失败时点
          // — Chinese: record error in status trail for UI to show failure point
          const errTimestamp = new Date().toISOString();
          item.remoteStatusTrail.push({
            timestamp: errTimestamp,
            state: 'failed',
            text: event.error,
          });
          this.emit({ type: 'item.updated', threadId: parentThreadId, turnId, item });
          return {
            taskId,
            status: 'failed',
            text,
            artifacts,
            error: event.error ?? 'Remote agent stream error',
          };
        }
        case 'done': {
          // 流结束 — 如果尚未收到最终状态，默认 completed
          // — Chinese: stream done — default to completed if no final status received
          if (finalStatus === 'working') finalStatus = 'completed';
          return { taskId, status: finalStatus, text, artifacts };
        }
        default:
          break;
      }
    }

    // 流自然结束但未收到 done 事件 — 用已收集的数据返回
    // — Chinese: stream ended naturally without done event — return collected data
    if (finalStatus === 'working') finalStatus = 'completed';
    return { taskId, status: finalStatus, text, artifacts };
  }

  private async spawnSubagent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const prompt = stringArg(args, 'prompt')?.trim();
    if (!prompt) throw new Error('spawn_agent requires prompt');
    // 中文注释：系统监控限流 — 主机压力大时阻止新增子 agent
    // — Chinese: system monitor throttle — block new subagent spawns under host pressure
    const level = this.systemMonitorLevel;
    if (level !== 'none') {
      const status = this._systemMonitor?.getStatus();
      const reason = status?.recommendation ?? 'Host under pressure';
      const error = new Error(
        `Subagent delegation blocked by system monitor (level: ${level}). ${reason}`,
      );
      (error as Error & { code?: string }).code = 'SYSTEM_MONITOR_THROTTLED';
      throw error;
    }
    const openEdges = await this.config.store.listThreadSpawnDescendants(parentThreadId, 'open');
    const parentMaxSubagents = this.config.activeAgentRoleProfile?.maxSubagents ?? this.config.maxSubagents;
    if (openEdges.length >= parentMaxSubagents) {
      throw new Error(`Maximum open subagents reached: ${parentMaxSubagents}`);
    }

    const parent = await this.config.store.getThread(parentThreadId);
    if (!parent) throw new Error(`Thread ${parentThreadId} not found`);
    const nextDepth = await this.subagentDepth(parentThreadId) + 1;
    const parentMaxSubagentDepth = this.config.activeAgentRoleProfile?.maxSubagentDepth ?? this.config.maxSubagentDepth;
    if (nextDepth > parentMaxSubagentDepth) {
      const error = new Error(`Maximum subagent depth reached: ${parentMaxSubagentDepth}`);
      (error as Error & { code?: string }).code = 'SUBAGENT_DEPTH_LIMIT_REACHED';
      throw error;
    }
    const now = new Date().toISOString();
    const childThreadId = generateId();
    const roleName = stringArg(args, 'agentRole') ?? stringArg(args, 'agent_type') ?? stringArg(args, 'role') ?? DEFAULT_AGENT_ROLE_NAME;
    const roleProfile = resolveAgentRoleProfile(this.config.agentRoles, roleName);
    const agentRole = roleProfile.name;
    const agentNickname = stringArg(args, 'agentNickname') ?? stringArg(args, 'nickname') ?? agentRole;
    const spawnOverrides = {
      model: stringArg(args, 'model')?.trim() || undefined,
      reasoningEffort: stringArg(args, 'reasoningEffort') ?? stringArg(args, 'reasoning_effort') ?? undefined,
      serviceTier: stringArg(args, 'serviceTier') ?? stringArg(args, 'service_tier') ?? roleProfile.serviceTier ?? undefined,
      agentRole,
    };
    const child: ThreadMeta = {
      threadId: childThreadId,
      tenantId: this.config.tenantId,
      title: titleFromText(prompt),
      workspaceRoot: parent.workspaceRoot || this.config.workspaceRoot,
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: parent.ephemeral,
      tags: {
        ...parent.tags,
        agentDepth: String(nextDepth),
        agentRoleProfile: roleProfile.name,
        ...(spawnOverrides.model ? { agentRequestedModel: spawnOverrides.model, agentModelInherited: 'true' } : {}),
        ...(spawnOverrides.reasoningEffort ? { agentReasoningEffort: spawnOverrides.reasoningEffort } : {}),
        ...(spawnOverrides.serviceTier ? { agentServiceTier: spawnOverrides.serviceTier } : {}),
      },
      parentThreadId,
      agentNickname,
      agentRole,
    };
    await this.config.store.createThread(child);
    await this.config.store.upsertThreadSpawnEdge({
      parentThreadId,
      tenantId: this.config.tenantId,
      childThreadId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    });

    item.newThreadId = childThreadId;
    item.receiverThreadId = childThreadId;
    item.agentStatus = 'running';

    const envelope = this.buildTransferEnvelope({
      parentThreadId,
      childThreadId,
      prompt,
      agentRole,
      agentNickname,
    });
    const childAgent = this.createChildAgent(agentRole, agentNickname, envelope, spawnOverrides, roleProfile);
    this.forwardChildEvents({
      childAgent,
      parentThreadId,
      childThreadId,
      agentNickname,
      agentRole,
    });
    const run = childAgent.runTurn(childThreadId, { type: 'text', text: prompt });
    this.subagentRuns.set(childThreadId, run);
    void run.catch(() => undefined);

    return {
      childThreadId,
      status: 'running',
      agentRole,
      agentNickname,
      envelope,
    };
  }

  private async sendInputToSubagent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const childThreadId = requiredThreadArg(args);
    const prompt = stringArg(args, 'prompt')?.trim() ?? stringArg(args, 'input')?.trim();
    if (!prompt) throw new Error('send_input requires prompt');
    await this.ensureChildThread(parentThreadId, childThreadId);
    if (this.stateManager.isRunning(childThreadId)) {
      if (args.interrupt === true) {
        await this.interruptSubagentTurn(childThreadId);
      } else {
        throw new Error(`Subagent ${childThreadId} is already running`);
      }
    }
    item.receiverThreadId = childThreadId;
    item.prompt = prompt;
    item.agentStatus = 'running';
    const child = await this.config.store.getThread(childThreadId);
    const agentRole = child?.agentRole ?? 'subagent';
    const agentNickname = child?.agentNickname ?? 'subagent';
    const envelope = this.buildTransferEnvelope({
      parentThreadId,
      childThreadId,
      prompt,
      agentRole,
      agentNickname,
    });
    const childAgent = this.createChildAgent(agentRole, agentNickname, envelope);
    this.forwardChildEvents({
      childAgent,
      parentThreadId,
      childThreadId,
      agentNickname,
      agentRole,
    });
    const run = childAgent.runTurn(childThreadId, { type: 'text', text: prompt });
    this.subagentRuns.set(childThreadId, run);
    void run.catch(() => undefined);
    await this.waitForSubagentPromptPersisted(childThreadId, prompt);
    return { childThreadId, status: 'running', envelope };
  }

  private async sendInterAgentMessage(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
    triggerTurn: boolean,
  ): Promise<unknown> {
    const childThreadId = stringArg(args, 'target') ?? stringArg(args, 'threadId') ?? stringArg(args, 'agentId');
    if (!childThreadId) throw new Error(`${item.tool} requires target`);
    const message = stringArg(args, 'message')?.trim() ?? stringArg(args, 'prompt')?.trim();
    if (!message) throw new Error(`${item.tool} requires message`);
    const child = await this.ensureChildThread(parentThreadId, childThreadId);
    await this.appendAgentMailboxMessage(child, {
      senderThreadId: parentThreadId,
      receiverThreadId: childThreadId,
      content: message,
      triggerTurn,
      createdAt: new Date().toISOString(),
    });

    item.receiverThreadId = childThreadId;
    item.prompt = message;
    item.agentStatus = triggerTurn ? 'running' : 'open';

    if (!triggerTurn) {
      return { childThreadId, status: 'queued', triggerTurn: false };
    }
    if (this.stateManager.isRunning(childThreadId)) {
      return { childThreadId, status: 'queued_running', triggerTurn: true };
    }

    const agentRole = child.agentRole ?? 'subagent';
    const agentNickname = child.agentNickname ?? 'subagent';
    const envelope = this.buildTransferEnvelope({
      parentThreadId,
      childThreadId,
      prompt: message,
      agentRole,
      agentNickname,
    });
    const childAgent = this.createChildAgent(agentRole, agentNickname, envelope);
    this.forwardChildEvents({
      childAgent,
      parentThreadId,
      childThreadId,
      agentNickname,
      agentRole,
    });
    const run = childAgent.runTurn(childThreadId, { type: 'text', text: message });
    this.subagentRuns.set(childThreadId, run);
    void run.catch(() => undefined);
    await this.waitForSubagentPromptPersisted(childThreadId, message);
    return { childThreadId, status: 'running', triggerTurn: true, envelope };
  }

  private async listSubagents(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const pathPrefix = stringArg(args, 'path_prefix') ?? stringArg(args, 'pathPrefix');
    const edges = await this.config.store.listThreadSpawnDescendants(parentThreadId);
    const agents = [];
    for (const edge of edges) {
      const child = await this.config.store.getThread(edge.childThreadId);
      if (!child) continue;
      const taskName = child.agentNickname ?? child.agentRole ?? child.threadId;
      if (pathPrefix && !child.threadId.startsWith(pathPrefix) && !taskName.startsWith(pathPrefix)) continue;
      const runtimeState = await this.getRuntimeState(child.threadId);
      const latestTurn = (await this.config.store.getTurns(child.threadId)).at(-1);
      agents.push({
        threadId: child.threadId,
        agentId: child.threadId,
        taskName,
        agentRole: child.agentRole ?? null,
        agentNickname: child.agentNickname ?? null,
        edgeStatus: edge.status,
        status: runtimeState.status === 'idle' ? (latestTurn?.status ?? edge.status) : runtimeState.status,
        parentThreadId: edge.parentThreadId,
      });
    }
    item.agentStatus = agents.some((agent) => agent.status === 'running') ? 'running' : 'completed';
    return { agents };
  }

  private forwardChildEvents(options: {
    childAgent: AgentLoop;
    parentThreadId: ThreadId;
    childThreadId: ThreadId;
    agentNickname: string | null | undefined;
    agentRole: string | null | undefined;
  }): void {
    options.childAgent.onEvent((event) => {
      this.emit(event);
      if (!('threadId' in event) || event.threadId !== options.childThreadId) return;
      this.emit({
        type: 'child_agent.event',
        threadId: options.parentThreadId,
        childThreadId: options.childThreadId,
        agentNickname: options.agentNickname ?? null,
        agentRole: options.agentRole ?? null,
        event: event as unknown as Record<string, unknown>,
      });
    });
  }

  private async resumeSubagent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const childThreadId = requiredThreadArg(args);
    const child = await this.ensureChildThread(parentThreadId, childThreadId);
    item.receiverThreadId = childThreadId;
    const runtimeState = await this.getRuntimeState(childThreadId);
    if (runtimeState.checkpoint) {
      this.stateManager.setCheckpoint(childThreadId, runtimeState.checkpoint);
    }
    const agentStatus = runtimeState.resumable
      ? 'running'
      : runtimeState.status === 'idle'
        ? 'open'
        : runtimeState.status;
    item.agentStatus = agentStatus === 'stale' ? 'interrupted' : agentStatus;
    return {
      childThreadId,
      status: item.agentStatus,
      resumable: runtimeState.resumable,
      runtimeState,
      agentRole: child.agentRole,
      agentNickname: child.agentNickname,
    };
  }

  private async waitForSubagents(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const requested = stringArg(args, 'threadId') ?? stringArg(args, 'agentId');
    const childThreadIds = requested
      ? [requested]
      : (await this.config.store.listThreadSpawnChildren(parentThreadId, 'open')).map((edge) => edge.childThreadId);
    const children: Array<{
      threadId: ThreadId;
      status: CollabToolCallItem['agentStatus'];
      latestResponse: string;
    }> = [];
    for (const childThreadId of childThreadIds) {
      await this.ensureChildThread(parentThreadId, childThreadId);
      const run = this.subagentRuns.get(childThreadId);
      if (run) {
        try {
          await run;
        } catch {
          // The child's own turn records the failure; wait reports the status below.
          // 子 agent 自己的回合会记录失败；等待会在下面报告状态。
        }
      }
      const turns = await this.config.store.getTurns(childThreadId);
      const latestTurn = turns.at(-1);
      const status: CollabToolCallItem['agentStatus'] = latestTurn?.status ?? 'completed';
      const items = await this.config.store.getItems(childThreadId);
      const latestResponse = [...items].reverse().find((candidate) => candidate.type === 'agent_message')?.text ?? '';
      children.push({ threadId: childThreadId, status, latestResponse });
    }
    if (children.length === 1) {
      item.receiverThreadId = children[0].threadId;
      item.agentStatus = children[0].status;
    }
    return { children };
  }

  private async closeSubagent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const childThreadId = requiredThreadArg(args);
    await this.ensureChildThread(parentThreadId, childThreadId);
    if (this.stateManager.isRunning(childThreadId)) {
      await this.interruptSubagentTurn(childThreadId);
    } else {
      const runtimeState = await this.getRuntimeState(childThreadId);
      if (runtimeState.resumable) {
        await this.interruptSubagentTurn(childThreadId);
      }
    }
    await this.config.store.setThreadSpawnEdgeStatus(parentThreadId, childThreadId, 'closed');
    item.receiverThreadId = childThreadId;
    item.agentStatus = 'closed';
    return { childThreadId, status: 'closed' };
  }

  private async interruptSubagentTurn(childThreadId: ThreadId): Promise<void> {
    const state = this.stateManager.get(childThreadId);
    const activeTurnId = state.activeTurnId;
    if (activeTurnId && state.status === 'running') {
      this.interrupt(childThreadId);
    }

    const checkpoint = state.lastCheckpoint ?? await this.config.store.getLastCheckpoint(childThreadId);
    const turnId = activeTurnId ?? (checkpoint?.status === 'running' ? checkpoint.turnId : null);
    if (!turnId) return;

    const turns = await this.config.store.getTurns(childThreadId);
    const turn = turns.find((candidate) => candidate.turnId === turnId);
    const timestamp = new Date().toISOString();
    if (turn && turn.status === 'running') {
      turn.status = 'interrupted';
      turn.completedAt = timestamp;
      await this.config.store.saveTurn(turn);
    }

    const itemIndex = checkpoint?.itemIndex ?? (await this.config.store.getItems(childThreadId)).length;
    const interruptedCheckpoint: Checkpoint = {
      threadId: childThreadId,
      turnId,
      itemIndex,
      timestamp,
      generation: state.generation,
      status: 'interrupted',
    };
    await this.writeCheckpoint(childThreadId, interruptedCheckpoint);
    this.stateManager.completeInterruptedTurn(childThreadId, turnId);
  }

  private async waitForSubagentPromptPersisted(childThreadId: ThreadId, prompt: string): Promise<void> {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const items = await this.config.store.getItems(childThreadId);
      if (items.some((item) => item.type === 'user_message' && item.text === prompt)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Subagent ${childThreadId} did not persist delegated input`);
  }

  private async ensureChildThread(parentThreadId: ThreadId, childThreadId: ThreadId): Promise<ThreadMeta> {
    const child = await this.config.store.getThread(childThreadId);
    if (!child) throw new Error(`Subagent ${childThreadId} not found`);
    const edges = await this.config.store.listThreadSpawnDescendants(parentThreadId);
    if (!edges.some((edge) => edge.childThreadId === childThreadId)) {
      throw new Error(`Subagent ${childThreadId} does not belong to thread ${parentThreadId}`);
    }
    return child;
  }

  private async appendAgentMailboxMessage(
    child: ThreadMeta,
    message: {
      senderThreadId: ThreadId;
      receiverThreadId: ThreadId;
      content: string;
      triggerTurn: boolean;
      createdAt: string;
    },
  ): Promise<void> {
    const mailbox = parseAgentMailbox(child.tags.agentMailbox);
    mailbox.push(message);
    await this.config.store.updateThreadMetadata(child.threadId, {
      tags: { ...child.tags, agentMailbox: JSON.stringify(mailbox) },
    });
  }

  private async subagentDepth(threadId: ThreadId): Promise<number> {
    let depth = 0;
    let current = await this.config.store.getThread(threadId);
    const seen = new Set<ThreadId>();
    while (current?.parentThreadId && !seen.has(current.threadId)) {
      seen.add(current.threadId);
      depth += 1;
      current = await this.config.store.getThread(current.parentThreadId);
    }
    return depth;
  }

  private buildTransferEnvelope({
    agentNickname,
    agentRole,
    childThreadId,
    parentThreadId,
    prompt,
  }: {
    agentNickname: string;
    agentRole: string;
    childThreadId: ThreadId;
    parentThreadId: ThreadId;
    prompt: string;
  }): AgentTransferEnvelope {
    return {
      schemaVersion: 1,
      senderThreadId: parentThreadId,
      receiverThreadId: childThreadId,
      role: agentRole,
      nickname: agentNickname,
      task: prompt,
      locale: this.config.locale,
      webSearchMode: this.config.webSearchMode,
      permissions: {
        level: this.effectiveLevel,
        networkAllowed: this.effectiveNetwork,
        presetId: this.preset?.id,
      },
      constraints: [
        {
          layer: 'project_agents_md',
          text: 'Follow the active AGENTS.md/project rules inherited from the parent thread.',
        },
        {
          layer: 'thread_config',
          text: `Use inherited model, workspace, locale, web_search mode, Skills, MCP, and permission preset.`,
        },
        {
          layer: 'parent_delegation',
          text: prompt,
        },
        {
          layer: 'skills_mcp_web_search',
          text: `web_search=${this.config.webSearchMode}; active skills and MCP servers are inherited from parent config.`,
        },
        {
          layer: 'subagent_role',
          text: `Role=${agentRole}; nickname=${agentNickname}.`,
        },
      ],
      contextRefs: [],
      artifacts: [],
      summary: prompt,
      limits: {
        maxSubagents: this.config.maxSubagents,
        largePayloadPolicy: 'artifact_refs',
      },
    };
  }

  private createChildAgent(
    agentRole: string | null | undefined,
    agentNickname: string | null | undefined,
    envelope?: AgentTransferEnvelope,
    _overrides?: {
      model?: string;
      reasoningEffort?: string;
      serviceTier?: string;
      agentRole?: string;
    },
    roleProfile?: ResolvedAgentRoleProfile | null,
  ): AgentLoop {
    const activeRoleProfile = roleProfile ?? this.tryResolveAgentRoleProfile(agentRole);
    const roleLine = this.config.locale === 'zh'
      ? `你是父线程派生的子 agent。角色：${agentRole ?? 'subagent'}。名称：${agentNickname ?? 'subagent'}。独立完成分配任务，最后给出简洁结论。`
      : `You are a spawned subagent. Role: ${agentRole ?? 'subagent'}. Nickname: ${agentNickname ?? 'subagent'}. Complete the delegated task independently and end with a concise result.`;
    const roleProfilePrompt = buildRoleProfilePrompt(activeRoleProfile);
    const envelopeLine = envelope
      ? `\n\n## Agent Transfer Envelope\n${JSON.stringify(envelope, null, 2)}`
      : '';
    const roleProfileLine = roleProfilePrompt ? `\n\n${roleProfilePrompt}` : '';
    const child = new AgentLoop(
      {
        workspaceRoot: this.config.workspaceRoot,
        sandbox: this.config.sandbox,
        model: this.config.model,
        store: this.config.store,
        tenantId: this.config.tenantId,
        tools: this.tools,
        approvalHandler: this.config.approvalHandler,
        maxIterations: this.config.maxIterations,
        systemPrompt: `${this.config.systemPrompt}\n\n${roleLine}${roleProfileLine}${envelopeLine}`,
        skills: scopedSkillsForRole(this.config.skills, activeRoleProfile),
        hooks: this.config.hooks,
        locale: this.config.locale,
        webSearchMode: this.config.webSearchMode,
        runProfile: this.config.runProfile,
        maxSubagents: activeRoleProfile?.maxSubagents ?? this.config.maxSubagents,
        maxSubagentDepth: activeRoleProfile?.maxSubagentDepth ?? this.config.maxSubagentDepth,
        spawnModelFactory: this.config.spawnModelFactory,
        agentRoles: this.config.agentRoles,
        activeAgentRoleProfile: activeRoleProfile,
        runtimeMiddleware: this.config.runtimeMiddleware,
        dynamicContextProvider: this.config.dynamicContextProvider,
        maxRepeatedToolCalls: this.config.maxRepeatedToolCalls,
        maxConsecutiveToolErrors: this.config.maxConsecutiveToolErrors,
        toolBindingMode: this.config.toolBindingMode,
        initialTools: this.config.initialTools,
        maxToolSearchResults: this.config.maxToolSearchResults,
        toolGovernance: this.config.toolGovernance,
        guardian: this.config.guardian,
        memory: this.config.memory,
        // 中文注释：子 agent 不自建采样器，通过 attachSystemMonitor 共享父 agent 的实例
        // — Chinese: child doesn't start its own sampler; shares parent's via attachSystemMonitor
        systemMonitor: { enabled: false },
      },
      this.stateManager,
    );
    // 中文注释：共享父 agent 的 SystemMonitor 实例，让子 agent 的工具调用也受同样的限流
    // — Chinese: share parent's SystemMonitor so child's tool calls follow the same throttle
    child.attachSystemMonitor(this._systemMonitor);
    return child;
  }

  private tryResolveAgentRoleProfile(roleName: string | null | undefined): ResolvedAgentRoleProfile | null {
    try {
      return resolveAgentRoleProfile(this.config.agentRoles, roleName ?? DEFAULT_AGENT_ROLE_NAME);
    } catch {
      return null;
    }
  }

  // ─── Message Building ─────────────────────────────────────────────────────
  private async buildMessages(
    threadId: ThreadId,
    userInput: UserInput,
    thread: ThreadMeta,
    webSearchRecommended = false,
    includeCurrentUserInput = true,
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    // System prompt
    // 系统提示
    const systemPrompt = await this.buildSystemPrompt(thread, userInput);
    messages.push({ role: 'system', content: systemPrompt });
    const turnInstruction = this.buildTurnInstructionPrompt(userInput, webSearchRecommended);

    // Recent history
    // 最近历史
    const recentItems = await this.config.store.getRecentItems(threadId, 50);
    const compactedTurnIds = new Set(parseCompactedRanges(thread.tags?.compactedRanges)
      .flatMap((range) => range.compactedTurnIds));
    for (const item of recentItems) {
      if (item.turnId && compactedTurnIds.has(item.turnId) && item.type !== 'context_compaction') {
        continue;
      }
      const msg = itemToMessage(item);
      if (msg) messages.push(msg);
    }

    // Current user input - support multimodal (text + images)
    // 当前用户输入 — 支持多模态（文本 + 图像）
    if (!includeCurrentUserInput) {
      return fitMessagesToBudget(messages, MODEL_HISTORY_TOKEN_BUDGET);
    }
    if (userInput.type === 'multimodal') {
      const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
      for (const part of userInput.parts) {
        if (part.type === 'text') {
          contentParts.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          contentParts.push({ type: 'image_url', image_url: { url: part.image_url.url } });
        }
      }
      if (turnInstruction) {
        contentParts.push({ type: 'text', text: turnInstruction });
      }
      messages.push({ role: 'user', content: contentParts });
    } else {
      messages.push({ role: 'user', content: appendTurnInstruction(userInput.text, turnInstruction) });
    }

    return fitMessagesToBudget(messages, MODEL_HISTORY_TOKEN_BUDGET);
  }

  private shouldOfferWebSearchTool(): boolean {
    return this.config.webSearchMode !== 'off';
  }

  private buildTurnInstructionPrompt(userInput: UserInput, webSearchRecommended: boolean): string {
    const sections: string[] = [];
    const activeSkillsPrompt = this.buildActiveSkillsPrompt(userInput);
    if (activeSkillsPrompt) sections.push(activeSkillsPrompt);
    const modeInstruction = userInputModeInstruction(userInput);
    if (modeInstruction) {
      sections.push(`One-time instruction for this turn only:\n${modeInstruction}`);
    }
    if (webSearchRecommended) {
      sections.push([
        'Web access is recommended for this turn.',
        'Use the Codex-style web_search tool actions: search, open_page, and find_in_page.',
        'If the user provides a URL, call web_search with action="open_page" and url first.',
        'Use action="search" only to discover likely URLs, then stop searching and use action="open_page" on the most relevant page.',
        'Avoid repeated searches for the same task; summarize from fetched pages and search results.',
        'Avoid web tools for local repository work.',
      ].join(' '));
    }
    if (sections.length === 0) return '';
    return `<turn_instructions>\n${sections.join('\n\n')}\n</turn_instructions>`;
  }

  private async buildSystemPrompt(thread: ThreadMeta, userInput?: UserInput): Promise<string> {
    let prompt = this.config.systemPrompt;

    // Inject AGENTS.md
    // 注入 AGENTS.md
    const agentsMd = await loadAgentsMd(this.config.workspaceRoot);
    if (agentsMd) {
      prompt += `\n\n## Project Rules (AGENTS.md)\n${agentsMd}`;
    }

    // Inject skills
    // 注入技能
    const skillsText = this.config.skills.toPromptText();
    if (skillsText) {
      prompt += `\n\n${skillsText}`;
    }

    if (userInput) {
      const memoryContext = await this.buildMemoryContext(thread, userInput);
      if (memoryContext) {
        prompt += `\n\n${memoryContext}`;
      }
    }

    const lightMemoryContext = await this.buildLightMemoryContext(thread);
    if (lightMemoryContext) {
      prompt += `\n\n${lightMemoryContext}`;
    }

    // Inject episode working set (after cold memory, before compacted summary).
    const workingSet = this.threadWorkingSets.get(thread.threadId);
    if (workingSet?.frozenPromptBlock) {
      prompt += `\n\n${workingSet.frozenPromptBlock}`;
    }

    // Inject compacted summary
    // 注入压缩摘要
    if (thread.status === 'compacted' && thread.tags?.compactedSummary) {
      prompt += `\n\n## Previous Conversation Summary\n${thread.tags.compactedSummary}`;
    }

    return prompt;
  }

  private async buildMemoryContext(thread: ThreadMeta, userInput: UserInput): Promise<string> {
    const settings = this.config.memory;
    if (!settings.memoryEnabled || !settings.useColdMemories) return '';
    if (thread.tags?.memoryExcluded === 'true') return '';
    if (!this.config.store.listMemoryRecords && !this.config.store.searchMemoryRecords) return '';

    const query = userInputToText(userInput);
    const results = await searchColdMemories(this.config.store, query, {
      workspaceRoot: thread.workspaceRoot ?? this.config.workspaceRoot,
      limit: settings.memoryInjectLimit,
      tokenBudget: settings.memoryTokenBudget,
    });
    if (results.length === 0) return '';

    const usedAt = new Date().toISOString();
    for (const result of results) {
      try {
        await this.config.store.recordMemoryUsage?.(result.record.id, usedAt);
      } catch (err) {
        await this.appendRunMonitorEvent('memory-context', {
          category: 'memory',
          type: 'memory.usage_record_failed',
          level: 'warning',
          message: err instanceof Error ? err.message : String(err),
          metadata: { memoryId: result.record.id },
        });
      }
    }

    const lines = results.map((result) => {
      const record = result.record;
      const sourceThreadId = record.sourceThreadId ?? 'unknown';
      const score = result.score.toFixed(2);
      return `- [memory:${record.id} ${record.type} score=${score} sourceThreadId=${sourceThreadId}] ${record.text}`;
    });
    return [
      '## Cold Memories',
      'Persistent memories retrieved for this turn. Use them only when relevant; each entry is source-marked for audit.',
      ...lines,
    ].join('\n');
  }

  private async buildLightMemoryContext(thread: ThreadMeta): Promise<string> {
    const settings = this.config.memory;
    if (!settings.memoryEnabled) return '';
    if (thread.tags?.memoryExcluded === 'true') return '';

    try {
      const memories = await listLightMemories(this.config.store);
      if (memories.length === 0) return '';
      const limit = Math.max(1, Math.min(settings.memoryInjectLimit, 20));
      const selected = memories
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
      const lines = selected.map((entry) => {
        const sourceThreadId = entry.sourceThreadId ?? 'unknown';
        return `- [light:${entry.id} sourceThreadId=${sourceThreadId}] ${entry.text}`;
      });
      return [
        '## Light Memories',
        'Recent lightweight user notes. Use them only when relevant to the current turn.',
        ...lines,
      ].join('\n');
    } catch (err) {
      await this.appendRunMonitorEvent('memory-context', {
        category: 'memory',
        type: 'memory.light_context_failed',
        level: 'warning',
        message: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  private async maybeExtractColdMemories(
    thread: ThreadMeta,
    turnId: TurnId,
    userInput: UserInput,
    collectedItems: ThreadItem[],
  ): Promise<void> {
    const settings = this.config.memory;
    if (!settings.memoryEnabled || !settings.autoExtractMemories) return;
    if (thread.ephemeral || thread.parentThreadId || thread.tags?.memoryExcluded === 'true') return;
    if (!this.config.store.upsertMemoryRecord || !this.config.store.listMemoryRecords) return;

    try {
      const assistantText = collectedItems
        .filter((item): item is Extract<ThreadItem, { type: 'agent_message' }> => item.turnId === turnId && item.type === 'agent_message')
        .map((item) => item.text)
        .join('\n\n');
      const candidates = extractMemoryCandidates({
        threadId: thread.threadId,
        turnId,
        workspaceRoot: thread.workspaceRoot ?? this.config.workspaceRoot,
        userText: userInputToText(userInput),
        assistantText,
        now: new Date(),
      });
      for (const candidate of candidates) {
        await mergeMemoryCandidate(this.config.store, candidate, new Date());
      }
    } catch (err) {
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'memory.extract_failed',
        level: 'warning',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Episode Memory Helpers ─────────────────────────────────────────────────
  private storeSupportsEpisodes(): boolean {
    return Boolean(
      this.config.store.upsertEpisodeRecord &&
      this.config.store.listEpisodeRecords &&
      this.config.store.saveThreadWorkingSet &&
      this.config.store.getThreadWorkingSet,
    );
  }

  private async loadEpisodeMemorySettings(): Promise<EpisodeMemorySettings> {
    if (!this.storeSupportsEpisodes()) return normalizeEpisodeMemorySettings(undefined);
    try {
      return await getEpisodeMemorySettings(this.config.store);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 无 turn 上下文时静默回退；有上下文的地方会额外上报 warning
      return normalizeEpisodeMemorySettings(undefined);
    }
  }

  private resolveEpisodeMemoryMode(thread: ThreadMeta): EpisodeMemoryMode {
    const mode = thread.tags?.episodeMemoryMode;
    if (mode === 'disabled' || mode === 'polluted') return mode;
    return 'enabled';
  }

  private async prepareEpisodeWorkingSet(
    thread: ThreadMeta,
    turnId: TurnId,
    turnIndex: number,
    userInput: UserInput,
  ): Promise<void> {
    if (!this.storeSupportsEpisodes()) return;

    const mode = this.resolveEpisodeMemoryMode(thread);
    if (mode === 'disabled') {
      this.threadWorkingSets.delete(thread.threadId);
      this.threadOpenEpisodes.delete(thread.threadId);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.mode.disabled',
        message: 'Episode memory is disabled for this thread',
      });
      return;
    }

    if (mode === 'polluted') {
      this.threadWorkingSets.delete(thread.threadId);
      this.threadOpenEpisodes.delete(thread.threadId);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.mode.polluted',
        message: 'Episode memory is polluted for this thread; skipping automatic injection',
      });
      return;
    }

    let settings: EpisodeMemorySettings;
    try {
      settings = await this.loadEpisodeMemorySettings();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.settings_load_failed',
        level: 'warning',
        message: `Failed to load episode memory settings: ${message}`,
      });
      return;
    }

    if (!settings.episodeMemoryEnabled) return;

    try {
      const previousOpenEpisode = this.threadOpenEpisodes.get(thread.threadId) ?? null;
      const openEpisode = await getOpenEpisodeForThread(this.config.store, thread.threadId);
      if (openEpisode) {
        this.threadOpenEpisodes.set(thread.threadId, openEpisode);
      }

      const hadSnapshot = await getThreadWorkingSetSnapshot(this.config.store, thread.threadId);
      if (hadSnapshot) {
        this.threadWorkingSets.set(thread.threadId, hadSnapshot);
      }

      const activeGoal = thread.tags?.activeGoal;
      const selectedArtifacts = thread.tags?.selectedArtifacts
        ? thread.tags.selectedArtifacts.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      const result = await buildOrReuseWorkingSet(
        this.config.store,
        thread,
        userInput,
        turnId,
        turnIndex,
        openEpisode,
        settings,
        activeGoal,
        selectedArtifacts,
      );

      this.threadWorkingSets.set(thread.threadId, result.snapshot);
      if (result.openEpisode) {
        this.threadOpenEpisodes.set(thread.threadId, result.openEpisode);
      }

      if (result.rebuilt) {
        try {
          await saveThreadWorkingSetSnapshot(this.config.store, result.snapshot);
          if (result.openEpisode && result.openEpisode.id !== previousOpenEpisode?.id) {
            await saveEpisodeRecord(this.config.store, result.openEpisode);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.appendRunMonitorEvent(turnId, {
            category: 'memory',
            type: 'episode.working_set_save_failed',
            level: 'warning',
            message: `Failed to save rebuilt working set: ${message}`,
          });
        }

        this.emit({
          type: 'episode.working_set_rebuilt',
          threadId: thread.threadId,
          turnId,
          generation: result.snapshot.generation,
          activeEpisodeIds: result.snapshot.activeEpisodeIds,
          frozenPromptBlock: result.snapshot.frozenPromptBlock,
        });
        await this.appendRunMonitorEvent(turnId, {
          category: 'memory',
          type: 'episode.working_set_rebuilt',
          message: 'Episode working set rebuilt',
          metadata: {
            generation: result.snapshot.generation,
            activeEpisodeIds: result.snapshot.activeEpisodeIds,
            injectedEpisodeIds: result.snapshot.injectedEpisodeIds,
            taskFingerprint: result.snapshot.taskFingerprint,
          },
        });
      } else if (hadSnapshot) {
        await this.appendRunMonitorEvent(turnId, {
          category: 'memory',
          type: 'episode.working_set_restored',
          message: 'Episode working set restored from persisted snapshot',
          metadata: {
            generation: result.snapshot.generation,
            activeEpisodeIds: result.snapshot.activeEpisodeIds,
            taskFingerprint: result.snapshot.taskFingerprint,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.working_set_failed',
        level: 'warning',
        message: `Episode working set preparation failed: ${message}`,
      });
    }
  }

  private async updateEpisodeFromCompletedTurn(
    thread: ThreadMeta,
    turnId: TurnId,
    turnIndex: number,
    userInput: UserInput,
    collectedItems: ThreadItem[],
  ): Promise<void> {
    if (!this.storeSupportsEpisodes()) return;

    const mode = this.resolveEpisodeMemoryMode(thread);
    if (mode !== 'enabled') return;

    const openEpisode = this.threadOpenEpisodes.get(thread.threadId);
    if (!openEpisode || openEpisode.lifecycle !== 'open') return;

    let settings: EpisodeMemorySettings;
    try {
      settings = await this.loadEpisodeMemorySettings();
    } catch {
      return;
    }
    if (!settings.episodeMemoryEnabled) return;

    const userText = userInputToText(userInput);
    const assistantText = collectedItems
      .filter((item): item is Extract<ThreadItem, { type: 'agent_message' }> =>
        item.turnId === turnId && item.type === 'agent_message',
      )
      .map((item) => item.text)
      .join('\n\n');
    const episodeItems = collectedItems
      .filter((item) => item.turnId === turnId)
      .map((item) => ({
        type: item.type,
        text: (item as Partial<ThreadItem> & { text?: string }).text,
        path: (item as Partial<ThreadItem> & { path?: string }).path,
        items: (item as Partial<ThreadItem> & { items?: Array<{ text: string; completed: boolean }> }).items,
      }));

    try {
      const updated = updateEpisodeFromTurn(
        openEpisode,
        turnId,
        turnIndex,
        userText,
        assistantText,
        episodeItems,
      );
      await saveEpisodeRecord(this.config.store, updated);
      this.threadOpenEpisodes.set(thread.threadId, updated);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.updated',
        message: 'Open episode updated from completed turn',
        metadata: { episodeId: updated.id, sourceTurnEndIndex: updated.sourceTurnEndIndex },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.update_failed',
        level: 'warning',
        message: `Failed to update open episode: ${message}`,
      });
    }
  }

  private async sealOpenEpisodeForCompaction(threadId: ThreadId, turnId: TurnId): Promise<void> {
    if (!this.storeSupportsEpisodes()) return;

    const thread = await this.config.store.getThread(threadId);
    if (!thread || this.resolveEpisodeMemoryMode(thread) !== 'enabled') return;

    let settings: EpisodeMemorySettings;
    try {
      settings = await this.loadEpisodeMemorySettings();
    } catch {
      return;
    }
    if (!settings.episodeMemoryEnabled) return;

    const openEpisode = this.threadOpenEpisodes.get(threadId);
    if (!openEpisode || openEpisode.lifecycle !== 'open') return;

    try {
      const sealed = sealEpisode(openEpisode, 'pre_compact');
      await saveEpisodeRecord(this.config.store, sealed);
      this.threadOpenEpisodes.set(threadId, sealed);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.sealed',
        message: 'Open episode sealed before context compaction',
        metadata: { episodeId: sealed.id, reason: 'pre_compact' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.seal_failed',
        level: 'warning',
        message: `Failed to seal open episode before compaction: ${message}`,
      });
    }
  }

  private async invalidateEpisodesForRollback(
    threadId: ThreadId,
    newTurnCount: number,
    turnId: TurnId,
  ): Promise<void> {
    if (!this.storeSupportsEpisodes()) return;

    try {
      const { rolledBack, stale } = await invalidateEpisodesByTurnRange(
        this.config.store,
        threadId,
        newTurnCount,
      );
      if (rolledBack.length > 0 || stale.length > 0) {
        await this.appendRunMonitorEvent(turnId, {
          category: 'memory',
          type: 'episode.invalidated',
          message: `Invalidated episodes after rollback (rolledBack=${rolledBack.length}, stale=${stale.length})`,
          metadata: { rolledBack, stale, newTurnCount },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.invalidate_failed',
        level: 'warning',
        message: `Failed to invalidate episodes after rollback: ${message}`,
      });
    }

    try {
      if (this.config.store.deleteThreadWorkingSet) {
        await this.config.store.deleteThreadWorkingSet(threadId);
      }
      this.threadWorkingSets.delete(threadId);
      this.threadOpenEpisodes.delete(threadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.working_set_delete_failed',
        level: 'warning',
        message: `Failed to delete thread working set after rollback: ${message}`,
      });
    }
  }

  private async maybeEmitWorkingSetRestored(threadId: ThreadId, turnId: TurnId): Promise<void> {
    if (!this.storeSupportsEpisodes()) return;
    try {
      const thread = await this.config.store.getThread(threadId);
      const mode = thread ? this.resolveEpisodeMemoryMode(thread) : 'enabled';
      if (mode !== 'enabled') {
        this.threadWorkingSets.delete(threadId);
        this.threadOpenEpisodes.delete(threadId);
        return;
      }

      const openEpisode = await getOpenEpisodeForThread(this.config.store, threadId);
      if (openEpisode) {
        this.threadOpenEpisodes.set(threadId, openEpisode);
      }
      const snapshot = this.config.store.getThreadWorkingSet
        ? await this.config.store.getThreadWorkingSet(threadId)
        : null;
      if (snapshot) {
        this.threadWorkingSets.set(threadId, snapshot);
        await this.appendRunMonitorEvent(turnId, {
          category: 'memory',
          type: 'episode.working_set_restored',
          message: 'Episode working set restored from persisted snapshot',
          metadata: {
            generation: snapshot.generation,
            activeEpisodeIds: snapshot.activeEpisodeIds,
            taskFingerprint: snapshot.taskFingerprint,
            episodeIdentity: snapshot.episodeIdentity,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendRunMonitorEvent(turnId, {
        category: 'memory',
        type: 'episode.working_set_restore_failed',
        level: 'warning',
        message: `Failed to restore episode working set: ${message}`,
      });
    }
  }

  private async emitCompactionPressure(
    threadId: ThreadId,
    turnId: TurnId,
    visibleMessages?: ChatMessage[],
  ): Promise<{
    pressure: {
      estimatedTokens: number;
      maxTokens: number;
      softThreshold: number;
      hardThreshold: number;
      ratio: number;
      status: 'ok' | 'soft' | 'hard';
    };
    compactionOptions: ReturnType<typeof compactionOptionsForRunProfile>;
    autoCompactWindow: ThreadState['autoCompactWindow'];
  }> {
    const recentItems = await this.config.store.getRecentItems(threadId, 200);
    const thread = await this.config.store.getThread(threadId);
    const effectiveRecentItems = filterEffectiveCompactionItems(recentItems, thread?.tags?.compactedRanges);
    const compactionOptions = compactionOptionsForRunProfile(this.config.runProfile);
    const rolloutPressure = getCompactionPressure(effectiveRecentItems, compactionOptions);
    const visibleInputTokens = visibleMessages ? estimateRuntimeChatTokens(visibleMessages).inputTokens : 0;
    const estimatedTokens = Math.max(rolloutPressure.estimatedTokens, visibleInputTokens);
    const ratio = rolloutPressure.maxTokens > 0 ? estimatedTokens / rolloutPressure.maxTokens : 1;
    const pressure = {
      ...rolloutPressure,
      estimatedTokens,
      ratio,
      status: estimatedTokens >= rolloutPressure.hardThreshold
        ? 'hard' as const
        : estimatedTokens >= rolloutPressure.softThreshold
          ? 'soft' as const
          : 'ok' as const,
    };
    const autoCompactWindow = { ...this.stateManager.get(threadId).autoCompactWindow };
    this.emit({ type: 'context.compaction_pressure', threadId, turnId, pressure: { ...pressure, window: autoCompactWindow } });
    return { pressure, compactionOptions, autoCompactWindow };
  }

  private async maybeAutoCompact(
    threadId: ThreadId,
    turnId: TurnId,
    phaseContext: 'pre_turn' | 'mid_turn' = 'pre_turn',
    visibleMessages?: ChatMessage[],
  ): Promise<boolean> {
    const { pressure, compactionOptions, autoCompactWindow } = await this.emitCompactionPressure(threadId, turnId, visibleMessages);
    const pressureWithWindow = { ...pressure, window: autoCompactWindow };
    if (pressure.status !== 'hard') return false;
    const compactionItemId = `compact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.emit({
      type: 'thread.compacted.v2',
      threadId,
      turnId,
      phase: 'started',
      trigger: 'auto',
      strategy: compactionOptions.strategy,
      tokensBefore: Math.ceil(pressure.estimatedTokens),
      item: { id: compactionItemId },
    });
    await this.appendRunMonitorEvent(turnId, {
      category: 'compaction',
      type: 'compaction.started',
      message: 'Automatic context compaction started',
      metadata: { trigger: 'auto', phase: phaseContext, strategy: compactionOptions.strategy, pressure: pressureWithWindow },
    });
    try {
      await this.config.hooks.trigger('pre_compact', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      await this.sealOpenEpisodeForCompaction(threadId, turnId);
      const result = await compactThread(threadId, this.config.store, this.config.model, {
        trigger: 'auto',
        compactionTurnId: turnId,
        compactionItemId,
        force: phaseContext === 'mid_turn',
        tokensBeforeOverride: Math.ceil(pressure.estimatedTokens),
        ...compactionOptions,
      });
      let compacted = false;
      if (result.item) {
        this.emit({ type: 'item.started', threadId, turnId, item: result.item });
        this.emit({ type: 'item.completed', threadId, turnId, item: result.item });
        this.emit({
          type: 'thread.compacted',
          threadId,
          compactedTurns: result.compactedTurns,
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
        });
        this.emit({
          type: 'thread.compacted.v2',
          threadId,
          turnId,
          phase: 'completed',
          trigger: 'auto',
          strategy: compactionOptions.strategy,
          compactedTurns: result.compactedTurns,
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
          item: result.item,
        });
        await this.appendRunMonitorEvent(turnId, {
          category: 'compaction',
          type: 'compaction.completed',
          message: 'Automatic context compaction completed',
          metadata: {
            trigger: 'auto',
            phase: phaseContext,
            strategy: compactionOptions.strategy,
            compactedTurns: result.compactedTurns,
            tokensBefore: result.tokensBefore,
            tokensAfter: result.tokensAfter,
            windowOrdinal: autoCompactWindow.ordinal,
          },
        });
        this.stateManager.startNextAutoCompactWindow(threadId);
        compacted = true;
      }
      await this.config.hooks.trigger('post_compact', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      return compacted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const info = toNexusErrorInfo(error);
      this.emit({
        type: 'thread.compacted.v2',
        threadId,
        turnId,
        phase: 'failed',
        trigger: 'auto',
        strategy: compactionOptions.strategy,
        item: { id: compactionItemId },
        error: { message, info },
      });
      await this.appendRunMonitorEvent(turnId, {
        category: 'compaction',
        type: 'compaction.failed',
        level: 'error',
        message,
        metadata: { trigger: 'auto', phase: phaseContext, strategy: compactionOptions.strategy, info },
      });
      throw error;
    }
  }

  private buildActiveSkillsPrompt(userInput: UserInput): string {
    const text = userInputToText(userInput);
    const names = [...new Set([...text.matchAll(/\$([a-z0-9][a-z0-9_-]*)/gi)].map((match) => match[1]))];
    const skills = names
      .map((name) => this.config.skills.get(name))
      .filter((skill) => skill !== undefined);
    if (skills.length === 0) return '';
    return [
      '## Active Skill Instructions',
      ...skills.map((skill) => [
        `### ${skill.name}`,
        skill.description ? `Description: ${skill.description}` : '',
        skill.body,
      ].filter(Boolean).join('\n')),
    ].join('\n\n');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private async finishTurnLifecycle(
    runtimeContext: RuntimeTurnContext,
    result: RuntimeTurnResult,
  ): Promise<void> {
    let lifecycleError: unknown;
    try {
      await this.config.hooks.trigger('turn_end', {
        threadId: runtimeContext.threadId,
        turnId: runtimeContext.turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
    } catch (err) {
      lifecycleError = err;
    } finally {
      try {
        await this.runtimeMiddleware.afterTurn(runtimeContext, result);
      } catch (err) {
        lifecycleError ??= err;
      }
    }
    if (lifecycleError) throw lifecycleError;
  }

  private async createRuntimeTurnContext(
    threadId: ThreadId,
    turnId: TurnId,
    thread: ThreadMeta,
    userInput: UserInput,
    checkpoint: Checkpoint,
    collectedItems: ThreadItem[],
  ): Promise<RuntimeTurnContext> {
    const runtimeState = await this.getRuntimeState(threadId);
    return {
      tenantId: this.config.tenantId,
      threadId,
      turnId,
      thread,
      userInput,
      workspaceRoot: this.config.workspaceRoot,
      locale: this.config.locale,
      runProfile: this.config.runProfile,
      webSearchMode: this.config.webSearchMode,
      runtimeState: {
        ...runtimeState,
        checkpoint,
      },
      checkpoint,
      collectedItems,
      store: this.config.store,
      stateManager: this.stateManager,
      emit: (event) => this.emit(event),
      audit: (event) => this.appendRunMonitorEvent(turnId, event),
      permissions: {
        level: this.effectiveLevel,
        networkAllowed: this.effectiveNetwork,
        presetId: this.preset?.id,
      },
      maxSubagents: this.config.maxSubagents,
      dynamicContextProvider: this.config.dynamicContextProvider,
    };
  }

  private withCheckpointState(
    threadId: ThreadId,
    turnId: TurnId,
    itemIndex: number,
    status: CheckpointStatus,
  ): Checkpoint {
    const state = this.stateManager.get(threadId);
    const timestamp = new Date().toISOString();
    const checkpoint: Checkpoint = {
      threadId,
      turnId,
      itemIndex,
      timestamp,
      generation: state.generation,
      status,
    };
    if (status === 'running') {
      checkpoint.expiresAt = new Date(Date.now() + RUNNING_CHECKPOINT_TTL_MS).toISOString();
    }
    return checkpoint;
  }

  private refreshRunningCheckpoint(
    checkpoint: Checkpoint,
    threadId: ThreadId,
    turnId: TurnId,
    itemIndex: number,
  ): void {
    const next = this.withCheckpointState(threadId, turnId, itemIndex, 'running');
    checkpoint.itemIndex = next.itemIndex;
    checkpoint.timestamp = next.timestamp;
    checkpoint.generation = next.generation;
    checkpoint.status = next.status;
    checkpoint.expiresAt = next.expiresAt;
  }

  private async writeCheckpoint(threadId: ThreadId, checkpoint: Checkpoint): Promise<void> {
    this.stateManager.setCheckpoint(threadId, checkpoint);
    await this.config.store.appendCheckpoint(threadId, checkpoint);
  }

  private async recordUsage(threadId: ThreadId, turnId: TurnId, usage: Usage): Promise<void> {
    this.stateManager.recordAutoCompactWindowPrefill(threadId, usage.inputTokens);
    const thread = await this.config.store.getThread(threadId);
    const previous = parseThreadUsage(threadId, thread?.tags?.threadUsage);
    const turns = [
      ...previous.turns.filter((entry) => entry.turnId !== turnId),
      { turnId, usage, timestamp: new Date().toISOString() },
    ];
    const total = turns.reduce<Usage>((sum, entry) => ({
      inputTokens: sum.inputTokens + entry.usage.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + entry.usage.cachedInputTokens,
      outputTokens: sum.outputTokens + entry.usage.outputTokens,
      reasoningOutputTokens: sum.reasoningOutputTokens + entry.usage.reasoningOutputTokens,
      cacheStrategy: combineCacheStrategy(sum.cacheStrategy, entry.usage.cacheStrategy),
    }), emptyUsage());
    const next: ThreadUsage = {
      threadId,
      total,
      turns,
      updatedAt: new Date().toISOString(),
    };
    await this.config.store.updateThreadMetadata(threadId, {
      tags: { ...(thread?.tags ?? {}), threadUsage: JSON.stringify(next) },
    });
    this.emit({ type: 'thread.token_usage.updated', threadId, usage: next });
  }

  private emitItem(threadId: ThreadId, turnId: TurnId, item: ThreadItem): void {
    // 实施点 2：emit 前注入 harnessRunId 标记（保证事件与持久化一致）
    this.applyHarnessFields(threadId, item);
    this.emit({ type: 'item.started', threadId, turnId, item });
    this.emit({ type: 'item.completed', threadId, turnId, item });
  }

  // 实施点 2：从 per-thread Map 取 harnessFields，注入到 item（仅 harness turn 产生时生效）
  // — English: read harness fields from per-thread map and inject onto item if present
  private applyHarnessFields(threadId: ThreadId, item: ThreadItem): void {
    const fields = this.harnessFieldsByThread.get(threadId);
    if (!fields) return;
    (item as ThreadItem & HarnessItemFields).harnessRunId = fields.harnessRunId;
    if (fields.harnessIteration !== undefined) {
      (item as ThreadItem & HarnessItemFields).harnessIteration = fields.harnessIteration;
    }
  }

  // 实施点 2：appendItems 包装，store 前注入 harnessRunId 标记，保证持久化 item 可被 EvidenceLedger.rebuildFromThreadItems 按 harnessRunId 过滤
  // — English: appendItems wrapper that tags items with harness fields before persistence
  private async persistItems(threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    for (const item of items) {
      this.applyHarnessFields(threadId, item);
    }
    await this.config.store.appendItems(threadId, items);
  }
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function combineCacheStrategy(
  left: Usage['cacheStrategy'],
  right: Usage['cacheStrategy'],
): Usage['cacheStrategy'] {
  if (!left) return right;
  if (!right || left === right) return left;
  return 'mixed';
}

function parseThreadUsage(threadId: ThreadId, raw: string | undefined): ThreadUsage {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ThreadUsage;
      if (parsed && Array.isArray(parsed.turns) && parsed.total) return parsed;
    } catch {
      // ignore malformed persisted usage
      // 忽略格式不正确的持久化用量
    }
  }
  return {
    threadId,
    total: emptyUsage(),
    turns: [],
    updatedAt: new Date().toISOString(),
  };
}

function parseAgentMailbox(raw: string | undefined): Array<{
  senderThreadId: ThreadId;
  receiverThreadId: ThreadId;
  content: string;
  triggerTurn: boolean;
  createdAt: string;
}> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.senderThreadId !== 'string' ||
        typeof candidate.receiverThreadId !== 'string' ||
        typeof candidate.content !== 'string'
      ) {
        return [];
      }
      return [{
        senderThreadId: candidate.senderThreadId,
        receiverThreadId: candidate.receiverThreadId,
        content: candidate.content,
        triggerTurn: candidate.triggerTurn === true,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
      }];
    });
  } catch {
    return [];
  }
}

function parseCompactedRanges(raw: string | undefined): CompactedRange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as CompactedRange[] : [];
  } catch {
    return [];
  }
}

function filterEffectiveCompactionItems(items: ThreadItem[], compactedRangesRaw: string | undefined): ThreadItem[] {
  const compactedTurnIds = new Set(parseCompactedRanges(compactedRangesRaw)
    .flatMap((range) => range.compactedTurnIds));
  if (compactedTurnIds.size === 0) return items;
  return items.filter((item) => (
    !item.turnId
    || !compactedTurnIds.has(item.turnId)
    || item.type === 'context_compaction'
  ));
}

function normalizeFileChanges(data: unknown): Array<{
  path: string;
  kind: 'add' | 'delete' | 'update';
  hunks?: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
    addedLines: number;
    removedLines: number;
    addedLinesContent: string[];
    removedLinesContent: string[];
    summary?: string;
  }>;
  addedLines?: number;
  removedLines?: number;
  summary?: string;
}> {
  const record = data && typeof data === 'object' ? data as { changes?: unknown } : {};
  if (!Array.isArray(record.changes)) return [];
  return record.changes.flatMap((change) => {
    if (!change || typeof change !== 'object') return [];
    const candidate = change as Record<string, unknown>;
    const kind = candidate.kind;
    const filePath = candidate.path;
    if ((kind !== 'add' && kind !== 'delete' && kind !== 'update') || typeof filePath !== 'string') {
      return [];
    }
    const hunks = Array.isArray(candidate.hunks)
      ? candidate.hunks.flatMap((hunk) => {
          if (!hunk || typeof hunk !== 'object') return [];
          const typed = hunk as Record<string, unknown>;
          // 中文注释：旧数据无 addedLinesContent/removedLinesContent 时降级为空数组
          const addedLinesContent = Array.isArray(typed.addedLinesContent)
            ? typed.addedLinesContent.filter((line): line is string => typeof line === 'string')
            : [];
          const removedLinesContent = Array.isArray(typed.removedLinesContent)
            ? typed.removedLinesContent.filter((line): line is string => typeof line === 'string')
            : [];
          return [{
            path: typeof typed.path === 'string' ? typed.path : filePath,
            startLine: typeof typed.startLine === 'number' ? typed.startLine : undefined,
            endLine: typeof typed.endLine === 'number' ? typed.endLine : undefined,
            addedLines: typeof typed.addedLines === 'number' ? typed.addedLines : 0,
            removedLines: typeof typed.removedLines === 'number' ? typed.removedLines : 0,
            addedLinesContent,
            removedLinesContent,
            summary: typeof typed.summary === 'string' ? typed.summary : undefined,
          }];
        })
      : undefined;
    return [{
      path: filePath,
      kind,
      hunks,
      addedLines: typeof candidate.addedLines === 'number' ? candidate.addedLines : undefined,
      removedLines: typeof candidate.removedLines === 'number' ? candidate.removedLines : undefined,
      summary: typeof candidate.summary === 'string' ? candidate.summary : undefined,
    }];
  });
}

type NormalizedFileChange = ReturnType<typeof normalizeFileChanges>[number];

async function activeTurnCount(store: ThreadStore, threadId: ThreadId): Promise<number> {
  const thread = await store.getThread(threadId);
  return thread?.turnCount ?? (await store.getTurns(threadId)).length;
}

async function capturePrePatchSnapshots(args: Record<string, unknown>, workspaceRoot: string): Promise<Map<string, string | null>> {
  const patchText = typeof args.patch === 'string' ? args.patch : '';
  const paths = extractPatchPaths(patchText);
  const snapshots = new Map<string, string | null>();
  for (const filePath of paths) {
    snapshots.set(filePath, await readWorkspaceTextFile(workspaceRoot, filePath));
  }
  return snapshots;
}

// 中文注释：write_file 在写入前捕获目标文件的当前内容，用于后续回滚。
async function captureWriteFilePathSnapshot(args: Record<string, unknown>, workspaceRoot: string): Promise<Map<string, string | null>> {
  const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
  const snapshots = new Map<string, string | null>();
  if (!filePath) return snapshots;
  snapshots.set(filePath, await readWorkspaceTextFile(workspaceRoot, filePath));
  return snapshots;
}

// 中文注释：write_file 整体覆盖文件，没有 patch hunk；根据 beforeContent 是否存在判断 add/update。
// 为让前端 DiffView 能渲染真实行级 diff，这里用公共前缀/后缀裁剪算出最小变更行集。
// — English: write_file overwrites the whole file; compute minimal diff via common prefix/suffix trim.
function buildWriteFileChanges(
  args: Record<string, unknown>,
  beforeSnapshots: Map<string, string | null>,
): NormalizedFileChange[] {
  const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
  if (!filePath) return [];
  const content = typeof args.content === 'string' ? args.content : '';
  const beforeContent = beforeSnapshots.has(filePath)
    ? beforeSnapshots.get(filePath)!
    : null;
  const kind: 'add' | 'update' = beforeContent === null ? 'add' : 'update';
  const splitLines = (text: string): string[] => text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const afterLines = splitLines(content);
  const beforeLines = beforeContent === null ? [] : splitLines(beforeContent);
  // 公共前缀/后缀裁剪：只保留真正变化的行，避免整体显示为删除+新增
  // — English: trim common prefix/suffix to keep only changed lines
  let prefix = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefix < maxPrefix && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(beforeLines.length - prefix, afterLines.length - prefix);
  while (suffix < maxSuffix && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix++;
  const removedLinesContent = beforeLines.slice(prefix, beforeLines.length - suffix);
  const addedLinesContent = afterLines.slice(prefix, afterLines.length - suffix);
  const startLine = prefix + 1;
  const endLine = Math.max(prefix + removedLinesContent.length, prefix + addedLinesContent.length, startLine);
  const hunks = (addedLinesContent.length > 0 || removedLinesContent.length > 0) ? [{
    path: filePath,
    addedLines: addedLinesContent.length,
    removedLines: removedLinesContent.length,
    addedLinesContent,
    removedLinesContent,
    startLine,
    endLine,
    summary: `write_file: ${filePath}`,
  }] : [];
  return [{
    path: filePath,
    kind,
    hunks,
    addedLines: addedLinesContent.length,
    removedLines: removedLinesContent.length,
    summary: `write_file: ${filePath}`,
  }];
}

function extractPatchPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    for (const prefix of ['*** Add File: ', '*** Delete File: ', '*** Update File: ', '*** Move to: ']) {
      if (line.startsWith(prefix)) {
        paths.add(line.slice(prefix.length).trim());
      }
    }
  }
  return [...paths].filter(Boolean);
}

async function createProjectCheckpointItem({
  turnId,
  itemId,
  turnCount,
  workspaceRoot,
  changes,
  beforeSnapshots,
}: {
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  turnCount: number;
  workspaceRoot: string;
  changes: NormalizedFileChange[];
  beforeSnapshots: Map<string, string | null>;
}): Promise<Extract<ThreadItem, { type: 'project_checkpoint' }>> {
  const files = [];
  for (const change of changes) {
    const beforeContent = beforeSnapshots.has(change.path)
      ? beforeSnapshots.get(change.path)!
      : await readWorkspaceTextFile(workspaceRoot, change.path);
    const afterContent = await readWorkspaceTextFile(workspaceRoot, change.path);
    files.push({
      path: change.path,
      kind: change.kind,
      beforeContent,
      afterContent,
      beforeHash: beforeContent === null ? null : sha256(beforeContent),
      afterHash: afterContent === null ? null : sha256(afterContent),
    });
  }
  return {
    id: itemId,
    type: 'project_checkpoint',
    turnId,
    turnCount,
    workspaceRoot,
    files,
    timestamp: new Date().toISOString(),
  };
}

async function readWorkspaceTextFile(workspaceRoot: string, filePath: string): Promise<string | null> {
  const absolutePath = safeWorkspacePath(workspaceRoot, filePath);
  if (!absolutePath) return null;
  try {
    return await fs.readFile(absolutePath, 'utf-8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error);
  }
}

function safeWorkspacePath(workspaceRoot: string, filePath: string): string | null {
  if (!workspaceRoot.trim()) return null;
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, filePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolutePath;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ─── Defaults ───────────────────────────────────────────────────────────────
function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
  return registry;
}

const BUILTIN_AGENT_ROLE_PROFILES: AgentRoleProfiles = {
  [DEFAULT_AGENT_ROLE_NAME]: {
    description: 'Default spawned agent role. Inherits the parent runtime configuration.',
  },
  reviewer: {
    description: 'Reviews implementation, tests, regressions, and risks.',
    instructions: [
      'Review the delegated work with a code-review posture.',
      'Prioritize correctness, regressions, missing tests, safety, and concrete file references.',
      'Keep the final result concise and actionable.',
    ].join('\n'),
    allowedSkills: ['code-review'],
  },
  researcher: {
    description: 'Investigates code, documentation, and design context before reporting findings.',
    instructions: [
      'Explore the delegated context before drawing conclusions.',
      'Prefer source-backed findings and identify uncertainty explicitly.',
      'Do not make code changes unless the task explicitly asks for implementation.',
    ].join('\n'),
  },
  implementer: {
    description: 'Implements focused changes and reports verification results.',
    instructions: [
      'Implement the delegated change within the inherited workspace and constraints.',
      'Keep edits scoped, preserve unrelated user changes, and verify the behavior you changed.',
    ].join('\n'),
  },
  worker: {
    description: 'General-purpose worker role for compatibility with existing Nexus subagent prompts.',
    instructions: 'Complete the delegated task independently under the inherited runtime constraints.',
  },
  subagent: {
    description: 'Legacy Nexus subagent role alias.',
    instructions: 'Complete the delegated task independently under the inherited runtime constraints.',
  },
};

function normalizeAgentRoleProfiles(profiles?: AgentRoleProfiles): AgentRoleProfiles {
  const normalized: AgentRoleProfiles = {};
  for (const [name, profile] of Object.entries(profiles ?? {})) {
    const normalizedName = normalizeAgentRoleName(name);
    if (normalizedName) normalized[normalizedName] = { ...profile };
  }
  return normalized;
}

function normalizeAgentRoleName(name: string | null | undefined): string {
  const trimmed = (name ?? DEFAULT_AGENT_ROLE_NAME).trim();
  return trimmed || DEFAULT_AGENT_ROLE_NAME;
}

function resolveAgentRoleProfile(profiles: AgentRoleProfiles, name: string | null | undefined): ResolvedAgentRoleProfile {
  const roleName = normalizeAgentRoleName(name);
  const profile = profiles[roleName] ?? BUILTIN_AGENT_ROLE_PROFILES[roleName];
  if (!profile) {
    const error = new Error(`unknown agent_type '${roleName}'`);
    (error as Error & { code?: string }).code = 'UNKNOWN_AGENT_ROLE';
    throw error;
  }
  return { ...profile, name: roleName };
}

function scopedSkillsForRole(parentSkills: SkillRegistry, profile: ResolvedAgentRoleProfile | null | undefined): SkillRegistry {
  const allowedSkillNames = profile ? profile.allowedSkills ?? profile.skills : undefined;
  if (!allowedSkillNames || allowedSkillNames.length === 0) return parentSkills;
  const registry = new LocalSkillRegistry();
  for (const name of allowedSkillNames) {
    const skill = parentSkills.get(name);
    if (skill) registry.register(skill);
  }
  return registry;
}

function buildRoleProfilePrompt(profile: ResolvedAgentRoleProfile | null | undefined): string {
  if (!profile) return '';
  const lines = [`## Agent Role Profile: ${profile.name}`];
  if (profile.description?.trim()) lines.push(`Description: ${profile.description.trim()}`);
  const instructions = [profile.instructions, profile.systemPrompt]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
  if (instructions) lines.push(`Instructions:\n${instructions}`);
  const allowedSkills = profile.allowedSkills ?? profile.skills;
  if (allowedSkills?.length) lines.push(`Allowed skills: ${allowedSkills.join(', ')}`);
  if (profile.allowedTools?.length) lines.push(`Allowed tools: ${profile.allowedTools.join(', ')}`);
  if (profile.blockedTools?.length) lines.push(`Blocked tools: ${profile.blockedTools.join(', ')}`);
  return lines.join('\n');
}

function registerCollabTools(
  registry: ToolRegistry,
  options?: { a2aClientEnabled?: boolean; a2aRemotes?: string[] },
): void {
  for (const tool of createCollabToolDefinitions(options)) {
    if (!registry.get(tool.name)) {
      registry.register(tool);
    }
  }
}

function registerOptionalTools(registry: ToolRegistry, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    if (!registry.get(tool.name)) {
      registry.register(tool);
    }
  }
}

function resolveToolName(registry: ToolRegistry, name: string): string {
  const maybeRegistry = registry as ToolRegistry & { resolveName?: (toolName: string) => string };
  if (typeof maybeRegistry.resolveName === 'function') {
    return maybeRegistry.resolveName(name);
  }
  return FALLBACK_TOOL_ALIASES.get(name) ?? name;
}

const FALLBACK_TOOL_ALIASES = new Map<string, string>([
  ['list_file', 'list_files'],
  ['list_dir', 'list_files'],
  ['list_directory', 'list_files'],
  ['ls', 'list_files'],
  ['dir', 'list_files'],
  ['search_file', 'search_content'],
  ['search_files', 'search_content'],
  ['grep', 'search_content'],
  ['rg', 'search_content'],
  ['read_files', 'read_file'],
  ['cat', 'read_file'],
  ['open_page', 'web_search'],
  ['open_url', 'web_search'],
  ['fetch_url', 'web_fetch'],
  ['web_open', 'web_search'],
]);

function createCollabToolDefinitions(options?: { a2aClientEnabled?: boolean; a2aRemotes?: string[] }): ToolDefinition[] {
  const readonly = 'readonly' as const;
  const tools: ToolDefinition[] = [
    {
      name: 'spawn_agent',
      description: 'Spawn a child agent thread for an independent subtask. Use this when parallel investigation or delegation helps.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The full task prompt for the child agent.' },
          agentRole: { type: 'string', description: 'Agent role profile, such as default, reviewer, researcher, implementer, or a configured role.' },
          agent_type: { type: 'string', description: 'Codex-compatible role label alias for agentRole.' },
          agentNickname: { type: 'string', description: 'Optional display nickname for the child agent.' },
          model: { type: 'string', description: 'Optional requested model metadata. Nexus child agents still inherit the parent model.' },
          reasoningEffort: { type: 'string', description: 'Optional requested reasoning effort metadata.' },
          reasoning_effort: { type: 'string', description: 'Codex-compatible reasoning effort alias.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'send_input',
      description: 'Send a new prompt to an existing child agent thread.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Child thread ID.' },
          prompt: { type: 'string', description: 'Message to send to the child agent.' },
          interrupt: { type: 'boolean', description: 'Interrupt the child if it is already running before sending.' },
        },
        required: ['threadId', 'prompt'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'send_message',
      description: 'Queue a message for an existing child agent without starting a new turn.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Child thread ID.' },
          message: { type: 'string', description: 'Message to queue for the child agent.' },
        },
        required: ['target', 'message'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'followup_task',
      description: 'Queue a follow-up task for an existing child agent and wake it to run a turn.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Child thread ID.' },
          message: { type: 'string', description: 'Task message for the child agent.' },
        },
        required: ['target', 'message'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'resume_agent',
      description: 'Reconnect to an existing child agent thread after reload or process restart.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Child thread ID.' },
        },
        required: ['threadId'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'wait',
      description: 'Wait for one child agent, or all open child agents when threadId is omitted, and return their latest results.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Optional child thread ID.' },
        },
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'wait_agent',
      description: 'Codex-compatible alias for wait. Wait for one child agent, or all open child agents when target is omitted.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Optional child thread ID.' },
          threadId: { type: 'string', description: 'Optional child thread ID.' },
        },
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'list_agents',
      description: 'List spawned child agents and their current/persisted status.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          path_prefix: { type: 'string', description: 'Optional child id or nickname prefix.' },
        },
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
    {
      name: 'close_agent',
      description: 'Close a child agent thread edge. If the child is running, it is interrupted first.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Child thread ID.' },
        },
        required: ['threadId'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    },
  ];
  // 中文注释：仅当 a2aClientEnabled=true 时注册 spawn_remote_agent 工具
  // — Chinese: only register spawn_remote_agent when a2aClientEnabled=true
  if (options?.a2aClientEnabled) {
    const remotesHint = options.a2aRemotes?.length
      ? ` Registered remote agents: ${options.a2aRemotes.join(', ')}.`
      : '';
    tools.push({
      name: 'spawn_remote_agent',
      description: `Delegate a subtask to a remote A2A (Agent-to-Agent) agent. The remote agent executes the task and returns its result. Use this for cross-framework collaboration or when a remote agent has specialized capabilities.${remotesHint}`,
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          agentUrl: {
            type: 'string',
            description: 'URL of the remote A2A agent (e.g. https://host/api/a2a or https://host/.well-known/agent-card.json).',
          },
          task: {
            type: 'string',
            description: 'Task description to send to the remote agent.',
          },
          context: {
            type: 'string',
            description: 'Optional additional context to pass to the remote agent.',
          },
        },
        required: ['agentUrl', 'task'],
        additionalProperties: false,
      },
      execute: async () => ({ output: 'handled by AgentLoop', status: 'completed' as const }),
    });
  }
  return tools;
}

function buildDefaultSystemPrompt(): string {
  return `You are a helpful coding agent running locally. You have access to tools for reading/writing files, running shell commands, searching code, and applying patches.

Rules:
- Read files before editing them.
- Use absolute or workspace-relative paths.
- Always explain what you're about to do before executing commands.
- If a tool requires approval, wait for it — never bypass.
- Do NOT use window.THREE, @ts-nocheck, or assume browser globals.
- Always use ESM imports.
- Prefer simple, clear solutions.`;
}

function itemToMessage(item: ThreadItem): ChatMessage | null {
  switch (item.type) {
    case 'user_message':
      return { role: 'user', content: item.text };
    case 'agent_message':
      if (leaksToolProtocol(item.text)) {
        return {
          role: 'assistant',
          content: '[Previous assistant message redacted because it contained leaked tool-call protocol text.]',
        };
      }
      return { role: 'assistant', content: item.text };
    case 'reasoning':
      return { role: 'assistant', content: `[Reasoning] ${item.text}` };
    case 'tool_call':
      if (isDingtalkGroupForwardTool(item.toolName)) {
        return {
          role: 'assistant',
          content: `[Tool ${item.toolName} ${item.status}]\nDingTalk group message tool result redacted. Do not reuse this prior tool call or reveal internal routing details.`,
        };
      }
      return {
        role: 'assistant',
        content: `[Tool ${item.toolName} ${item.status}]\n${formatToolHistoryPayload(item.result ?? item.error ?? item.arguments)}`,
      };
    case 'context_compaction':
      return {
        role: 'assistant',
        content: `[Context compaction ${item.status}]\n${item.summary?.raw ?? ''}`,
      };
    case 'collab_tool_call':
      return {
        role: 'assistant',
        content: `[Collaboration ${item.tool} ${item.status}]\n${formatToolHistoryPayload(item.result ?? item.error ?? item.prompt)}`,
      };
    case 'mcp_tool_call':
      return {
        role: 'assistant',
        content: `[MCP ${item.server}/${item.tool} ${item.status}]\n${formatToolHistoryPayload(item.result ?? item.error ?? item.arguments)}`,
      };
    case 'command_execution':
      return {
        role: 'assistant',
        content: `[Command ${item.status}]\n${item.command}\n${item.aggregatedOutput}`,
      };
    case 'error':
      return { role: 'assistant', content: `[Error] ${item.message}` };
    default:
      return null;
  }
}

function fitMessagesToBudget(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (estimateRuntimeChatTokens(messages).inputTokens <= maxTokens) return messages;
  if (messages.length <= 2) return messages;

  const first = messages[0];
  const last = messages[messages.length - 1];
  const middle = messages.slice(1, -1);
  const retained: ChatMessage[] = [];
  for (let index = middle.length - 1; index >= 0; index -= 1) {
    const candidate = [first, middle[index], ...retained, last];
    if (estimateRuntimeChatTokens(candidate).inputTokens <= maxTokens) {
      retained.unshift(middle[index]);
    }
  }
  return [first, ...retained, last];
}

function estimateRuntimeChatTokens(messages: ChatMessage[]): {
  inputTokens: number;
  messageCount: number;
  imageCount: number;
  charCount: number;
} {
  let charCount = 0;
  let imageCount = 0;
  for (const message of messages) {
    charCount += message.role.length + 4;
    if (typeof message.content === 'string') {
      charCount += message.content.length;
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        charCount += part.text.length;
      } else if (part.type === 'image_url') {
        imageCount += 1;
        charCount += 85;
      }
    }
  }
  return {
    inputTokens: Math.max(1, Math.ceil(charCount / 4) + messages.length * 3 + imageCount * 85),
    messageCount: messages.length,
    imageCount,
    charCount,
  };
}

function formatToolHistoryPayload(payload: unknown): string {
  if (payload === undefined || payload === null) return '';
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function isTextToolPlaceholder(content: unknown): boolean {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  return /\[(?:Tool|tool)\s+[\w.-]+\]/.test(trimmed)
    || /^工具调用\s*[:：]\s*[\w.-]+\s*$/i.test(trimmed)
    || leaksToolProtocol(trimmed);
}

function isDingtalkGroupForwardTool(name: string): boolean {
  return name === 'dingtalk_send_group_message' || name === 'dingtalk_forward_to_group';
}

function userInputToText(input: UserInput): string {
  if (input.type === 'text') return input.text;
  return input.parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return '[image]';
      return `[image: ${part.path}]`;
    })
    .filter(Boolean)
    .join('\n');
}

function userInputModeInstruction(input: UserInput): string {
  const value = input.modeInstruction;
  return typeof value === 'string' ? value.trim() : '';
}

function appendTurnInstruction(text: string, instruction: string): string {
  const trimmed = instruction.trim();
  if (!trimmed) return text;
  return `${text}\n\n${trimmed}`;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateItemId(turnId: TurnId, index: number): ItemId {
  return `${turnId}_item_${index}`;
}

function isTurnCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Turn cancelled';
}

function safeRuntimeTenantId(value: string | null | undefined): string {
  const tenantId = value?.trim() || 'default';
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${value ?? ''}`);
  }
  return tenantId;
}

function isCollabTool(name: string): name is CollabToolName {
  return [
    'spawn_agent',
    'send_input',
    'send_message',
    'followup_task',
    'resume_agent',
    'wait',
    'wait_agent',
    'list_agents',
    'close_agent',
    'spawn_remote_agent',
  ].includes(name);
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function truncateMonitorText(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function redactMonitorArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/key|token|secret|password|authorization/i.test(key)) {
      redacted[key] = '[redacted]';
    } else if (typeof value === 'string') {
      redacted[key] = truncateMonitorText(value, 300);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function requiredThreadArg(args: Record<string, unknown>): ThreadId {
  const threadId = stringArg(args, 'threadId') ?? stringArg(args, 'agentId');
  if (!threadId) throw new Error('Child threadId is required');
  return threadId;
}

function titleFromText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact || 'Subagent';
}

function formatCollabToolOutput(item: CollabToolCallItem, locale: Locale): string {
  const zh = locale === 'zh';
  const payload = item.result ?? item.error ?? {};
  if (item.status === 'failed') {
    const message = item.error?.message ?? (zh ? '协作工具失败。' : 'Collaboration tool failed.');
    return zh ? `失败：${message}` : `Failed: ${message}`;
  }
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return zh
    ? `${item.tool} 已完成。\n${json}`
    : `${item.tool} completed.\n${json}`;
}
