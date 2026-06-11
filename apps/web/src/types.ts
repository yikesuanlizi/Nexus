import type { RunConfig } from './config.js';
import type { EventDraft } from './threadView.js';

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
  status: 'disabled' | 'starting' | 'running' | 'failed' | 'dead';
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

export interface WeixinBotConfig extends BotPlatformConfig {
  bridgeUrl: string;
  accountId: string;
  activeThreadId: string;
}

export interface BotConfig {
  weixin: WeixinBotConfig;
  feishu: BotPlatformConfig;
  dingtalk: BotPlatformConfig;
  qq: BotPlatformConfig;
}

export interface BotStatus {
  weixin?: {
    enabled?: boolean;
    bridgeUrl?: string;
    connected?: boolean;
    bridge?: 'online' | 'offline';
    error?: string;
  };
  feishu?: { enabled?: boolean; status?: string };
  dingtalk?: { enabled?: boolean; status?: string };
  qq?: { enabled?: boolean; status?: string };
}
