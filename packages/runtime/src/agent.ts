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
  ApprovalRequest,
  TextInput,
  CollabToolCallItem,
  CollabToolName,
  AgentTransferEnvelope,
  CheckpointStatus,
  ThreadRuntimeState,
  ThreadUsage,
  CompactedRange,
} from '@nexus/protocol';
import { ModelGateway, type ChatMessage, type ToolCall } from '@nexus/model-gateway';
import { ToolRegistry, type ToolContext, type ToolDefinition, BUILTIN_TOOLS } from '@nexus/tools';
import { Sandbox, resolveSandboxEffective, type SandboxConfig, type SandboxLevel, AutoApproveHandler, DenyAllApprovalHandler } from '@nexus/sandbox';
import type { ApprovalHandler } from '@nexus/sandbox';
import type { PermissionPreset } from '@nexus/sandbox';
import type { ThreadStore } from '@nexus/storage';
import { compactThread, getCompactionPressure, resumeThread } from '@nexus/memory';
import { loadAgentsMd, LocalSkillRegistry, LocalHookRegistry } from '@nexus/extensions';
import type { HookRegistry, SkillRegistry } from '@nexus/extensions';
import { createI18n, systemPromptKey } from '@nexus/i18n';
import type { Locale, I18n } from '@nexus/i18n';
import { ThreadStateManager } from './state.js';
import type { ThreadState } from './state.js';
import type { Checkpoint } from '@nexus/protocol';
import { shouldEnableWebSearch, type WebSearchMode } from './webSearchPolicy.js';
import { parseMcpNamespacedToolName } from './mcpClient.js';
import { buildPromptCacheShape, comparePromptCacheShape, type PromptCacheShape } from './cacheShape.js';
import { compactionOptionsForRunProfile, normalizeRunProfile, type RunProfile } from './runProfile.js';

const RUNNING_CHECKPOINT_TTL_MS = 30 * 60 * 1000;
const MAX_WEB_SEARCH_CALLS_PER_TURN = 6;
const MAX_DUPLICATE_WEB_SEARCH_QUERY_PER_TURN = 2;

interface WebToolBudget {
  searchCalls: number;
  searchQueries: Map<string, number>;
  webSearchDisabled: boolean;
}

// ─── Config ─────────────────────────────────────────────────────────────────
export interface AgentConfig {
  /** Workspace root for file operations. */
  workspaceRoot: string;
  /** Sandbox config. */
  sandbox: SandboxConfig;
  /** Model gateway instance. */
  model: ModelGateway;
  /** Thread store. */
  store: ThreadStore;
  /** Tool registry (defaults to BUILTIN_TOOLS). */
  tools?: ToolRegistry;
  /** MCP tools discovered from enabled MCP servers. */
  mcpTools?: ToolDefinition[];
  /** Approval handler (defaults to DenyAllApprovalHandler). */
  approvalHandler?: ApprovalHandler;
  /** Max agent loop iterations per turn. */
  maxIterations?: number;
  /** System prompt override. */
  systemPrompt?: string;
  /** Skills registry. */
  skills?: SkillRegistry;
  /** Hooks registry. */
  hooks?: HookRegistry;
  /** UI + agent response locale (default: 'zh'). */
  locale?: Locale;
  /** Controls when web_search should be offered once a provider extension is available. */
  webSearchMode?: WebSearchMode;
  /** Runtime trade-off profile: cache hit stability or long-running traceability. */
  runProfile?: RunProfile;
  /** Maximum open spawned subagents below a parent thread. */
  maxSubagents?: number;
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────
export class AgentLoop {
  private config: Required<AgentConfig>;
  private tools: ToolRegistry;
  private i18n: I18n;
  private eventListeners: Array<(event: ThreadEvent) => void> = [];
  private subagentRuns = new Map<ThreadId, Promise<{ items: ThreadItem[]; usage: Usage | null }>>();
  private promptCacheShapes = new Map<ThreadId, PromptCacheShape>();
  /** Per-thread state manager — process-level singleton by default. */
  readonly stateManager: ThreadStateManager;
  /** Resolved sandbox engine (lazy). */
  private _sandbox: Sandbox | null = null;
  /** Effective sandbox level from config (resolved from preset if set). */
  private _effectiveSandbox: { level: SandboxLevel; networkAllowed: boolean };

  constructor(config: AgentConfig, stateManager?: ThreadStateManager) {
    const locale = config.locale ?? 'zh';
    this.i18n = createI18n(locale);
    this.stateManager = stateManager ?? ThreadStateManager.instance();
    this.config = {
      workspaceRoot: config.workspaceRoot,
      sandbox: config.sandbox,
      model: config.model,
      store: config.store,
      tools: config.tools ?? createDefaultRegistry(),
      mcpTools: config.mcpTools ?? [],
      approvalHandler: config.approvalHandler ?? new DenyAllApprovalHandler(),
      maxIterations: config.maxIterations ?? 20,
      systemPrompt: config.systemPrompt ?? this.i18n.t(systemPromptKey(locale)),
      skills: config.skills ?? new LocalSkillRegistry(),
      hooks: config.hooks ?? new LocalHookRegistry(),
      locale,
      webSearchMode: config.webSearchMode ?? 'auto',
      runProfile: normalizeRunProfile(config.runProfile),
      maxSubagents: config.maxSubagents ?? 4,
    };
    this.tools = this.config.tools;
    registerCollabTools(this.tools);
    registerOptionalTools(this.tools, this.config.mcpTools);
    this._effectiveSandbox = resolveSandboxEffective(config.sandbox);
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

  /** Get the i18n context (for UI to translate messages). */
  get i18nContext(): I18n {
    return this.i18n;
  }

  /** Get the thread state for a given thread. */
  getThreadState(threadId: ThreadId): ThreadState {
    return this.stateManager.get(threadId);
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
    const allItems = await this.config.store.getItems(threadId);
    const collectedItems: ThreadItem[] = allItems.slice(0, ckpt.itemIndex);

    // Clear interrupts and restart
    this.stateManager.clearPendingInterrupts(threadId);
    const cancelController = this.stateManager.startTurn(threadId, turnId);
    const effectiveSignal = signal ?? cancelController.signal;

    this.emit({
      type: 'thread.resumed',
      threadId,
      turnIndex: thread.turnCount,
    });

    const webSearchRecommended = shouldEnableWebSearch(this.config.webSearchMode, userInput);
    const webSearchToolAvailable = this.shouldOfferWebSearchTool();
    const messages = await this.buildMessages(threadId, userInput, thread, webSearchRecommended);
    const updatedCkpt: Checkpoint = this.withCheckpointState(threadId, turnId, ckpt.itemIndex, 'running');

    try {
      const result = await this.agentLoop(
        threadId,
        turnId,
        messages,
        collectedItems,
        effectiveSignal,
        updatedCkpt,
        webSearchToolAvailable,
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
      await this.config.hooks.trigger('turn_end', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      return result;
    } catch (err) {
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
        await this.config.hooks.trigger('turn_end', {
          threadId,
          turnId,
          workspaceRoot: this.config.workspaceRoot,
        });
        return { items: collectedItems, usage: null };
      }
      const errorMsg = String(err);
      this.stateManager.failTurn(threadId, turnId, {
        message: errorMsg,
        timestamp: new Date().toISOString(),
      });
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'failed'));
      this.emit({
        type: 'turn.failed',
        threadId,
        turnId,
        error: { message: errorMsg },
      });
      await this.config.hooks.trigger('turn_end', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      throw err;
    }
  }

  /** Register a listener for streaming events. */
  onEvent(listener: (event: ThreadEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /** Emit an event to all listeners. */
  private emit(event: ThreadEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // don't let listener errors crash the loop
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  /** Start a new thread. */
  async startThread(title?: string, options: { workspaceRoot?: string; tags?: Record<string, string> } = {}): Promise<ThreadMeta> {
    const threadId = generateId();
    const now = new Date().toISOString();
    const meta: ThreadMeta = {
      threadId,
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
  ): Promise<{ items: ThreadItem[]; usage: Usage | null }> {
    const thread = await this.config.store.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Check if already running
    if (this.stateManager.isRunning(threadId)) {
      throw new Error(`Thread ${threadId} already has an active turn`);
    }

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
    const cancelController = this.stateManager.startTurn(threadId, turnId);
    const effectiveSignal = signal ?? cancelController.signal;

    // Write initial checkpoint
    const checkpoint = this.withCheckpointState(threadId, turnId, 0, 'running');
    await this.writeCheckpoint(threadId, checkpoint);

    await this.config.store.saveTurn(turn);
    await this.config.store.updateThreadMetadata(threadId, {
      turnCount: turnIndex + 1,
    });

    this.emit({ type: 'turn.started', threadId, turnId, turnIndex });
    await this.config.hooks.trigger('turn_start', {
      threadId,
      turnId,
      workspaceRoot: this.config.workspaceRoot,
    });

    // Pre-turn auto compaction: visible item, then compacted summary enters context.
    await this.maybeAutoCompact(threadId, turnId);
    const refreshedThread = await this.config.store.getThread(threadId) ?? thread;

    // Build messages
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
    await this.config.store.appendItems(threadId, [userItem]);
    this.refreshRunningCheckpoint(checkpoint, threadId, turnId, collectedItems.length);
    await this.writeCheckpoint(threadId, checkpoint);

    // Main agent loop
    try {
      const result = await this.agentLoop(
        threadId,
        turnId,
        messages,
        collectedItems,
        effectiveSignal,
        checkpoint,
        webSearchToolAvailable,
      );
      turn.status = 'completed';
      turn.completedAt = new Date().toISOString();
      await this.config.store.saveTurn(turn);
      await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'completed'));
      this.stateManager.completeTurn(threadId, turnId);
      if (result.usage) await this.recordUsage(threadId, turnId, result.usage);
      this.emit({ type: 'turn.completed', threadId, turnId, usage: result.usage });
      await this.config.hooks.trigger('turn_end', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      return result;
    } catch (err) {
      if (isTurnCancelledError(err)) {
        turn.status = 'interrupted';
        turn.completedAt = new Date().toISOString();
        await this.config.store.saveTurn(turn);
        await this.writeCheckpoint(threadId, this.withCheckpointState(threadId, turnId, collectedItems.length, 'interrupted'));
        this.stateManager.completeInterruptedTurn(threadId, turnId);
        this.emit({ type: 'turn.completed', threadId, turnId, usage: null, status: 'interrupted' });
        await this.config.hooks.trigger('turn_end', {
          threadId,
          turnId,
          workspaceRoot: this.config.workspaceRoot,
        });
        return { items: collectedItems, usage: null };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorItem: ThreadItem = {
        id: generateItemId(turnId, collectedItems.length),
        type: 'error',
        turnId,
        message: errorMsg,
        timestamp: new Date().toISOString(),
      };
      collectedItems.push(errorItem);
      this.emitItem(threadId, turnId, errorItem);
      await this.config.store.appendItems(threadId, [errorItem]);
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
        error: { message: errorMsg },
      });
      await this.config.hooks.trigger('turn_end', {
        threadId,
        turnId,
        workspaceRoot: this.config.workspaceRoot,
      });
      throw err;
    }
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
  ): Promise<{ items: ThreadItem[]; usage: Usage | null }> {
    let iteration = 0;
    let usage: Usage | null = null;
    const webToolBudget: WebToolBudget = {
      searchCalls: 0,
      searchQueries: new Map(),
      webSearchDisabled: false,
    };

    while (iteration < this.config.maxIterations) {
      if (signal.aborted) throw new Error('Turn cancelled');

      iteration++;
      const streamed = await this.runModelStream(
        threadId,
        turnId,
        collectedItems,
        messages,
        webSearchToolAvailable && !webToolBudget.webSearchDisabled,
      );
      usage = streamed.usage;
      const message = streamed.message;

      // If no tool calls, this is the final response
      if (!message.tool_calls || message.tool_calls.length === 0) {
        return { items: collectedItems, usage };
      }

      // Process tool calls
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        if (signal.aborted) throw new Error('Turn cancelled');

        const toolResult = await this.executeToolCall(
          threadId,
          turnId,
          toolCall,
          collectedItems,
          webToolBudget,
        );
        if (toolResult.disableWebSearch) {
          webToolBudget.webSearchDisabled = true;
        }

        // Update checkpoint after each tool execution
        this.refreshRunningCheckpoint(checkpoint, threadId, turnId, collectedItems.length);
        await this.writeCheckpoint(threadId, checkpoint);

        messages.push({
          role: 'tool',
          content: toolResult.output,
          tool_call_id: toolCall.id,
        });
      }
    }

    throw new Error(this.i18n.t('runtime.max_iterations', { max: this.config.maxIterations }));
  }

  private async runModelStream(
    threadId: ThreadId,
    turnId: TurnId,
    collectedItems: ThreadItem[],
    messages: ChatMessage[],
    webSearchToolAvailable: boolean,
  ): Promise<{ message: ChatMessage; usage: Usage | null }> {
    let content = '';
    let usage: Usage | null = null;
    let agentItem: ThreadItem | null = null;
    const toolCalls = new Map<string, ToolCall>();

    const tools = this.tools
      .toOpenAITools()
      .filter((tool) => webSearchToolAvailable || !['web_search', 'web_fetch'].includes(tool.function.name));
    const cacheShape = buildPromptCacheShape(messages, tools);
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
      estimate: estimateRuntimeChatTokens(messages),
    });

    for await (const event of this.config.model.chatStream({
      messages,
      tools,
      tool_choice: 'auto',
    }, {
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

    if (agentItem) {
      this.emit({ type: 'item.completed', threadId, turnId, item: agentItem });
      await this.config.store.appendItems(threadId, [agentItem]);
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
  }

  // ─── Tool Execution ───────────────────────────────────────────────────────
  private consumeWebToolBudget(
    toolName: string,
    args: Record<string, unknown>,
    budget?: WebToolBudget,
  ): string | null {
    if (!budget || toolName !== 'web_search') return null;
    const query = typeof args.query === 'string' ? args.query.trim().replace(/\s+/g, ' ') : '';
    const normalizedQuery = query.toLowerCase();
    const duplicateCount = (budget.searchQueries.get(normalizedQuery) ?? 0) + 1;
    budget.searchCalls += 1;
    budget.searchQueries.set(normalizedQuery, duplicateCount);

    if (budget.searchCalls > MAX_WEB_SEARCH_CALLS_PER_TURN) {
      budget.webSearchDisabled = true;
      return this.config.locale === 'zh'
        ? `本轮 web_search 已达到 ${MAX_WEB_SEARCH_CALLS_PER_TURN} 次上限。请停止继续搜索，改用已有搜索结果回答；如果需要读取具体页面，请使用 web_fetch 抓取明确 URL。`
        : `web_search reached the per-turn limit of ${MAX_WEB_SEARCH_CALLS_PER_TURN}. Stop searching and answer from existing results; use web_fetch for a specific URL if needed.`;
    }
    if (normalizedQuery && duplicateCount > MAX_DUPLICATE_WEB_SEARCH_QUERY_PER_TURN) {
      budget.webSearchDisabled = true;
      return this.config.locale === 'zh'
        ? `本轮重复搜索相同 query 已达到上限。请停止重复 web_search，改用已有结果回答或使用 web_fetch 抓取明确 URL。`
        : `Repeated web_search for the same query reached the per-turn limit. Stop repeating the search and answer from existing results or use web_fetch for a specific URL.`;
    }
    return null;
  }

  private async executeToolCall(
    threadId: ThreadId,
    turnId: TurnId,
    toolCall: ToolCall,
    collectedItems: ThreadItem[],
    webToolBudget?: WebToolBudget,
  ): Promise<{ output: string; disableWebSearch?: boolean }> {
    const toolName = toolCall.function.name;
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
    };

    const webBudgetError = this.consumeWebToolBudget(toolName, args, webToolBudget);
    if (webBudgetError) {
      const toolItem: ThreadItem = {
        id: generateItemId(turnId, collectedItems.length),
        type: 'tool_call',
        turnId,
        toolName,
        arguments: args,
        status: 'failed',
        error: { message: webBudgetError },
        result: webBudgetError,
        timestamp: new Date().toISOString(),
      };
      collectedItems.push(toolItem);
      this.emit({ type: 'item.started', threadId, turnId, item: toolItem });
      this.emit({ type: 'item.completed', threadId, turnId, item: toolItem });
      await this.config.store.appendItems(threadId, [toolItem]);
      return { output: webBudgetError, disableWebSearch: true };
    }

    // Check sandbox policy
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

    if (isCollabTool(toolName)) {
      return this.executeCollabToolCall(threadId, turnId, toolName, args, collectedItems);
    }

    // Sandbox check — use resolved effective level
    if (toolDef.requiredPolicy === 'workspace_write' && this.effectiveLevel === 'readonly') {
      const msg = this.i18n.t('runtime.sandbox_denied', { tool: toolName });
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

    // Exec policy for shell commands
    if (toolName === 'shell_command' && typeof args.command === 'string') {
      const execResult = this.sandbox.evaluateCommand(args.command);
      if (execResult.decision === 'forbidden') {
        const reason = execResult.matchedRules[0]?.justification ?? 'Blocked by exec policy';
        const msg = this.i18n.t('runtime.rejected', { reason });
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
    }

    // Approval check — preset's 'never' skips all approval;
    // otherwise respect the tool's own requiresApproval flag.
    const requireApproval =
      this.preset?.approval === 'never' ? false : toolDef.requiresApproval;

    if (requireApproval) {
      const approvalReq: ApprovalRequest = {
        requestId: generateId(),
        threadId,
        turnId,
        itemId: generateItemId(turnId, collectedItems.length),
        kind: toolName === 'shell_command' ? 'command' : 'file_write',
        description: `Execute ${toolName}: ${JSON.stringify(args).slice(0, 200)}`,
        payload: args,
        decision: 'prompt',
      };

      this.emit({
        type: 'approval.required',
        threadId,
        turnId,
        itemId: approvalReq.itemId,
        requestId: approvalReq.requestId,
        kind: approvalReq.kind,
        description: approvalReq.description,
        payload: approvalReq.payload,
        decision: 'prompt',
      });

      const approval = await this.config.approvalHandler.requestApproval(approvalReq);
      if (!approval.approved) {
        const reason = approval.reason ?? 'denied';
        const msg = this.i18n.t('runtime.rejected', { reason });
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
      ctx.approved = true;
    }

    // Pre-tool hook
    await this.config.hooks.trigger('pre_tool_use', {
      threadId,
      turnId,
      toolName,
      toolArgs: args,
      workspaceRoot: this.config.workspaceRoot,
    });

    // Start item
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

    // Execute
    const result = await this.tools.execute(toolName, args, ctx);

    // Update item
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
    await this.config.store.appendItems(threadId, [toolItem]);

    if (toolName === 'apply_patch' && result.status === 'completed') {
      const changes = normalizeFileChanges(result.data);
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
        await this.config.store.appendItems(threadId, [fileItem]);
        this.emit({
          type: 'turn.diff.updated',
          threadId,
          turnId,
          diff: changes.map((change) => `${change.kind} ${change.path} +${change.addedLines ?? 0}/-${change.removedLines ?? 0}`).join('\n'),
        });
      }
    }

    // Post-tool hook
    await this.config.hooks.trigger('post_tool_use', {
      threadId,
      turnId,
      toolName,
      toolArgs: args,
      toolResult: result,
      workspaceRoot: this.config.workspaceRoot,
    });

    return { output: result.output };
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
      item.status = 'failed';
      item.error = { message };
      item.result = { error: message };
    }

    this.emit({ type: 'item.completed', threadId, turnId, item });
    await this.config.store.appendItems(threadId, [item]);
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
      case 'resume_agent':
        return this.resumeSubagent(parentThreadId, args, item);
      case 'wait':
        return this.waitForSubagents(parentThreadId, args, item);
      case 'close_agent':
        return this.closeSubagent(parentThreadId, args, item);
      default:
        throw new Error(`Unknown collaboration tool: ${toolName}`);
    }
  }

  private async spawnSubagent(
    parentThreadId: ThreadId,
    args: Record<string, unknown>,
    item: CollabToolCallItem,
  ): Promise<unknown> {
    const prompt = stringArg(args, 'prompt')?.trim();
    if (!prompt) throw new Error('spawn_agent requires prompt');
    const openEdges = await this.config.store.listThreadSpawnDescendants(parentThreadId, 'open');
    if (openEdges.length >= this.config.maxSubagents) {
      throw new Error(`Maximum open subagents reached: ${this.config.maxSubagents}`);
    }

    const parent = await this.config.store.getThread(parentThreadId);
    if (!parent) throw new Error(`Thread ${parentThreadId} not found`);
    const now = new Date().toISOString();
    const childThreadId = generateId();
    const agentRole = stringArg(args, 'agentRole') ?? stringArg(args, 'role') ?? 'subagent';
    const agentNickname = stringArg(args, 'agentNickname') ?? stringArg(args, 'nickname') ?? agentRole;
    const child: ThreadMeta = {
      threadId: childThreadId,
      title: titleFromText(prompt),
      workspaceRoot: parent.workspaceRoot || this.config.workspaceRoot,
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: parent.ephemeral,
      tags: { ...parent.tags },
      parentThreadId,
      agentNickname,
      agentRole,
    };
    await this.config.store.createThread(child);
    await this.config.store.upsertThreadSpawnEdge({
      parentThreadId,
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
  ): AgentLoop {
    const roleLine = this.config.locale === 'zh'
      ? `你是父线程派生的子 agent。角色：${agentRole ?? 'subagent'}。名称：${agentNickname ?? 'subagent'}。独立完成分配任务，最后给出简洁结论。`
      : `You are a spawned subagent. Role: ${agentRole ?? 'subagent'}. Nickname: ${agentNickname ?? 'subagent'}. Complete the delegated task independently and end with a concise result.`;
    const envelopeLine = envelope
      ? `\n\n## Agent Transfer Envelope\n${JSON.stringify(envelope, null, 2)}`
      : '';
    return new AgentLoop(
      {
        workspaceRoot: this.config.workspaceRoot,
        sandbox: this.config.sandbox,
        model: this.config.model,
        store: this.config.store,
        tools: this.tools,
        approvalHandler: this.config.approvalHandler,
        maxIterations: this.config.maxIterations,
        systemPrompt: `${this.config.systemPrompt}\n\n${roleLine}${envelopeLine}`,
        skills: this.config.skills,
        hooks: this.config.hooks,
        locale: this.config.locale,
        webSearchMode: this.config.webSearchMode,
        runProfile: this.config.runProfile,
        maxSubagents: this.config.maxSubagents,
      },
      this.stateManager,
    );
  }

  // ─── Message Building ─────────────────────────────────────────────────────
  private async buildMessages(
    threadId: ThreadId,
    userInput: UserInput,
    thread: ThreadMeta,
    webSearchRecommended = false,
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    // System prompt
    const systemPrompt = await this.buildSystemPrompt(thread);
    messages.push({ role: 'system', content: systemPrompt });
    const turnInstruction = this.buildTurnInstructionPrompt(userInput, webSearchRecommended);

    // Recent history
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

    // Current user input — support multimodal (text + images)
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

    return messages;
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
        'If the user provides a URL, use web_fetch first to read that page.',
        'Use web_search only to discover likely URLs, then stop searching and fetch the most relevant page.',
        'Avoid repeated searches for the same task; summarize from fetched pages and search results.',
        'Avoid web tools for local repository work.',
      ].join(' '));
    }
    if (sections.length === 0) return '';
    return `<turn_instructions>\n${sections.join('\n\n')}\n</turn_instructions>`;
  }

  private async buildSystemPrompt(thread: ThreadMeta): Promise<string> {
    let prompt = this.config.systemPrompt;

    // Inject AGENTS.md
    const agentsMd = await loadAgentsMd(this.config.workspaceRoot);
    if (agentsMd) {
      prompt += `\n\n## Project Rules (AGENTS.md)\n${agentsMd}`;
    }

    // Inject skills
    const skillsText = this.config.skills.toPromptText();
    if (skillsText) {
      prompt += `\n\n${skillsText}`;
    }

    // Inject compacted summary
    if (thread.status === 'compacted' && thread.tags?.compactedSummary) {
      prompt += `\n\n## Previous Conversation Summary\n${thread.tags.compactedSummary}`;
    }

    return prompt;
  }

  private async maybeAutoCompact(threadId: ThreadId, turnId: TurnId): Promise<void> {
    const recentItems = await this.config.store.getRecentItems(threadId, 200);
    const compactionOptions = compactionOptionsForRunProfile(this.config.runProfile);
    const pressure = getCompactionPressure(recentItems, compactionOptions);
    if (pressure.status === 'soft') {
      this.emit({ type: 'context.compaction_pressure', threadId, turnId, pressure });
      return;
    }
    if (pressure.status !== 'hard') return;
    await this.config.hooks.trigger('pre_compact', {
      threadId,
      turnId,
      workspaceRoot: this.config.workspaceRoot,
    });
    const result = await compactThread(threadId, this.config.store, this.config.model, {
      trigger: 'auto',
      compactionTurnId: turnId,
      ...compactionOptions,
    });
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
    }
    await this.config.hooks.trigger('post_compact', {
      threadId,
      turnId,
      workspaceRoot: this.config.workspaceRoot,
    });
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
    this.emit({ type: 'item.started', threadId, turnId, item });
    this.emit({ type: 'item.completed', threadId, turnId, item });
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
    }
  }
  return {
    threadId,
    total: emptyUsage(),
    turns: [],
    updatedAt: new Date().toISOString(),
  };
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

function normalizeFileChanges(data: unknown): Array<{
  path: string;
  kind: 'add' | 'delete' | 'update';
  hunks?: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
    addedLines: number;
    removedLines: number;
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
          return [{
            path: typeof typed.path === 'string' ? typed.path : filePath,
            startLine: typeof typed.startLine === 'number' ? typed.startLine : undefined,
            endLine: typeof typed.endLine === 'number' ? typed.endLine : undefined,
            addedLines: typeof typed.addedLines === 'number' ? typed.addedLines : 0,
            removedLines: typeof typed.removedLines === 'number' ? typed.removedLines : 0,
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

// ─── Defaults ───────────────────────────────────────────────────────────────
function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
  return registry;
}

function registerCollabTools(registry: ToolRegistry): void {
  for (const tool of createCollabToolDefinitions()) {
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

function createCollabToolDefinitions(): ToolDefinition[] {
  const readonly = 'readonly' as const;
  return [
    {
      name: 'spawn_agent',
      description: 'Spawn a child agent thread for an independent subtask. Use this when parallel investigation or delegation helps.',
      requiredPolicy: readonly,
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The full task prompt for the child agent.' },
          agentRole: { type: 'string', description: 'Short role label, such as reviewer, researcher, or implementer.' },
          agentNickname: { type: 'string', description: 'Optional display nickname for the child agent.' },
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
      return { role: 'assistant', content: item.text };
    case 'reasoning':
      return { role: 'assistant', content: `[Reasoning] ${item.text}` };
    case 'tool_call':
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

function isCollabTool(name: string): name is CollabToolName {
  return ['spawn_agent', 'send_input', 'resume_agent', 'wait', 'close_agent'].includes(name);
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
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
