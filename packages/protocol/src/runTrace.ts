// RunTrace V2 协议：定义 correlated envelope 与派生类型
// — English: RunTrace V2 protocol — correlated envelope and derived types
import type { ThreadId, TurnId, ThreadItem, CheckpointStatus } from './types.js';

export const RUN_TRACE_VERSION = 2 as const;

export type RunTraceLevel = 'debug' | 'info' | 'warning' | 'error';
export type RunTraceLifecycle = 'instant' | 'started' | 'completed' | 'failed' | 'discarded';
export type RunTraceCategory =
  | 'turn' | 'iteration' | 'context' | 'memory' | 'middleware'
  | 'model' | 'tool' | 'item' | 'agent' | 'file'
  | 'checkpoint' | 'evidence' | 'error' | 'control';
export type RunTraceRunKind = 'turn' | 'control' | 'workflow' | 'subagent';

export interface RunTracePayloadMap {
  turn: { status?: 'running' | 'completed' | 'failed' | 'interrupted'; inputItemCount?: number; reason?: string };
  iteration: { index: number; outcome?: string };
  context: { phase: 'assembled' | 'compacted' | 'pressured'; sourceCounts: Record<string, number>; estimatedTokens?: number; durationMs?: number; omittedContent: true };
  memory: { phase: 'search' | 'inject' | 'write'; recordCount: number; durationMs?: number; queryHash?: string; scoreBuckets?: Record<string, number>; omittedContent: true };
  middleware: { middlewareId: string; stage: 'before' | 'after' | 'error'; attempt?: number };
  model: {
    provider: string;
    providerId?: string;
    model: string;
    endpointFormat?: string;
    transport?: string;
    reasoningMode?: string;
    toolHistoryMode?: string;
    attempt: number;
    streaming: boolean;
    ttftMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    finishReason?: string;
  };
  tool: {
    toolName: string;
    callId: string;
    resourceKind?: 'tool' | 'mcp' | 'skill' | 'shell' | 'agent';
    server?: string;
    tool?: string;
    skillName?: string;
    decision?: 'allow' | 'deny' | 'approval_required';
    approvalId?: string;
    argsSummary?: unknown;
    resultSummary?: unknown;
    exitCode?: number;
    outputBytes?: number;
  };
  item: { itemType: ThreadItem['type']; status?: string };
  agent: { agentThreadId: ThreadId; role: string; action: 'spawn' | 'started' | 'joined' | 'failed' | 'interrupted'; childRunId?: string };
  file: {
    action: 'read' | 'write' | 'patch' | 'delete' | 'checkpoint' | 'extract' | 'stale' | 'refresh' | 'reuse';
    path: string;
    sourcePath?: string;
    artifactPath?: string;
    sha256?: string;
    artifactSha256?: string;
    staleReason?: string;
    contentType?: string;
    extractor?: string;
    addedLines?: number;
    removedLines?: number;
  };
  checkpoint: { checkpointId: string; turnCount: number; itemIndex: number; status: CheckpointStatus };
  evidence: { kind: string; label: string; passed?: boolean };
  error: { code: string; message: string; retryable: boolean; source?: string };
  control: { action: 'interrupt' | 'resume' | 'rollback'; outcome: 'requested' | 'accepted' | 'rejected' | 'completed'; checkpointId?: string; reason?: string };
}

interface RunTraceBase<C extends RunTraceCategory> {
  version: typeof RUN_TRACE_VERSION;
  eventId: string;
  sequence: number;
  runId: string;
  parentRunId?: string;
  runKind: RunTraceRunKind;
  threadId: ThreadId;
  turnId?: TurnId | null;
  spanId: string;
  parentSpanId?: string;
  itemId?: string;
  category: C;
  name: string;
  lifecycle: RunTraceLifecycle;
  level: RunTraceLevel;
  occurredAt: string;
  durationMs?: number;
  payload: RunTracePayloadMap[C];
}

export type RunTraceEnvelope = {
  [C in RunTraceCategory]: RunTraceBase<C>
}[RunTraceCategory];

type WithoutStorageIdentity<T> = T extends unknown
  ? Omit<T, 'eventId' | 'sequence' | 'version'>
  : never;

export type RunTraceDraft = WithoutStorageIdentity<RunTraceEnvelope>;

type WithoutRunContext<T> = T extends unknown
  ? Omit<T, 'runId' | 'parentRunId' | 'threadId' | 'turnId'>
  : never;

export type RunTraceObservation = WithoutRunContext<RunTraceDraft>;

export interface RunTracePage {
  events: RunTraceEnvelope[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  nextBefore?: number;
  nextAfter?: number;
}

export type RunTraceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'blocked';

export interface RunTraceSummary {
  status: RunTraceStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  currentSpan?: { spanId: string; category: RunTraceCategory; name: string };
  model: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    maxTtftMs?: number;
    providerId?: string;
    model?: string;
    endpointFormat?: string;
    transport?: string;
    reasoningMode?: string;
    toolHistoryMode?: string;
  };
  tools: { calls: number; failed: number; denied: number };
  items: { started: number; completed: number; failed: number; byType: Record<string, number> };
  agents: { spawned: number; running: number; failed: number };
  files: {
    reads: number;
    changed: number;
    addedLines: number;
    removedLines: number;
    extracted: number;
    reused: number;
    stale: number;
    refreshed: number;
  };
  lastError?: { code: string; message: string };
  lastCheckpointId?: string;
}
