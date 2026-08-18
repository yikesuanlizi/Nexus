// 浏览器领域协议 Zod Schema：与 browserTypes.ts 同步，全部 .strict()
// — English: browser domain protocol Zod schemas, synced with browserTypes.ts, all .strict()
import { z } from 'zod';

// ─── 内容来源与可信度 ────────────────────────────────────────────────────────
export const contentProvenanceSchema = z.object({
  trust: z.enum(['trusted', 'untrusted']),
  source: z.enum(['user', 'runtime', 'dom', 'screenshot', 'ocr', 'download', 'tool']),
  origin: z.string().optional(),
  pageId: z.string().optional(),
  observationId: z.string().optional(),
}).strict();

// ─── 页面与观测 ──────────────────────────────────────────────────────────────
export const pageNodeSchema = z.object({
  pageId: z.string().min(1),
  openerPageId: z.string().min(1).optional(),
  openedBy: z.enum(['user', 'agent']).optional(),
  url: z.string().min(1),
  title: z.string(),
  state: z.enum(['active', 'background', 'closed']),
  navigationEpoch: z.number().int().min(0),
}).strict();

export const pageGraphSchema = z.object({
  activePageId: z.string().min(1),
  pages: z.array(pageNodeSchema),
}).strict();

export const interactableElementSchema = z.object({
  ref: z.string().regex(/^\[e\d+\]$/),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  frameId: z.string().min(1),
  visible: z.boolean(),
  enabled: z.boolean(),
  fingerprint: z.string().min(1),
  provenance: contentProvenanceSchema,
}).strict();

export const contentBlockSchema = z.object({
  type: z.enum(['heading', 'paragraph', 'list', 'link', 'table', 'other']),
  text: z.string().min(1),
  href: z.string().optional(),
}).strict();

export const formFieldInfoSchema = z.object({
  name: z.string().min(1),
  fieldType: z.string().optional(),
  required: z.boolean(),
}).strict();

export const formInfoSchema = z.object({
  formId: z.string().min(1),
  action: z.string().optional(),
  method: z.enum(['get', 'post']).optional(),
  fields: z.array(formFieldInfoSchema),
}).strict();

export const networkFailureSchema = z.object({
  resourceUrl: z.string().min(1),
  status: z.number().int().optional(),
  error: z.string().optional(),
}).strict();

export const pageStateFlagsSchema = z.object({
  captchaDetected: z.boolean(),
  authRequired: z.boolean(),
}).strict();

export const observationSchema = z.object({
  observationId: z.string().min(1),
  taskId: z.string().min(1),
  pageId: z.string().min(1),
  navigationEpoch: z.number().int().min(0),
  capturedAt: z.number().int().min(0),
  url: z.string().min(1),
  title: z.string(),
  readiness: z.enum(['stable', 'partial', 'loading']),
  screenshotRef: z.string().optional(),
  elements: z.array(interactableElementSchema),
  mainContent: z.array(contentBlockSchema),
  forms: z.array(formInfoSchema),
  network: z.object({
    pendingRequests: z.number().int().min(0),
    recentFailures: z.array(networkFailureSchema),
  }).strict(),
  pageState: pageStateFlagsSchema,
}).strict();

// ─── 动作意图 ────────────────────────────────────────────────────────────────
export const browserActionKindSchema = z.enum([
  'navigate', 'observe', 'click', 'type', 'select', 'press',
  'scroll', 'screenshot', 'submit', 'download', 'wait',
]);

export const actionEffectSchema = z.enum(['none', 'local', 'external_reversible', 'external_irreversible']);
export const actionRiskSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const postconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('url_contains'), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('url_equals'), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('navigation_epoch_changed') }).strict(),
  z.object({ kind: z.literal('element_appears'), ref: z.string().regex(/^\[e\d+\]$/) }).strict(),
  z.object({ kind: z.literal('element_disappears'), ref: z.string().regex(/^\[e\d+\]$/) }).strict(),
  z.object({ kind: z.literal('element_text_contains'), ref: z.string().regex(/^\[e\d+\]$/), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('download_completed') }).strict(),
]);

export const actionIntentSchema = z.object({
  actionId: z.string().min(1),
  taskId: z.string().min(1),
  pageId: z.string().min(1),
  observationId: z.string().min(1),
  expectedNavigationEpoch: z.number().int().min(0),
  kind: browserActionKindSchema,
  targetRef: z.string().regex(/^\[e\d+\]$/).optional(),
  arguments: z.record(z.string(), z.unknown()),
  rationale: z.string().min(1),
  effect: actionEffectSchema,
  risk: actionRiskSchema,
  postcondition: postconditionSchema,
}).strict();

export const actionGrantSchema = z.object({
  grantId: z.string().min(1),
  taskId: z.string().min(1),
  allowedOrigins: z.array(z.string().min(1)),
  allowedActionKinds: z.array(browserActionKindSchema),
  allowedDataClasses: z.array(z.enum(['public', 'user_input', 'download'])),
  maxExternalWrites: z.number().int().min(0),
  confirmationThreshold: actionRiskSchema,
  expiresAt: z.number().int().min(0),
}).strict();

// ─── 副作用账本 ──────────────────────────────────────────────────────────────
export const actionRecordStatusSchema = z.enum([
  'prepared', 'executing', 'committed', 'uncertain', 'reconciled', 'aborted',
]);

export const actionRecordSchema = z.object({
  actionId: z.string().min(1),
  taskId: z.string().min(1),
  actionDigest: z.string().min(1),
  effect: actionEffectSchema,
  status: actionRecordStatusSchema,
  preState: z.object({
    pageId: z.string().min(1),
    url: z.string().min(1),
    observationId: z.string().min(1),
    navigationEpoch: z.number().int().min(0),
    targetFingerprint: z.string().optional(),
  }).strict(),
  expectedPostcondition: postconditionSchema,
  preparedAt: z.number().int().min(0),
  executedAt: z.number().int().min(0).optional(),
  committedAt: z.number().int().min(0).optional(),
  evidenceRefs: z.array(z.string()),
}).strict();

// ─── 任务状态、预算与等待 ────────────────────────────────────────────────────
export const browserTaskStatusSchema = z.enum([
  'planning', 'running', 'waiting', 'paused',
  'cancelling', 'cancelled', 'failed', 'completed',
]);

export const waitKindSchema = z.enum(['page', 'human', 'event', 'budget']);

export const waitStateSchema = z.object({
  kind: waitKindSchema,
  requestId: z.string().optional(),
  since: z.number().int().min(0),
  deadline: z.number().int().min(0).optional(),
}).strict();

export const planStepSchema = z.object({
  stepId: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
}).strict();

export const taskBudgetSchema = z.object({
  maxSteps: z.number().int().min(0),
  maxTokens: z.number().int().min(0),
  maxReplans: z.number().int().min(0),
  maxConsecutiveFailures: z.number().int().min(0),
  maxDurationMs: z.number().int().min(0),
  maxExternalWrites: z.number().int().min(0),
  maxDownloadBytes: z.number().int().min(0),
}).strict();

export const taskUsageSchema = z.object({
  steps: z.number().int().min(0),
  tokens: z.number().int().min(0),
  replans: z.number().int().min(0),
  consecutiveFailures: z.number().int().min(0),
  externalWrites: z.number().int().min(0),
  downloadBytes: z.number().int().min(0),
  startedAt: z.number().int().min(0),
}).strict();

export const classifiedErrorKindSchema = z.enum([
  'transient', 'element', 'page', 'llm', 'policy', 'budget', 'side_effect', 'cancelled',
]);

export const classifiedErrorSchema = z.object({
  kind: classifiedErrorKindSchema,
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  actionId: z.string().optional(),
}).strict();

export const browserTaskStateSchema = z.object({
  taskId: z.string().min(1),
  goal: z.string().min(1),
  status: browserTaskStatusSchema,
  plan: z.array(planStepSchema),
  currentStepId: z.string().optional(),
  browserSessionId: z.string().optional(),
  activePageId: z.string().optional(),
  wait: waitStateSchema.optional(),
  budget: taskBudgetSchema,
  usage: taskUsageSchema,
  lastCheckpointId: z.string().optional(),
  failure: classifiedErrorSchema.optional(),
}).strict();

// ─── 人工接管 ────────────────────────────────────────────────────────────────
export const humanRequestTypeSchema = z.enum(['confirm', 'input', 'captcha', 'auth', 'choice', 'takeover']);

export const humanRequestSchema = z.object({
  requestId: z.string().min(1),
  taskId: z.string().min(1),
  type: humanRequestTypeSchema,
  prompt: z.string().min(1),
  pageId: z.string().optional(),
  origin: z.string().optional(),
  actionDigest: z.string().optional(),
  fields: z.array(z.object({
    name: z.string().min(1),
    valueSummary: z.string().min(1),
  }).strict()).optional(),
  timeoutMs: z.number().int().min(0),
  onTimeout: z.enum(['abort', 'default_action', 'extend']),
}).strict();

// ─── 任务事件（append-only） ────────────────────────────────────────────────
export const browserTaskEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task.created'),
    taskId: z.string().min(1),
    goal: z.string().min(1),
    createdAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('plan.updated'),
    taskId: z.string().min(1),
    plan: z.array(planStepSchema),
    updatedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('observation.accepted'),
    taskId: z.string().min(1),
    observationId: z.string().min(1),
    pageId: z.string().min(1),
    navigationEpoch: z.number().int().min(0),
    elementCount: z.number().int().min(0),
    acceptedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('action.prepared'),
    taskId: z.string().min(1),
    record: actionRecordSchema,
    preparedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('action.completed'),
    taskId: z.string().min(1),
    actionId: z.string().min(1),
    outcome: z.enum(['committed', 'uncertain', 'failed']),
    evidenceRefs: z.array(z.string()),
    completedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('action.uncertain'),
    taskId: z.string().min(1),
    actionId: z.string().min(1),
    reason: z.string().min(1),
    uncertainAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('human.requested'),
    taskId: z.string().min(1),
    request: humanRequestSchema,
  }).strict(),
  z.object({
    type: z.literal('human.resolved'),
    taskId: z.string().min(1),
    requestId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
    resolvedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('budget.updated'),
    taskId: z.string().min(1),
    usage: taskUsageSchema,
    updatedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('task.paused'),
    taskId: z.string().min(1),
    reason: z.string().optional(),
    pausedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('task.cancelled'),
    taskId: z.string().min(1),
    reason: z.string().optional(),
    cancelledAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('task.failed'),
    taskId: z.string().min(1),
    failure: classifiedErrorSchema,
    failedAt: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('task.completed'),
    taskId: z.string().min(1),
    summary: z.string().optional(),
    completedAt: z.string().min(1),
  }).strict(),
]);
