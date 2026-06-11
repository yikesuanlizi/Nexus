import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────
export const threadIdSchema = z.string().min(1);
export const turnIdSchema = z.string().min(1);
export const itemIdSchema = z.string().min(1);

// ─── Thread ──────────────────────────────────────────────────────────────────
export const threadStatusSchema = z.enum(['active', 'archived', 'compacted']);

export const threadMetaSchema = z.object({
  threadId: threadIdSchema,
  title: z.string(),
  workspaceRoot: z.string(),
  status: threadStatusSchema,
  turnCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  ephemeral: z.boolean(),
  tags: z.record(z.string(), z.string()),
  parentThreadId: threadIdSchema.nullable().optional(),
  agentNickname: z.string().nullable().optional(),
  agentRole: z.string().nullable().optional(),
});

export const threadSpawnEdgeStatusSchema = z.enum(['open', 'closed']);

export const threadSpawnEdgeSchema = z.object({
  parentThreadId: threadIdSchema,
  childThreadId: threadIdSchema,
  status: threadSpawnEdgeStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── Turn ────────────────────────────────────────────────────────────────────
export const turnStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']);

export const textInputSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  modeInstruction: z.string().optional(),
});

export const inputPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['low', 'high']).optional(),
    }),
  }),
  z.object({ type: z.literal('image_path'), path: z.string() }),
]);

export const multimodalInputSchema = z.object({
  type: z.literal('multimodal'),
  parts: z.array(inputPartSchema),
  modeInstruction: z.string().optional(),
});

export const userInputSchema = z.discriminatedUnion('type', [
  textInputSchema,
  multimodalInputSchema,
]);

export const turnMetaSchema = z.object({
  turnId: turnIdSchema,
  threadId: threadIdSchema,
  index: z.number().int().min(0),
  userInput: userInputSchema,
  status: turnStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

// ─── Items ───────────────────────────────────────────────────────────────────
export const commandStatusSchema = z.enum(['in_progress', 'completed', 'failed']);
export const patchApplyStatusSchema = z.enum(['completed', 'failed']);
export const patchChangeKindSchema = z.enum(['add', 'delete', 'update']);

export const artifactRefSchema = z.object({
  kind: z.enum(['file_segment', 'tool_result', 'mcp_result']),
  path: z.string().optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  sha256: z.string().optional(),
  excerpt: z.string().optional(),
  sourceToolCallId: itemIdSchema.optional(),
});

export const fileChangeHunkSchema = z.object({
  path: z.string(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  addedLines: z.number().int().min(0),
  removedLines: z.number().int().min(0),
  summary: z.string().optional(),
});

export const fileUpdateChangeSchema = z.object({
  path: z.string(),
  kind: patchChangeKindSchema,
  hunks: z.array(fileChangeHunkSchema).optional(),
  addedLines: z.number().int().min(0).optional(),
  removedLines: z.number().int().min(0).optional(),
  summary: z.string().optional(),
});

export const todoItemEntrySchema = z.object({
  text: z.string(),
  completed: z.boolean(),
});

export const agentMessageItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('agent_message'),
  turnId: turnIdSchema,
  text: z.string(),
  structuredOutput: z.unknown().optional(),
  timestamp: z.string().optional(),
});

export const userMessageItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('user_message'),
  turnId: turnIdSchema,
  text: z.string(),
  timestamp: z.string().optional(),
});

export const reasoningItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('reasoning'),
  turnId: turnIdSchema,
  text: z.string(),
  timestamp: z.string().optional(),
});

export const commandExecutionItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('command_execution'),
  turnId: turnIdSchema,
  command: z.string(),
  aggregatedOutput: z.string(),
  exitCode: z.number().nullable(),
  status: commandStatusSchema,
  timestamp: z.string().optional(),
});

export const fileChangeItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('file_change'),
  turnId: turnIdSchema,
  changes: z.array(fileUpdateChangeSchema),
  hunks: z.array(fileChangeHunkSchema).optional(),
  summary: z.string().optional(),
  status: patchApplyStatusSchema,
  timestamp: z.string().optional(),
});

export const compactionSummarySchema = z.object({
  userGoal: z.string(),
  completedWork: z.string(),
  keyConstraints: z.string(),
  filesAndArtifacts: z.string(),
  toolResults: z.string(),
  subagentResults: z.string(),
  openTasks: z.string(),
  risks: z.string(),
  raw: z.string(),
});

export const compactionStrategySchema = z.enum(['llm', 'local']);

export const compactedRangeSchema = z.object({
  compactedTurnIds: z.array(turnIdSchema),
  retainedTurnIds: z.array(turnIdSchema),
  compactionItemId: itemIdSchema,
  summary: z.string(),
  tokensBefore: z.number().int().min(0),
  tokensAfter: z.number().int().min(0),
  createdAt: z.string(),
  trigger: z.enum(['manual', 'auto']),
  strategy: compactionStrategySchema,
});

export const contextCompactionItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('context_compaction'),
  turnId: turnIdSchema,
  status: commandStatusSchema,
  trigger: z.enum(['manual', 'auto']),
  compactedTurnIds: z.array(turnIdSchema),
  retainedTurnIds: z.array(turnIdSchema),
  summary: compactionSummarySchema.optional(),
  tokensBefore: z.number().int().min(0),
  tokensAfter: z.number().int().min(0),
  error: z.object({ message: z.string() }).optional(),
  timestamp: z.string().optional(),
});

export const toolCallItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('tool_call'),
  turnId: turnIdSchema,
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  status: commandStatusSchema,
  timestamp: z.string().optional(),
});

export const collabToolCallItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('collab_tool_call'),
  turnId: turnIdSchema,
  tool: z.enum(['spawn_agent', 'send_input', 'resume_agent', 'wait', 'close_agent']),
  status: commandStatusSchema,
  senderThreadId: threadIdSchema,
  receiverThreadId: threadIdSchema.optional(),
  newThreadId: threadIdSchema.optional(),
  prompt: z.string().optional(),
  agentStatus: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  timestamp: z.string().optional(),
});

export const mcpToolCallItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('mcp_tool_call'),
  turnId: turnIdSchema,
  server: z.string(),
  tool: z.string(),
  arguments: z.unknown(),
  result: z
    .object({
      content: z.array(z.unknown()),
      structuredContent: z.unknown(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
  status: commandStatusSchema,
  timestamp: z.string().optional(),
});

export const webSearchItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('web_search'),
  turnId: turnIdSchema,
  query: z.string(),
  timestamp: z.string().optional(),
});

export const todoListItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('todo_list'),
  turnId: turnIdSchema,
  items: z.array(todoItemEntrySchema),
  timestamp: z.string().optional(),
});

export const errorItemSchema = z.object({
  id: itemIdSchema,
  type: z.literal('error'),
  turnId: turnIdSchema,
  message: z.string(),
  timestamp: z.string().optional(),
});

export const threadItemSchema = z.discriminatedUnion('type', [
  userMessageItemSchema,
  agentMessageItemSchema,
  reasoningItemSchema,
  commandExecutionItemSchema,
  fileChangeItemSchema,
  contextCompactionItemSchema,
  toolCallItemSchema,
  collabToolCallItemSchema,
  mcpToolCallItemSchema,
  webSearchItemSchema,
  todoListItemSchema,
  errorItemSchema,
]);

// ─── Events ──────────────────────────────────────────────────────────────────
export const usageSchema = z.object({
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningOutputTokens: z.number().int().min(0),
  cacheStrategy: z.enum(['deepseek-native', 'openai-compatible', 'anthropic-cache-control', 'mixed']).optional(),
});

export const turnUsageSchema = z.object({
  turnId: turnIdSchema,
  usage: usageSchema,
  timestamp: z.string(),
});

export const threadUsageSchema = z.object({
  threadId: threadIdSchema,
  total: usageSchema,
  turns: z.array(turnUsageSchema),
  updatedAt: z.string(),
  includedThreadIds: z.array(threadIdSchema).optional(),
});

const baseThreadEvent = z.object({
  threadId: threadIdSchema,
  turnId: turnIdSchema.optional(),
});

export const threadStartedEventSchema = z.object({
  type: z.literal('thread.started'),
  threadId: threadIdSchema,
  thread: threadMetaSchema,
});

export const turnStartedEventSchema = z.object({
  type: z.literal('turn.started'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  turnIndex: z.number().int().min(0),
});

export const turnCompletedEventSchema = z.object({
  type: z.literal('turn.completed'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  usage: usageSchema.nullable(),
  status: z.enum(['completed', 'interrupted']).optional(),
});

export const turnFailedEventSchema = z.object({
  type: z.literal('turn.failed'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  error: z.object({ message: z.string() }),
});

export const itemStartedEventSchema = z.object({
  type: z.literal('item.started'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  item: threadItemSchema,
});

export const itemUpdatedEventSchema = z.object({
  type: z.literal('item.updated'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  item: threadItemSchema,
});

export const itemCompletedEventSchema = z.object({
  type: z.literal('item.completed'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  item: threadItemSchema,
});

export const agentMessageDeltaEventSchema = z.object({
  type: z.literal('agent_message.delta'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  itemId: itemIdSchema,
  delta: z.string(),
});

export const commandOutputDeltaEventSchema = z.object({
  type: z.literal('command_output.delta'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  itemId: itemIdSchema,
  delta: z.string(),
});

export const tokenUsageUpdatedEventSchema = z.object({
  type: z.literal('thread.token_usage.updated'),
  threadId: threadIdSchema,
  usage: threadUsageSchema,
});

export const turnDiffUpdatedEventSchema = z.object({
  type: z.literal('turn.diff.updated'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  diff: z.string(),
});

export const childAgentEventSchema = z.object({
  type: z.literal('child_agent.event'),
  threadId: threadIdSchema,
  childThreadId: threadIdSchema,
  agentNickname: z.string().nullable().optional(),
  agentRole: z.string().nullable().optional(),
  event: z.record(z.string(), z.unknown()),
});

export const cacheDiagnosticsEventSchema = z.object({
  type: z.literal('cache.diagnostics'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  shape: z.object({
    systemHash: z.string(),
    toolsHash: z.string(),
    prefixHash: z.string(),
  }),
  stable: z.boolean(),
  reasons: z.array(z.enum(['system', 'tools'])),
});

export const modelRetryEventSchema = z.object({
  type: z.literal('model.retry'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  status: z.number().int().optional(),
  error: z.string().optional(),
});

export const contextTokenEstimateUpdatedEventSchema = z.object({
  type: z.literal('context.token_estimate.updated'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  estimate: z.object({
    inputTokens: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    charCount: z.number().int().nonnegative(),
  }),
});

export const contextCompactionPressureEventSchema = z.object({
  type: z.literal('context.compaction_pressure'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  pressure: z.object({
    estimatedTokens: z.number().nonnegative(),
    maxTokens: z.number().nonnegative(),
    softThreshold: z.number().nonnegative(),
    hardThreshold: z.number().nonnegative(),
    ratio: z.number().nonnegative(),
    status: z.enum(['ok', 'soft', 'hard']),
  }),
});

export const approvalResolvedEventSchema = z.object({
  type: z.literal('approval.resolved'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  requestId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
  status: z.enum(['approved', 'denied', 'timeout']),
});

export const approvalRequiredEventSchema = z.object({
  type: z.literal('approval.required'),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  itemId: itemIdSchema,
  requestId: z.string(),
  kind: z.enum(['command', 'file_write', 'tool_call', 'network']),
  description: z.string(),
  payload: z.unknown(),
  decision: z.enum(['prompt', 'forbidden']),
  justification: z.string().optional(),
});

export const compactedEventSchema = z.object({
  type: z.literal('thread.compacted'),
  threadId: threadIdSchema,
  compactedTurns: z.number().int().min(0),
  tokensBefore: z.number().int().min(0),
  tokensAfter: z.number().int().min(0),
});

export const resumedEventSchema = z.object({
  type: z.literal('thread.resumed'),
  threadId: threadIdSchema,
  turnIndex: z.number().int().min(0),
});

export const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const threadEventSchema = z.discriminatedUnion('type', [
  threadStartedEventSchema,
  turnStartedEventSchema,
  turnCompletedEventSchema,
  turnFailedEventSchema,
  itemStartedEventSchema,
  itemUpdatedEventSchema,
  itemCompletedEventSchema,
  agentMessageDeltaEventSchema,
  commandOutputDeltaEventSchema,
  tokenUsageUpdatedEventSchema,
  turnDiffUpdatedEventSchema,
  childAgentEventSchema,
  cacheDiagnosticsEventSchema,
  modelRetryEventSchema,
  contextTokenEstimateUpdatedEventSchema,
  contextCompactionPressureEventSchema,
  approvalResolvedEventSchema,
  approvalRequiredEventSchema,
  compactedEventSchema,
  resumedEventSchema,
  errorEventSchema,
]);

// ─── JSON-RPC ────────────────────────────────────────────────────────────────
export const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});

export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: jsonRpcErrorSchema.optional(),
});

export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const jsonRpcMessageSchema = z.discriminatedUnion('method', [
  jsonRpcRequestSchema,
  jsonRpcNotificationSchema,
]);

// ─── Approval ────────────────────────────────────────────────────────────────
export const approvalRequestSchema = z.object({
  requestId: z.string(),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  itemId: itemIdSchema,
  kind: z.enum(['command', 'file_write', 'tool_call', 'network']),
  description: z.string(),
  payload: z.unknown(),
  decision: z.enum(['prompt', 'forbidden']),
  justification: z.string().optional(),
});

export const checkpointStatusSchema = z.enum(['running', 'completed', 'interrupted', 'failed', 'stale']);

export const approvalResponseSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});
