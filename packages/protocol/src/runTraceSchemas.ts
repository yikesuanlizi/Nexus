// RunTrace V2 Zod schema：与 TypeScript union 同步，payload 使用 .strict()
// — English: RunTrace V2 Zod schema — synced with TS union, payload uses .strict()
import { z } from 'zod';
import { RUN_TRACE_VERSION } from './runTrace.js';
import { threadItemSchema, checkpointStatusSchema } from './schemas.js';

// ─── 基础枚举 ────────────────────────────────────────────────────────────────
export const runTraceLevelSchema = z.enum(['debug', 'info', 'warning', 'error']);
export const runTraceLifecycleSchema = z.enum(['instant', 'started', 'completed', 'failed', 'discarded']);
export const runTraceCategorySchema = z.enum([
  'turn', 'iteration', 'context', 'memory', 'middleware',
  'model', 'tool', 'item', 'agent', 'file',
  'checkpoint', 'evidence', 'error', 'control',
]);
export const runTraceRunKindSchema = z.enum(['turn', 'control', 'workflow', 'subagent']);

// ─── Payload schemas（每个都 .strict()，禁止未知字段绕过） ─────────────────
// — English: payload schemas (.strict() — unknown fields rejected)
const turnPayloadSchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'interrupted']).optional(),
  inputItemCount: z.number().int().min(0).optional(),
  reason: z.string().optional(),
}).strict();

const iterationPayloadSchema = z.object({
  index: z.number().int().min(0),
  outcome: z.string().optional(),
}).strict();

const contextPayloadSchema = z.object({
  phase: z.enum(['assembled', 'compacted', 'pressured']),
  sourceCounts: z.record(z.string(), z.number().int().min(0)),
  estimatedTokens: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  omittedContent: z.literal(true),
}).strict();

const memoryPayloadSchema = z.object({
  phase: z.enum(['search', 'inject', 'write']),
  recordCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  queryHash: z.string().optional(),
  scoreBuckets: z.record(z.string(), z.number().int().min(0)).optional(),
  omittedContent: z.literal(true),
}).strict();

const middlewarePayloadSchema = z.object({
  middlewareId: z.string().min(1),
  stage: z.enum(['before', 'after', 'error']),
  attempt: z.number().int().min(0).optional(),
}).strict();

const modelPayloadSchema = z.object({
  provider: z.string().min(1),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1),
  endpointFormat: z.string().min(1).optional(),
  transport: z.string().min(1).optional(),
  reasoningMode: z.string().min(1).optional(),
  toolHistoryMode: z.string().min(1).optional(),
  attempt: z.number().int().min(0),
  streaming: z.boolean(),
  ttftMs: z.number().int().min(0).optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  cacheReadTokens: z.number().int().min(0).optional(),
  cacheWriteTokens: z.number().int().min(0).optional(),
  finishReason: z.string().optional(),
}).strict();

const toolPayloadSchema = z.object({
  toolName: z.string().min(1),
  callId: z.string().min(1),
  decision: z.enum(['allow', 'deny', 'approval_required']).optional(),
  approvalId: z.string().optional(),
  argsSummary: z.unknown().optional(),
  resultSummary: z.unknown().optional(),
  exitCode: z.number().int().optional(),
  outputBytes: z.number().int().min(0).optional(),
}).strict();

// itemType 来自 ThreadItem['type'] 的 16 个 union member
// — English: itemType mirrors the 16 union members of ThreadItem['type']
const itemPayloadSchema = z.object({
  itemType: z.enum([
    'user_message', 'agent_message', 'reasoning', 'command_execution',
    'file_change', 'workflow_checkpoint', 'project_checkpoint', 'rollback_conflict',
    'context_compaction', 'tool_call', 'collab_tool_call', 'mcp_tool_call',
    'web_search', 'todo_list', 'error', 'harness_continuation',
  ]),
  status: z.string().optional(),
}).strict();

const agentPayloadSchema = z.object({
  agentThreadId: z.string().min(1),
  role: z.string().min(1),
  action: z.enum(['spawn', 'started', 'joined', 'failed', 'interrupted']),
  childRunId: z.string().optional(),
}).strict();

const filePayloadSchema = z.object({
  action: z.enum(['read', 'write', 'patch', 'delete', 'checkpoint']),
  path: z.string().min(1),
  addedLines: z.number().int().min(0).optional(),
  removedLines: z.number().int().min(0).optional(),
}).strict();

const checkpointPayloadSchema = z.object({
  checkpointId: z.string().min(1),
  turnCount: z.number().int().min(0),
  itemIndex: z.number().int().min(0),
  status: checkpointStatusSchema,
}).strict();

const evidencePayloadSchema = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  passed: z.boolean().optional(),
}).strict();

const errorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  source: z.string().optional(),
}).strict();

const controlPayloadSchema = z.object({
  action: z.enum(['interrupt', 'resume', 'rollback']),
  outcome: z.enum(['requested', 'accepted', 'rejected', 'completed']),
  checkpointId: z.string().optional(),
  reason: z.string().optional(),
}).strict();

// ─── Payload schema 映射（与 RunTracePayloadMap 同步） ─────────────────────
// — English: payload schema map synced with RunTracePayloadMap
export const runTracePayloadSchemaMap = {
  turn: turnPayloadSchema,
  iteration: iterationPayloadSchema,
  context: contextPayloadSchema,
  memory: memoryPayloadSchema,
  middleware: middlewarePayloadSchema,
  model: modelPayloadSchema,
  tool: toolPayloadSchema,
  item: itemPayloadSchema,
  agent: agentPayloadSchema,
  file: filePayloadSchema,
  checkpoint: checkpointPayloadSchema,
  evidence: evidencePayloadSchema,
  error: errorPayloadSchema,
  control: controlPayloadSchema,
} as const;

// ─── Envelope 基础字段 ─────────────────────────────────────────────────────
// — English: envelope common fields
const runTraceBaseFields = {
  version: z.literal(RUN_TRACE_VERSION),
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  runId: z.string().min(1),
  parentRunId: z.string().min(1).optional(),
  runKind: runTraceRunKindSchema,
  threadId: z.string().min(1),
  turnId: z.string().min(1).nullable().optional(),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  name: z.string().min(1),
  lifecycle: runTraceLifecycleSchema,
  level: runTraceLevelSchema,
  occurredAt: z.string().min(1),
  durationMs: z.number().int().min(0).optional(),
};

// ─── 各 category 的 envelope schema ─────────────────────────────────────────
// — English: per-category envelope schema
const turnEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('turn'),
  payload: turnPayloadSchema,
}).strict();

const iterationEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('iteration'),
  payload: iterationPayloadSchema,
}).strict();

const contextEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('context'),
  payload: contextPayloadSchema,
}).strict();

const memoryEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('memory'),
  payload: memoryPayloadSchema,
}).strict();

const middlewareEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('middleware'),
  payload: middlewarePayloadSchema,
}).strict();

const modelEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('model'),
  payload: modelPayloadSchema,
}).strict();

const toolEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('tool'),
  payload: toolPayloadSchema,
}).strict();

const itemEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('item'),
  payload: itemPayloadSchema,
}).strict();

const agentEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('agent'),
  payload: agentPayloadSchema,
}).strict();

const fileEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('file'),
  payload: filePayloadSchema,
}).strict();

const checkpointEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('checkpoint'),
  payload: checkpointPayloadSchema,
}).strict();

const evidenceEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('evidence'),
  payload: evidencePayloadSchema,
}).strict();

const errorEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('error'),
  payload: errorPayloadSchema,
}).strict();

const controlEnvelopeSchema = z.object({
  ...runTraceBaseFields,
  category: z.literal('control'),
  payload: controlPayloadSchema,
}).strict();

// 14 个 envelope variant 的有序数组，用于构造 union 和派生 draft/observation
// — English: ordered array of 14 envelope variants for union / draft / observation derivation
const envelopeVariants = [
  turnEnvelopeSchema,
  iterationEnvelopeSchema,
  contextEnvelopeSchema,
  memoryEnvelopeSchema,
  middlewareEnvelopeSchema,
  modelEnvelopeSchema,
  toolEnvelopeSchema,
  itemEnvelopeSchema,
  agentEnvelopeSchema,
  fileEnvelopeSchema,
  checkpointEnvelopeSchema,
  evidenceEnvelopeSchema,
  errorEnvelopeSchema,
  controlEnvelopeSchema,
] as const;

// envelope 级别的关联性 refine（lifecycle × durationMs、item × itemId、runKind=turn × turnId）
// — English: envelope-level correlation refinement
// 使用宽松的输入类型，避免依赖具体的 envelope variant 类型导致 category 被窄化为字面量
// — English: use a loose input type to avoid category being narrowed to a literal
type EnvelopeRefineInput = {
  durationMs?: number;
  lifecycle: string;
  category: string;
  itemId?: string;
  runKind: string;
  turnId?: string | null;
};

function refineRunTraceEnvelope(value: EnvelopeRefineInput, ctx: z.RefinementCtx): void {
  // lifecycle=completed|failed 时允许 durationMs；其它 lifecycle 不应携带 durationMs
  // — English: durationMs is only allowed when lifecycle is completed/failed
  if (value.durationMs !== undefined && value.lifecycle !== 'completed' && value.lifecycle !== 'failed') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `durationMs is only allowed for lifecycle=completed|failed, got lifecycle=${value.lifecycle}`,
      path: ['durationMs'],
    });
  }
  // category=item 必须带 itemId
  // — English: events with category=item must carry itemId
  if (value.category === 'item' && (value.itemId === undefined || value.itemId === null || value.itemId === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'itemId is required for category=item events',
      path: ['itemId'],
    });
  }
  // runKind=turn 必须有 turnId（非 null、非 undefined）
  // — English: turn runs must have a non-null turnId
  if (value.runKind === 'turn' && (value.turnId === undefined || value.turnId === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'turnId is required for runKind=turn',
      path: ['turnId'],
    });
  }
}

// ─── Envelope 联合（按 category 判别）+ 关联性 refine ──────────────────────
// — English: envelope union discriminated by category, plus correlation refinement
const runTraceEnvelopeSchemaBase = z.discriminatedUnion('category', envelopeVariants);

export const runTraceEnvelopeSchema = runTraceEnvelopeSchemaBase.superRefine(refineRunTraceEnvelope);

// 导出每条分支 schema 以便单独测试
// — English: export each branch schema for targeted testing
export const runTraceEnvelopeSchemasByCategory = {
  turn: turnEnvelopeSchema,
  iteration: iterationEnvelopeSchema,
  context: contextEnvelopeSchema,
  memory: memoryEnvelopeSchema,
  middleware: middlewareEnvelopeSchema,
  model: modelEnvelopeSchema,
  tool: toolEnvelopeSchema,
  item: itemEnvelopeSchema,
  agent: agentEnvelopeSchema,
  file: fileEnvelopeSchema,
  checkpoint: checkpointEnvelopeSchema,
  evidence: evidenceEnvelopeSchema,
  error: errorEnvelopeSchema,
  control: controlEnvelopeSchema,
} as const;

// ─── 派生 schema：Draft / Observation ───────────────────────────────────────
// 对每个 variant 调用 .omit() 移除 storage identity 字段或 run context 字段，
// 然后重新构造 discriminated union。
// — English: derive Draft / Observation schemas by .omit()-ing fields from each variant.
// 注意：.omit() 返回 ZodObject，但 .map() 产生数组而非元组；z.discriminatedUnion 需要元组类型，
// 因此需要类型断言。运行时行为正确，仅 TypeScript 元组匹配需要 as never。
// — English: .omit() returns ZodObject, but .map() produces an array not a tuple;
// z.discriminatedUnion requires a tuple type, hence the type assertion.
const storageIdentityOmit = { eventId: true, sequence: true, version: true } as const;
const runContextOmit = { runId: true, parentRunId: true, threadId: true, turnId: true } as const;

const draftVariants = envelopeVariants.map((variant) => variant.omit(storageIdentityOmit));

const observationVariants = draftVariants.map((variant) => variant.omit(runContextOmit));

// Draft schema：保持 category 判别 + envelope 关联性 refine（runKind=turn 仍要求 turnId）
// — English: draft schema — keeps category discrimination + envelope correlation refinement
const runTraceDraftSchemaBase = z.discriminatedUnion('category', draftVariants as never);

export const runTraceDraftSchema = runTraceDraftSchemaBase.superRefine(refineRunTraceEnvelope);

// Observation schema：去掉了 run context（runId/parentRunId/threadId/turnId），所以不再做 turnId refine；
// observation 仍保留 runKind，但因为没有 turnId，不做 runKind=turn × turnId 校验。
// 仍校验 lifecycle × durationMs 与 category=item × itemId 关联。
// — English: observation schema — run context removed (runId/parentRunId/threadId/turnId), so turnId refinement is skipped;
// observation still has runKind, but without turnId we can't enforce runKind=turn × turnId.
// Still validates lifecycle × durationMs and category=item × itemId correlation.
const runTraceObservationSchemaBase = z.discriminatedUnion('category', observationVariants as never);

// observation refine 输入类型：与 envelope refine 相同的宽松类型，但不含 turnId
// — English: observation refine input type — same loose type as envelope refine but without turnId
type ObservationRefineInput = {
  durationMs?: number;
  lifecycle: string;
  category: string;
  itemId?: string;
};

function refineRunTraceObservation(value: ObservationRefineInput, ctx: z.RefinementCtx): void {
  // observation 没有 turnId/runId/threadId；只保留 lifecycle + itemId 关联
  // — English: observation lacks turnId/runId/threadId; only lifecycle + itemId refinements remain
  if (value.durationMs !== undefined && value.lifecycle !== 'completed' && value.lifecycle !== 'failed') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `durationMs is only allowed for lifecycle=completed|failed, got lifecycle=${value.lifecycle}`,
      path: ['durationMs'],
    });
  }
  if (value.category === 'item' && (value.itemId === undefined || value.itemId === null || value.itemId === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'itemId is required for category=item events',
      path: ['itemId'],
    });
  }
}

export const runTraceObservationSchema = runTraceObservationSchemaBase.superRefine(refineRunTraceObservation);

// ─── RunTracePage schema ─────────────────────────────────────────────────────
// — English: RunTracePage schema
export const runTracePageSchema = z.object({
  events: z.array(runTraceEnvelopeSchema),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
  nextBefore: z.number().int().positive().optional(),
  nextAfter: z.number().int().positive().optional(),
}).strict();

// ─── RunTraceSummary schema ─────────────────────────────────────────────────
// — English: RunTraceSummary schema
export const runTraceStatusSchema = z.enum([
  'pending', 'running', 'completed', 'failed', 'interrupted', 'blocked',
]);

export const runTraceSummarySchema = z.object({
  status: runTraceStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().min(0).optional(),
  currentSpan: z.object({
    spanId: z.string().min(1),
    category: runTraceCategorySchema,
    name: z.string().min(1),
  }).optional(),
  model: z.object({
    calls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0),
    cacheWriteTokens: z.number().int().min(0),
    maxTtftMs: z.number().int().min(0).optional(),
    providerId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    endpointFormat: z.string().min(1).optional(),
    transport: z.string().min(1).optional(),
    reasoningMode: z.string().min(1).optional(),
    toolHistoryMode: z.string().min(1).optional(),
  }),
  tools: z.object({
    calls: z.number().int().min(0),
    failed: z.number().int().min(0),
    denied: z.number().int().min(0),
  }),
  items: z.object({
    started: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    byType: z.record(z.string(), z.number().int().min(0)),
  }),
  agents: z.object({
    spawned: z.number().int().min(0),
    running: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  files: z.object({
    changed: z.number().int().min(0),
    addedLines: z.number().int().min(0),
    removedLines: z.number().int().min(0),
  }),
  lastError: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
  lastCheckpointId: z.string().optional(),
}).strict();

// 引用 threadItemSchema 以保留对 ThreadItem union 的 schema 关联
// — English: reference threadItemSchema to keep schema tied to ThreadItem union
export const _threadItemSchemaRef = threadItemSchema;
