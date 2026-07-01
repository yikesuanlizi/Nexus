import type { RuntimeMiddleware, RuntimeToolRequest, RuntimeToolResponse, RuntimeTurnContext } from './middleware.js';

// Guardian 授权结果：approved 允许执行；denied 拒绝执行；request_review 需要额外人工或策略审查
export type GuardianAuthorization = 'approved' | 'denied' | 'request_review';
// Guardian 风险等级：low 低风险；medium 中风险；high 高风险；critical 关键风险
export type GuardianRiskLevel = 'low' | 'medium' | 'high' | 'critical';
// Guardian 审查模式：all 全部工具审查；write 仅写操作工具审查；approval 仅需要人工审批的工具审查
export type GuardianReviewMode = 'all' | 'write' | 'approval';

// Guardian 审查结果：包含授权决定、风险等级、原因说明和附加元数据
export interface GuardianAssessment {
  authorization: GuardianAuthorization;
  riskLevel: GuardianRiskLevel;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Guardian 对话记录条目：记录 user / assistant / tool 的内容片段
export interface GuardianTranscriptEntry {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

// Guardian 审查请求：携带租户、线程、回合、工具名称及上下文供 reviewer 决策
export interface GuardianReviewRequest {
  tenantId: string;
  threadId: string;
  turnId: string;
  toolName: string;
  requestedToolName: string;
  args: Record<string, unknown>;
  riskHint: GuardianRiskLevel;
  transcript: GuardianTranscriptEntry[];
}

// Guardian 审查函数签名：同步或异步返回 GuardianAssessment
export type GuardianReviewer = (request: GuardianReviewRequest) => Promise<GuardianAssessment> | GuardianAssessment;

// Guardian 中间件配置：是否启用、审查模式、单 turn 最大拒绝次数、审查函数
export interface GuardianConfig {
  enabled?: boolean;
  review?: GuardianReviewMode;
  maxDenialsPerTurn?: number;
  reviewer?: GuardianReviewer;
}

// 构造 Guardian 中间件：在工具执行前进行安全审查；fail-closed 策略 —— 未配置 reviewer 或审查失败时默认拒绝
export function createGuardianMiddleware(config: GuardianConfig = {}): RuntimeMiddleware {
  if (config.enabled !== true) return {};
  const reviewMode = config.review ?? 'write';
  const maxDenialsPerTurn = Math.max(1, Math.floor(config.maxDenialsPerTurn ?? 3));
  const denialsByTurn = new Map<string, number>();

  return {
    beforeTool: async (ctx, request) => {
      if (!shouldReviewTool(request, reviewMode)) return undefined;
      const denials = denialsByTurn.get(ctx.turnId) ?? 0;
      if (denials >= maxDenialsPerTurn) {
        const message = ctx.locale === 'zh'
          ? `Guardian 已因连续拒绝打开本轮熔断器。工具 "${request.toolName}" 不会执行。`
          : `Guardian rejection circuit is open for this turn. Tool "${request.toolName}" will not run.`;
        emitGuardianWarning(ctx, message, { code: 'GUARDIAN_CIRCUIT_OPEN', toolName: request.toolName });
        return failedGuardianResponse(message, 'GUARDIAN_CIRCUIT_OPEN');
      }

      if (!config.reviewer) {
        const message = ctx.locale === 'zh'
          ? `Guardian 已启用但没有配置 reviewer；按 fail-closed 策略拒绝工具 "${request.toolName}"。`
          : `Guardian is enabled but no reviewer is configured; failing closed for tool "${request.toolName}".`;
        emitGuardianWarning(ctx, message, { code: 'GUARDIAN_REVIEW_UNAVAILABLE', toolName: request.toolName });
        return failedGuardianResponse(message, 'GUARDIAN_REVIEW_UNAVAILABLE');
      }

      let assessment: GuardianAssessment;
      try {
        assessment = await config.reviewer(buildGuardianReviewRequest(ctx, request));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message = ctx.locale === 'zh'
          ? `Guardian 审查失败；按 fail-closed 策略拒绝工具 "${request.toolName}"：${reason}`
          : `Guardian review failed; failing closed for tool "${request.toolName}": ${reason}`;
        emitGuardianWarning(ctx, message, { code: 'GUARDIAN_REVIEW_FAILED', toolName: request.toolName, reason });
        return failedGuardianResponse(message, 'GUARDIAN_REVIEW_FAILED');
      }

      if (assessment.authorization === 'approved') return undefined;

      const nextDenials = denials + 1;
      denialsByTurn.set(ctx.turnId, nextDenials);
      const code = assessment.authorization === 'request_review' ? 'GUARDIAN_REVIEW_REQUIRED' : 'GUARDIAN_DENIED';
      const reason = assessment.reason?.trim() || assessment.authorization;
      const message = ctx.locale === 'zh'
        ? `Guardian 拒绝执行工具 "${request.toolName}"：${reason}`
        : `Guardian rejected tool "${request.toolName}": ${reason}`;
      emitGuardianWarning(ctx, message, {
        code,
        toolName: request.toolName,
        riskLevel: assessment.riskLevel,
        denials: nextDenials,
      });
      return failedGuardianResponse(message, code, assessment);
    },
    afterTurn: (ctx) => {
      denialsByTurn.delete(ctx.turnId);
    },
  };
}

// 判断当前工具是否需要 Guardian 审查：按模式 all / approval / write（写操作或需要审批）
function shouldReviewTool(request: RuntimeToolRequest, mode: GuardianReviewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'approval') return request.toolDef?.requiresApproval === true;
  return request.toolDef?.requiredPolicy !== 'readonly' || request.toolDef?.requiresApproval === true;
}

// 构造 Guardian 审查请求：聚合上下文、工具信息、风险提示和对话摘要
function buildGuardianReviewRequest(ctx: RuntimeTurnContext, request: RuntimeToolRequest): GuardianReviewRequest {
  return {
    tenantId: ctx.tenantId,
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    toolName: request.toolName,
    requestedToolName: request.requestedToolName,
    args: request.args,
    riskHint: riskHintForTool(request),
    transcript: buildGuardianTranscript(ctx, request),
  };
}

// 构造 Guardian 审查上下文：收集用户输入、最近 16 条收集项摘要以及本次待执行工具的脱敏参数
function buildGuardianTranscript(ctx: RuntimeTurnContext, request: RuntimeToolRequest): GuardianTranscriptEntry[] {
  const entries: GuardianTranscriptEntry[] = [];
  const userText = userInputToText(ctx.userInput);
  if (userText) entries.push({ role: 'user', content: truncateGuardianText(userText) });
  for (const item of ctx.collectedItems.slice(-16)) {
    if (item.type === 'user_message') {
      entries.push({ role: 'user', content: truncateGuardianText(item.text) });
    } else if (item.type === 'agent_message') {
      entries.push({ role: 'assistant', content: truncateGuardianText(item.text) });
    } else if (item.type === 'tool_call') {
      entries.push({
        role: 'tool',
        content: truncateGuardianText(`${item.toolName} ${item.status}: ${JSON.stringify(item.result ?? item.error ?? item.arguments)}`),
      });
    }
  }
  entries.push({
    role: 'tool',
    content: truncateGuardianText(`pending ${request.toolName}: ${JSON.stringify(redactGuardianArgs(request.args))}`),
  });
  return entries;
}

// 从 user input 中提取文本：普通文本直接返回，否则 JSON 序列化整个对象
function userInputToText(input: RuntimeTurnContext['userInput']): string {
  if (input.type === 'text') return input.text;
  return JSON.stringify(input);
}

// 估算工具风险等级：shell/apply_patch 为 high；写操作 / 需要审批 为 medium；其余为 low
function riskHintForTool(request: RuntimeToolRequest): GuardianRiskLevel {
  if (request.toolName === 'shell_command' || request.toolName === 'apply_patch') return 'high';
  if (request.toolDef?.requiredPolicy === 'workspace_write' || request.toolDef?.requiresApproval === true) return 'medium';
  return 'low';
}

// 构造 Guardian 拒绝的工具响应：标记为 failed，并携带错误码和可选的审查详情
function failedGuardianResponse(
  message: string,
  code: string,
  assessment?: GuardianAssessment,
): RuntimeToolResponse {
  return {
    status: 'failed',
    output: message,
    error: { message, code },
    data: assessment ? {
      guardian: {
        authorization: assessment.authorization,
        riskLevel: assessment.riskLevel,
        reason: assessment.reason,
      },
    } : undefined,
  };
}

// 通过 ctx.emit 发出 Guardian 警告事件；不使用 metadata 仅作为占位保留接口
function emitGuardianWarning(ctx: RuntimeTurnContext, message: string, metadata: Record<string, unknown>): void {
  void metadata;
  ctx.emit({
    type: 'warning',
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    message,
    info: { kind: 'Other' },
  });
}

// 对工具参数做敏感字段脱敏：token、secret、password、key、credential 等字段替换为 [redacted]
function redactGuardianArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    redacted[key] = /token|secret|password|key|credential/i.test(key) ? '[redacted]' : value;
  }
  return redacted;
}

// 截断文本以控制审查上下文大小；超过 max 时保留前缀并追加截断提示
function truncateGuardianText(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}
