import type { RunConfig } from '../config/config.js';
import type { EventDraft } from '../features/chat/threadView.js';

export interface McpConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  status: 'disabled' | 'configured' | 'starting' | 'running' | 'failed' | 'dead';
  serverInfo?: { name?: string; version?: string; title?: string };
  error?: string;
  toolCount: number;
  tools: Array<{ name: string; description?: string; namespacedName?: string }>;
  stderr?: string;
}

export interface ThreadMeta {
  threadId: string;
  title: string;
  workspaceRoot?: string;
  status: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: Record<string, string>;
  parentThreadId?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
}

export interface MemoryRecord {
  id: string;
  type: 'preference' | 'project_fact' | 'workflow_pattern' | 'failure_lesson' | 'environment_note';
  text: string;
  status: 'active' | 'deleted';
  scope: 'global' | 'workspace' | 'thread';
  sourceThreadId?: string;
  sourceTurnIds: string[];
  workspaceRoot?: string;
  tags: string[];
  confidence: number;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSpawnEdge {
  parentThreadId: string;
  childThreadId: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export interface ThreadRuntimeState {
  threadId: string;
  status: 'idle' | 'running' | 'completed' | 'interrupted' | 'failed' | 'stale';
  checkpoint: unknown | null;
  resumable: boolean;
  stale: boolean;
}

export interface ThreadItem {
  id: string;
  type: string;
  turnId?: string;
  text?: string;
  toolName?: string;
  command?: string;
  aggregatedOutput?: string;
  server?: string;
  tool?: string;
  exitCode?: number | null;
  changes?: Array<{
    path: string;
    kind: string;
    hunks?: Array<{ startLine?: number; endLine?: number; addedLines: number; removedLines: number; summary?: string }>;
    addedLines?: number;
    removedLines?: number;
    summary?: string;
  }>;
  hunks?: Array<{ path: string; startLine?: number; endLine?: number; addedLines: number; removedLines: number; summary?: string }>;
  summary?: unknown;
  trigger?: string;
  compactedTurnIds?: string[];
  retainedTurnIds?: string[];
  tokensBefore?: number;
  tokensAfter?: number;
  arguments?: unknown;
  result?: unknown;
  error?: { message: string };
  status?: string;
  message?: string;
  timestamp?: string;
  senderThreadId?: string;
  receiverThreadId?: string;
  newThreadId?: string;
  prompt?: string;
  agentStatus?: string;
  workflow?: unknown;
}

export interface TurnMeta {
  turnId: string;
  userInput: unknown;
  status?: string;
  startedAt?: string;
  completedAt?: string | null;
}

export interface ThreadChildInfo {
  thread: ThreadMeta;
  edge: ThreadSpawnEdge;
  state: ThreadRuntimeState;
  latestTurn: TurnMeta | null;
  latestCollabItem: ThreadItem | null;
  items?: ThreadItem[];
}

export interface SubagentStatusRow {
  threadId: string;
  parentThreadId: string;
  title: string;
  role: string;
  depth: number;
  status: string;
  statusLabel: string;
  tone: 'running' | 'success' | 'warning' | 'danger' | 'muted';
  latestAction: string;
  updatedAt: string;
}

export interface AgentStageRow extends SubagentStatusRow {
  kind: 'main' | 'child';
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
  updatedAt: string;
  extension?: string;
}

export interface WorkspaceFilePreview {
  root: string;
  path: string;
  name: string;
  size: number;
  updatedAt: string;
  previewType: 'text' | 'markdown' | 'image' | 'pdf' | 'office' | 'binary';
  mimeType: string;
  rawUrl?: string;
  truncated: boolean;
  text: string;
  binary: boolean;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheStrategy?: 'deepseek-native' | 'openai-compatible' | 'anthropic-cache-control' | 'mixed';
}

export interface ThreadUsage {
  threadId: string;
  total: Usage;
  turns: Array<{ turnId: string; usage: Usage; timestamp: string }>;
  updatedAt: string;
}

export interface EventLine {
  id: number;
  key?: string;
  kind: string;
  title: string;
  detail: string;
  tone: EventDraft['tone'];
  timestamp: string;
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'blocked';
export type RunKind = 'turn' | 'model' | 'tool' | 'workflow' | 'subagent' | 'middleware' | 'checkpoint' | 'control';
export type RunCaller = 'lead_agent' | 'subagent' | 'middleware' | 'tool' | 'workflow';

export interface RunRecord {
  runId: string;
  tenantId: string;
  threadId: string;
  turnId?: string | null;
  parentRunId?: string | null;
  workflowId?: string | null;
  workflowNodeId?: string | null;
  kind: RunKind;
  status: RunStatus;
  title?: string | null;
  caller: RunCaller;
  activeStep?: string | null;
  model?: string | null;
  error?: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  toolCallCount: number;
  modelCallCount: number;
  subagentCount: number;
  middlewareEventCount: number;
  firstHumanMessage?: string | null;
  lastAiMessage?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RunEvent {
  eventId: string;
  runId: string;
  tenantId: string;
  threadId: string;
  turnId?: string | null;
  parentRunId?: string | null;
  workflowId?: string | null;
  workflowNodeId?: string | null;
  sequence: number;
  category: RunKind | 'approval' | 'compaction' | 'rollback' | 'memory';
  type: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  toolName?: string | null;
  model?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRequest {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: 'command' | 'file_write' | 'tool_call' | 'network';
  description: string;
  payload: unknown;
  decision: 'prompt' | 'forbidden';
  justification?: string;
}

export interface ProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  protocol: 'openai' | 'anthropic';
  isLocal: boolean;
  description?: string;
}

export interface ApiKeyState {
  providerId: string;
  envVar: string;
  configured: boolean;
  source: 'env' | 'config' | null;
  masked: string | null;
}

export interface WebProviderPublicConfig {
  firecrawl: {
    configured: boolean;
    source: 'env' | 'config' | null;
    masked: string | null;
    envVar: 'FIRECRAWL_API_KEY';
  };
}

export interface ModelPreset {
  id: string;
  name: string;
  config: Partial<RunConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  source?: 'model' | 'template';
  error?: string;
}

export interface SkillEntry {
  name: string;
  description: string;
  sourcePath: string;
}

export interface BotPlatformConfig {
  enabled: boolean;
}

export type WeixinBridgeMode = 'desktop_managed' | 'external_rpc';
export type DingtalkConnectionMode = 'stream' | 'webhook';

export interface WeixinBotConfig extends BotPlatformConfig {
  bridgeMode: WeixinBridgeMode;
  bridgeUrl: string;
  accountId: string;
  activeThreadId: string;
  autoStartMonitor: boolean;
  syncHistoryOnConnect: boolean;
}

export interface DingtalkBotConfig extends BotPlatformConfig {
  connectionMode: DingtalkConnectionMode;
  clientId: string;
  clientSecret: string;
  robotCode: string;
  cardTemplateId: string;
  targetGroupName: string;
  targetGroupConversationId: string;
  targetGroupSessionWebhook: string;
  lastDetectedGroupConversationId: string;
  lastDetectedGroupSessionWebhook: string;
  lastDetectedGroupAt: string;
  allowedUsers: string[];
  webhookSecret: string;
  activeThreadId: string;
  autoStart: boolean;
}

export interface BotConfig {
  weixin: WeixinBotConfig;
  feishu: BotPlatformConfig;
  dingtalk: DingtalkBotConfig;
  qq: BotPlatformConfig;
}

export interface BotStatus {
  weixin?: {
    enabled?: boolean;
    bridgeMode?: WeixinBridgeMode;
    bridgeUrl?: string;
    connected?: boolean;
    autoStartMonitor?: boolean;
    syncHistoryOnConnect?: boolean;
    bridge?: 'online' | 'offline' | 'unsupported';
    error?: string;
  };
  feishu?: { enabled?: boolean; status?: string };
  dingtalk?: {
    enabled?: boolean;
    connectionMode?: DingtalkConnectionMode;
    configured?: boolean;
    tokenValid?: boolean;
    streamRunning?: boolean;
    robotCode?: string;
    targetGroupConfigured?: boolean;
    targetGroupName?: string;
    targetGroupConversationId?: string;
    targetGroupSessionWebhookConfigured?: boolean;
    lastDetectedGroupConversationId?: string;
    lastDetectedGroupSessionWebhookConfigured?: boolean;
    lastDetectedGroupAt?: string;
    allowedUsersCount?: number;
    autoStart?: boolean;
    error?: string;
  };
  qq?: { enabled?: boolean; status?: string };
}
