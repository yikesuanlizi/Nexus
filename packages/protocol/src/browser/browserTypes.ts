// 浏览器领域协议：观测、元素引用、动作意图、副作用账本、任务状态与事件
// — English: browser domain protocol — observation, element refs, action intents,
//   side-effect ledger, task state and append-only task events
// 设计依据：docs 中的《生产级 Agent 浏览器运行时架构设计详解》
// 本模块只声明领域协议（类型 + schema），不包含任何 Playwright / DOM 实现。

// ─── 内容来源与可信度 ────────────────────────────────────────────────────────
// 页面内容、截图、OCR、下载文件与第三方工具结果一律视为不可信数据。
// — English: page content, screenshots, OCR, downloads and third-party tool
//   results are always untrusted data.
export interface ContentProvenance {
  trust: 'trusted' | 'untrusted';
  source: 'user' | 'runtime' | 'dom' | 'screenshot' | 'ocr' | 'download' | 'tool';
  origin?: string;
  pageId?: string;
  observationId?: string;
}

// ─── 页面与观测 ──────────────────────────────────────────────────────────────
// 即使首期以单活跃页面为主，也使用 pageId 标识页面，为 popup 与多标签页保留协议。
// — English: pages are identified by pageId even in single-active-page mode.

export interface PageNode {
  pageId: string;
  openerPageId?: string;
  /** 页面最初由用户打开还是由 Agent 创建。用户与 Agent 共用页面时不改变此标记。 */
  openedBy?: 'user' | 'agent';
  url: string;
  title: string;
  state: 'active' | 'background' | 'closed';
  navigationEpoch: number;
}

export interface PageGraph {
  activePageId: string;
  pages: PageNode[];
}

// 可交互元素引用：动作只能引用经过校验的观测结果（[e12] 形式）。
// — English: interactable element refs — actions may only reference validated observations.
export interface InteractableElement {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
  frameId: string;
  visible: boolean;
  enabled: boolean;
  fingerprint: string;
  provenance: ContentProvenance;
}

export interface ContentBlock {
  type: 'heading' | 'paragraph' | 'list' | 'link' | 'table' | 'other';
  text: string;
  href?: string;
}

export interface FormFieldInfo {
  name: string;
  fieldType?: string;
  required: boolean;
}

export interface FormInfo {
  formId: string;
  action?: string;
  method?: 'get' | 'post';
  fields: FormFieldInfo[];
}

export interface NetworkFailure {
  resourceUrl: string;
  status?: number;
  error?: string;
}

export interface PageStateFlags {
  captchaDetected: boolean;
  authRequired: boolean;
}

// 一次观测：带 navigationEpoch 的页面快照，动作引用必须匹配 epoch。
// — English: one observation — a page snapshot bound to navigationEpoch.
export interface Observation {
  observationId: string;
  taskId: string;
  pageId: string;
  navigationEpoch: number;
  capturedAt: number;
  url: string;
  title: string;
  readiness: 'stable' | 'partial' | 'loading';
  screenshotRef?: string;
  elements: InteractableElement[];
  mainContent: ContentBlock[];
  forms: FormInfo[];
  network: {
    pendingRequests: number;
    recentFailures: NetworkFailure[];
  };
  pageState: PageStateFlags;
}

// ─── 动作意图 ────────────────────────────────────────────────────────────────
export type BrowserActionKind =
  | 'navigate'
  | 'observe'
  | 'click'
  | 'type'
  | 'select'
  | 'press'
  | 'scroll'
  | 'screenshot'
  | 'submit'
  | 'download'
  | 'wait';

export type ActionEffect = 'none' | 'local' | 'external_reversible' | 'external_irreversible';
export type ActionRisk = 'low' | 'medium' | 'high' | 'critical';

// 动作后置条件：任何动作都不默认成功，执行后必须验证。
// — English: postconditions — no action is assumed successful without verification.
export type Postcondition =
  | { kind: 'none' }
  | { kind: 'url_contains'; value: string }
  | { kind: 'url_equals'; value: string }
  | { kind: 'navigation_epoch_changed' }
  | { kind: 'element_appears'; ref: string }
  | { kind: 'element_disappears'; ref: string }
  | { kind: 'element_text_contains'; ref: string; value: string }
  | { kind: 'download_completed' };

export interface ActionIntent {
  actionId: string;
  taskId: string;
  pageId: string;
  observationId: string;
  expectedNavigationEpoch: number;
  kind: BrowserActionKind;
  targetRef?: string;
  arguments: Record<string, unknown>;
  rationale: string;
  effect: ActionEffect;
  risk: ActionRisk;
  postcondition: Postcondition;
}

// 授权包络：用户目标在任务开始时编译为确定性授权范围，模型不能自行扩展。
// — English: action grant — compiled from the user goal at task start.
export interface ActionGrant {
  grantId: string;
  taskId: string;
  allowedOrigins: string[];
  allowedActionKinds: BrowserActionKind[];
  allowedDataClasses: Array<'public' | 'user_input' | 'download'>;
  maxExternalWrites: number;
  confirmationThreshold: ActionRisk;
  expiresAt: number;
}

// ─── 副作用账本 ──────────────────────────────────────────────────────────────
// 先记录意图，再执行副作用；崩溃恢复时先处理 executing/uncertain 记录。
// — English: side-effect ledger — intent is recorded before side effects execute.
export type ActionRecordStatus =
  | 'prepared'
  | 'executing'
  | 'committed'
  | 'uncertain'
  | 'reconciled'
  | 'aborted';

export interface ActionRecord {
  actionId: string;
  taskId: string;
  actionDigest: string;
  effect: ActionEffect;
  status: ActionRecordStatus;
  preState: {
    pageId: string;
    url: string;
    observationId: string;
    navigationEpoch: number;
    targetFingerprint?: string;
  };
  expectedPostcondition: Postcondition;
  preparedAt: number;
  executedAt?: number;
  committedAt?: number;
  evidenceRefs: string[];
}

// ─── 任务状态、预算与等待 ────────────────────────────────────────────────────
export type BrowserTaskStatus =
  | 'planning'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed';

export type WaitKind = 'page' | 'human' | 'event' | 'budget';

export interface WaitState {
  kind: WaitKind;
  requestId?: string;
  since: number;
  deadline?: number;
}

export interface PlanStep {
  stepId: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export interface TaskBudget {
  maxSteps: number;
  maxTokens: number;
  maxReplans: number;
  maxConsecutiveFailures: number;
  maxDurationMs: number;
  maxExternalWrites: number;
  maxDownloadBytes: number;
}

export interface TaskUsage {
  steps: number;
  tokens: number;
  replans: number;
  consecutiveFailures: number;
  externalWrites: number;
  downloadBytes: number;
  startedAt: number;
}

export type ClassifiedErrorKind =
  | 'transient'
  | 'element'
  | 'page'
  | 'llm'
  | 'policy'
  | 'budget'
  | 'side_effect'
  | 'cancelled';

export interface ClassifiedError {
  kind: ClassifiedErrorKind;
  code: string;
  message: string;
  retryable: boolean;
  actionId?: string;
}

export interface BrowserTaskState {
  taskId: string;
  goal: string;
  status: BrowserTaskStatus;
  plan: PlanStep[];
  currentStepId?: string;
  browserSessionId?: string;
  activePageId?: string;
  wait?: WaitState;
  budget: TaskBudget;
  usage: TaskUsage;
  lastCheckpointId?: string;
  failure?: ClassifiedError;
}

// ─── 人工接管 ────────────────────────────────────────────────────────────────
// CAPTCHA 默认路径为人工接管，不自动规避。
// — English: human takeover protocol — CAPTCHA defaults to human takeover.
export type HumanRequestType = 'confirm' | 'input' | 'captcha' | 'auth' | 'choice' | 'takeover';

export interface HumanRequest {
  requestId: string;
  taskId: string;
  type: HumanRequestType;
  prompt: string;
  pageId?: string;
  origin?: string;
  actionDigest?: string;
  fields?: Array<{ name: string; valueSummary: string }>;
  timeoutMs: number;
  onTimeout: 'abort' | 'default_action' | 'extend';
}

// ─── 任务事件（append-only，状态由事件折叠得到） ───────────────────────────
// — English: append-only task events — state is derived by folding events.
export type BrowserTaskEvent =
  | { type: 'task.created'; taskId: string; goal: string; createdAt: string }
  | { type: 'plan.updated'; taskId: string; plan: PlanStep[]; updatedAt: string }
  | {
      type: 'observation.accepted';
      taskId: string;
      observationId: string;
      pageId: string;
      navigationEpoch: number;
      elementCount: number;
      acceptedAt: string;
    }
  | { type: 'action.prepared'; taskId: string; record: ActionRecord; preparedAt: string }
  | {
      type: 'action.completed';
      taskId: string;
      actionId: string;
      outcome: 'committed' | 'uncertain' | 'failed';
      evidenceRefs: string[];
      completedAt: string;
    }
  | { type: 'action.uncertain'; taskId: string; actionId: string; reason: string; uncertainAt: string }
  | { type: 'human.requested'; taskId: string; request: HumanRequest }
  | {
      type: 'human.resolved';
      taskId: string;
      requestId: string;
      approved: boolean;
      reason?: string;
      resolvedAt: string;
    }
  | { type: 'budget.updated'; taskId: string; usage: TaskUsage; updatedAt: string }
  | { type: 'task.paused'; taskId: string; reason?: string; pausedAt: string }
  | { type: 'task.cancelled'; taskId: string; reason?: string; cancelledAt: string }
  | { type: 'task.failed'; taskId: string; failure: ClassifiedError; failedAt: string }
  | { type: 'task.completed'; taskId: string; summary?: string; completedAt: string };
