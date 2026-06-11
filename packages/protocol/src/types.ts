// ─── Thread ──────────────────────────────────────────────────────────────────
/** Unique identifier for a thread. */
export type ThreadId = string;

/** Thread metadata persisted in SQLite. */
export interface ThreadMeta {
  threadId: ThreadId;
  /** Human-readable title (may be auto-generated). */
  title: string;
  /** Workspace root for this thread. */
  workspaceRoot: string;
  /** Current status. */
  status: ThreadStatus;
  /** Number of turns in this thread. */
  turnCount: number;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
  /** ISO-8601, null if never archived. */
  archivedAt: string | null;
  /** Whether this thread is ephemeral (in-memory only). */
  ephemeral: boolean;
  /** Arbitrary key-value tags. */
  tags: Record<string, string>;
  /** Parent thread ID when this thread was spawned as a subagent. */
  parentThreadId?: ThreadId | null;
  /** Human-friendly nickname for a spawned subagent. */
  agentNickname?: string | null;
  /** Role label/purpose for a spawned subagent. */
  agentRole?: string | null;
}

export type ThreadStatus = 'active' | 'archived' | 'compacted';

export type ThreadSpawnEdgeStatus = 'open' | 'closed';

export interface ThreadSpawnEdge {
  parentThreadId: ThreadId;
  childThreadId: ThreadId;
  status: ThreadSpawnEdgeStatus;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
}

// ─── Turn ────────────────────────────────────────────────────────────────────
export type TurnId = string;

export interface TurnMeta {
  turnId: TurnId;
  threadId: ThreadId;
  /** Zero-based index within the thread. */
  index: number;
  /** The user input that started this turn. */
  userInput: UserInput;
  status: TurnStatus;
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601, null while still running. */
  completedAt: string | null;
}

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** A single user input. */
export type UserInput = TextInput | MultimodalInput;

export interface TextInput {
  type: 'text';
  text: string;
  /** One-shot instruction injected for this turn only. */
  modeInstruction?: string;
}

export interface MultimodalInput {
  type: 'multimodal';
  parts: InputPart[];
  /** One-shot instruction injected for this turn only. */
  modeInstruction?: string;
}

export type InputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } }
  | { type: 'image_path'; path: string };

// ─── Item ────────────────────────────────────────────────────────────────────
/** Unique item identifier within a thread. */
export type ItemId = string;

/** All item types — the canonical persisted item union. */
export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | ContextCompactionItem
  | ToolCallItem
  | CollabToolCallItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem;

export interface UserMessageItem {
  id: ItemId;
  type: 'user_message';
  turnId: TurnId;
  text: string;
  /** ISO-8601 timestamp used by transcript action rows. */
  timestamp?: string;
}

export interface AgentMessageItem {
  id: ItemId;
  type: 'agent_message';
  turnId: TurnId;
  text: string;
  /** Optional structured output (JSON). */
  structuredOutput?: unknown;
  /** ISO-8601 timestamp used by transcript action rows. */
  timestamp?: string;
}

export interface ReasoningItem {
  id: ItemId;
  type: 'reasoning';
  turnId: TurnId;
  text: string;
  timestamp?: string;
}

export type CommandStatus = 'in_progress' | 'completed' | 'failed';

export interface CommandExecutionItem {
  id: ItemId;
  type: 'command_execution';
  turnId: TurnId;
  command: string;
  aggregatedOutput: string;
  exitCode: number | null;
  status: CommandStatus;
  timestamp?: string;
}

export type PatchChangeKind = 'add' | 'delete' | 'update';
export type PatchApplyStatus = 'completed' | 'failed';

export interface FileChangeHunk {
  path: string;
  startLine?: number;
  endLine?: number;
  addedLines: number;
  removedLines: number;
  summary?: string;
}

export interface FileUpdateChange {
  path: string;
  kind: PatchChangeKind;
  hunks?: FileChangeHunk[];
  addedLines?: number;
  removedLines?: number;
  summary?: string;
}

export interface FileChangeItem {
  id: ItemId;
  type: 'file_change';
  turnId: TurnId;
  changes: FileUpdateChange[];
  hunks?: FileChangeHunk[];
  summary?: string;
  status: PatchApplyStatus;
  timestamp?: string;
}

export interface ArtifactRef {
  kind: 'file_segment' | 'tool_result' | 'mcp_result';
  path?: string;
  startLine?: number;
  endLine?: number;
  sha256?: string;
  excerpt?: string;
  sourceToolCallId?: ItemId;
}

export interface FileSegmentRef extends ArtifactRef {
  kind: 'file_segment';
  path: string;
  startLine: number;
  endLine: number;
}

export interface CompactionSummary {
  userGoal: string;
  completedWork: string;
  keyConstraints: string;
  filesAndArtifacts: string;
  toolResults: string;
  subagentResults: string;
  openTasks: string;
  risks: string;
  raw: string;
}

export interface CompactionPlan {
  compactedTurnIds: TurnId[];
  retainedTurnIds: TurnId[];
  tokensBefore: number;
  tokensAfterEstimate: number;
  trigger: 'manual' | 'auto';
}

export type CompactionStrategy = 'llm' | 'local';

export interface CompactedRange {
  compactedTurnIds: TurnId[];
  retainedTurnIds: TurnId[];
  compactionItemId: ItemId;
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  createdAt: string;
  trigger: 'manual' | 'auto';
  strategy: CompactionStrategy;
}

export interface ContextCompactionItem {
  id: ItemId;
  type: 'context_compaction';
  turnId: TurnId;
  status: CommandStatus;
  trigger: 'manual' | 'auto';
  compactedTurnIds: TurnId[];
  retainedTurnIds: TurnId[];
  summary?: CompactionSummary;
  tokensBefore: number;
  tokensAfter: number;
  error?: { message: string };
  timestamp?: string;
}

/** Generic tool call (non-MCP tools registered in the local OS). */
export interface ToolCallItem {
  id: ItemId;
  type: 'tool_call';
  turnId: TurnId;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
  status: CommandStatus;
  timestamp?: string;
}

export type CollabToolName = 'spawn_agent' | 'send_input' | 'resume_agent' | 'wait' | 'close_agent';

export interface CollabToolCallItem {
  id: ItemId;
  type: 'collab_tool_call';
  turnId: TurnId;
  tool: CollabToolName;
  status: CommandStatus;
  senderThreadId: ThreadId;
  receiverThreadId?: ThreadId;
  newThreadId?: ThreadId;
  prompt?: string;
  agentStatus?: ThreadSpawnEdgeStatus | TurnStatus | 'running';
  result?: unknown;
  error?: { message: string };
  timestamp?: string;
}

export interface AgentTransferEnvelope {
  schemaVersion: 1;
  senderThreadId: ThreadId;
  receiverThreadId: ThreadId;
  role: string;
  nickname: string;
  task: string;
  locale: string;
  webSearchMode: string;
  permissions: {
    level: string;
    networkAllowed: boolean;
    presetId?: string;
  };
  constraints: Array<{
    layer: 'project_agents_md' | 'thread_config' | 'parent_delegation' | 'skills_mcp_web_search' | 'subagent_role';
    text: string;
  }>;
  contextRefs: ArtifactRef[];
  artifacts: ArtifactRef[];
  summary: string;
  limits: {
    maxSubagents: number;
    largePayloadPolicy: 'artifact_refs';
  };
}

export interface McpToolCallItem {
  id: ItemId;
  type: 'mcp_tool_call';
  turnId: TurnId;
  server: string;
  tool: string;
  arguments: unknown;
  result?: {
    content: unknown[];
    structuredContent: unknown;
  };
  error?: { message: string };
  status: CommandStatus;
  timestamp?: string;
}

export interface WebSearchItem {
  id: ItemId;
  type: 'web_search';
  turnId: TurnId;
  query: string;
  timestamp?: string;
}

export interface TodoItemEntry {
  text: string;
  completed: boolean;
}

export interface TodoListItem {
  id: ItemId;
  type: 'todo_list';
  turnId: TurnId;
  items: TodoItemEntry[];
  timestamp?: string;
}

export interface ErrorItem {
  id: ItemId;
  type: 'error';
  turnId: TurnId;
  message: string;
  timestamp?: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────
/** Token usage for a turn. */
export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheStrategy?: 'deepseek-native' | 'openai-compatible' | 'anthropic-cache-control' | 'mixed';
}

export interface TurnUsage {
  turnId: TurnId;
  usage: Usage;
  timestamp: string;
}

export interface ThreadUsage {
  threadId: ThreadId;
  total: Usage;
  turns: TurnUsage[];
  updatedAt: string;
  includedThreadIds?: ThreadId[];
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface ModelRetryEvent {
  type: 'model.retry';
  threadId: ThreadId;
  turnId: TurnId;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  error?: string;
}

export interface ContextTokenEstimateUpdatedEvent {
  type: 'context.token_estimate.updated';
  threadId: ThreadId;
  turnId: TurnId;
  estimate: {
    inputTokens: number;
    messageCount: number;
    imageCount: number;
    charCount: number;
  };
}

export interface ContextCompactionPressureEvent {
  type: 'context.compaction_pressure';
  threadId: ThreadId;
  turnId: TurnId;
  pressure: {
    estimatedTokens: number;
    maxTokens: number;
    softThreshold: number;
    hardThreshold: number;
    ratio: number;
    status: 'ok' | 'soft' | 'hard';
  };
}

export interface ApprovalLogEntry {
  requestId: string;
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  kind: ApprovalRequest['kind'];
  description: string;
  approved: boolean;
  reason?: string;
  status: 'approved' | 'denied' | 'timeout';
  requestedAt: string;
  resolvedAt: string;
}

export interface ChildAgentEvent {
  type: 'child_agent.event';
  threadId: ThreadId;
  childThreadId: ThreadId;
  agentNickname?: string | null;
  agentRole?: string | null;
  event: Record<string, unknown>;
}

export interface CacheDiagnosticsEvent {
  type: 'cache.diagnostics';
  threadId: ThreadId;
  turnId: TurnId;
  shape: {
    systemHash: string;
    toolsHash: string;
    prefixHash: string;
  };
  stable: boolean;
  reasons: Array<'system' | 'tools'>;
}

/** Union of all streaming events. */
export type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | AgentMessageDeltaEvent
  | CommandOutputDeltaEvent
  | TokenUsageUpdatedEvent
  | TurnDiffUpdatedEvent
  | ModelRetryEvent
  | ContextTokenEstimateUpdatedEvent
  | ContextCompactionPressureEvent
  | ApprovalResolvedEvent
  | ApprovalRequiredEvent
  | CompactedEvent
  | ResumedEvent
  | ChildAgentEvent
  | CacheDiagnosticsEvent
  | ErrorEvent;

export interface ThreadStartedEvent {
  type: 'thread.started';
  threadId: ThreadId;
  thread: ThreadMeta;
}

export interface TurnStartedEvent {
  type: 'turn.started';
  threadId: ThreadId;
  turnId: TurnId;
  turnIndex: number;
}

export interface TurnCompletedEvent {
  type: 'turn.completed';
  threadId: ThreadId;
  turnId: TurnId;
  usage: Usage | null;
  status?: 'completed' | 'interrupted';
}

export interface TurnFailedEvent {
  type: 'turn.failed';
  threadId: ThreadId;
  turnId: TurnId;
  error: { message: string };
}

export interface ItemStartedEvent {
  type: 'item.started';
  threadId: ThreadId;
  turnId: TurnId;
  item: ThreadItem;
}

export interface ItemUpdatedEvent {
  type: 'item.updated';
  threadId: ThreadId;
  turnId: TurnId;
  item: ThreadItem;
}

export interface ItemCompletedEvent {
  type: 'item.completed';
  threadId: ThreadId;
  turnId: TurnId;
  item: ThreadItem;
}

/** Streaming text delta from the agent. */
export interface AgentMessageDeltaEvent {
  type: 'agent_message.delta';
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  delta: string;
}

/** Streaming output from a running command. */
export interface CommandOutputDeltaEvent {
  type: 'command_output.delta';
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  delta: string;
}

export interface TokenUsageUpdatedEvent {
  type: 'thread.token_usage.updated';
  threadId: ThreadId;
  usage: ThreadUsage;
}

export interface TurnDiffUpdatedEvent {
  type: 'turn.diff.updated';
  threadId: ThreadId;
  turnId: TurnId;
  diff: string;
}

export interface ApprovalResolvedEvent {
  type: 'approval.resolved';
  threadId: ThreadId;
  turnId: TurnId;
  requestId: string;
  approved: boolean;
  reason?: string;
  status: ApprovalLogEntry['status'];
}

/** HITL approval is needed before executing a command/tool. */
export interface ApprovalRequiredEvent {
  type: 'approval.required';
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  requestId: string;
  /** What needs approval. */
  kind: 'command' | 'file_write' | 'tool_call' | 'network';
  /** Human-readable description. */
  description: string;
  /** The raw command or tool arguments. */
  payload: unknown;
  /** The sandbox decision that triggered this. */
  decision: 'prompt' | 'forbidden';
  /** Optional justification from the policy. */
  justification?: string;
}

/** Emitted when context is compacted mid-conversation. */
export interface CompactedEvent {
  type: 'thread.compacted';
  threadId: ThreadId;
  /** Number of turns summarized. */
  compactedTurns: number;
  /** Token count before compaction. */
  tokensBefore: number;
  /** Token count after compaction. */
  tokensAfter: number;
}

/** Emitted when a thread is resumed from storage. */
export interface ResumedEvent {
  type: 'thread.resumed';
  threadId: ThreadId;
  turnIndex: number;
}

/** Unrecoverable error. */
export interface ErrorEvent {
  type: 'error';
  message: string;
}

// ─── JSON-RPC Transport ──────────────────────────────────────────────────────
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── Approval ────────────────────────────────────────────────────────────────
export interface ApprovalRequest {
  requestId: string;
  threadId: ThreadId;
  turnId: TurnId;
  itemId: ItemId;
  kind: 'command' | 'file_write' | 'tool_call' | 'network';
  description: string;
  payload: unknown;
  decision: 'prompt' | 'forbidden';
  justification?: string;
}

export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  reason?: string;
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────
/** Checkpoint marking resume position in JSONL rollout. */
export interface Checkpoint {
  threadId: ThreadId;
  turnId: TurnId;
  itemIndex: number;
  timestamp: string;
  generation?: number;
  status?: CheckpointStatus;
  expiresAt?: string;
}

export interface CheckpointLine {
  type: 'checkpoint';
  threadId: ThreadId;
  turnId: TurnId;
  itemIndex: number;
  timestamp: string;
  generation?: number;
  status?: CheckpointStatus;
  expiresAt?: string;
}

export type CheckpointStatus = 'running' | 'completed' | 'interrupted' | 'failed' | 'stale';

export interface ThreadRuntimeState {
  threadId: ThreadId;
  status: 'idle' | 'running' | 'completed' | 'interrupted' | 'failed' | 'stale';
  checkpoint: Checkpoint | null;
  resumable: boolean;
  stale: boolean;
}
