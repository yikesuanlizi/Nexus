// RunControl 协议：定义 run 的控制动作（interrupt/resume/rollback）请求与结果
// — English: RunControl protocol — interrupt/resume/rollback request and result
import { z } from 'zod';
import type { ThreadId } from './types.js';

// 控制动作字面量联合：与 RunControlRequest['action'] 等价
// — English: control action literal union, equivalent to RunControlRequest['action']
export type RunControlAction = 'interrupt' | 'resume' | 'rollback';

// 全部控制动作集合，用于运行时快速校验
// — English: full action set for runtime membership checks
export const RUN_CONTROL_ACTIONS: ReadonlySet<RunControlAction> = new Set(['interrupt', 'resume', 'rollback']);

// 控制请求：discriminated union，每个分支仅允许对应的字段
// — English: control request — discriminated union, each branch strictly typed
export type RunControlRequest =
  | { action: 'interrupt' }
  | { action: 'resume' }
  | { action: 'rollback'; checkpointId: string };

// 控制能力：每个子动作独立上报 enabled / reason；rollback 还附带可用 checkpointIds
// — English: control capabilities — per-action enabled/reason; rollback also exposes checkpointIds
export interface RunControlCapabilities {
  interrupt: { enabled: boolean; reason?: string };
  resume: { enabled: boolean; reason?: string };
  rollback: { enabled: boolean; checkpointIds: string[]; reason?: string };
}

// 控制结果：返回 targetRunId / controlRunId / threadId / action / accepted / reason?
// — English: control result — targetRunId/controlRunId/threadId/action/accepted/reason?
export interface RunControlResult {
  targetRunId: string;
  controlRunId: string;
  threadId: ThreadId;
  action: RunControlRequest['action'];
  accepted: boolean;
  reason?: string;
}

// ─── Zod schemas：三个分支均 .strict() ─────────────────────────────────────
// — English: Zod schemas — three strict branches
const interruptRequestSchema = z.object({
  action: z.literal('interrupt'),
}).strict();

const resumeRequestSchema = z.object({
  action: z.literal('resume'),
}).strict();

const rollbackRequestSchema = z.object({
  action: z.literal('rollback'),
  checkpointId: z.string().min(1),
}).strict();

// 唯一的 run control request schema；不允许 threadId/count/reason 等附加字段
// — English: the unique run control request schema; rejects threadId/count/reason or any extra field
export const runControlRequestSchema = z.discriminatedUnion('action', [
  interruptRequestSchema,
  resumeRequestSchema,
  rollbackRequestSchema,
]);

// RunControlResult schema（用于响应校验）
// — English: RunControlResult schema for response validation
export const runControlResultSchema = z.object({
  targetRunId: z.string().min(1),
  controlRunId: z.string().min(1),
  threadId: z.string().min(1),
  action: z.enum(['interrupt', 'resume', 'rollback']),
  accepted: z.boolean(),
  reason: z.string().optional(),
}).strict();

// RunControlCapabilities schema
// — English: RunControlCapabilities schema
export const runControlCapabilitiesSchema = z.object({
  interrupt: z.object({
    enabled: z.boolean(),
    reason: z.string().optional(),
  }).strict(),
  resume: z.object({
    enabled: z.boolean(),
    reason: z.string().optional(),
  }).strict(),
  rollback: z.object({
    enabled: z.boolean(),
    checkpointIds: z.array(z.string()),
    reason: z.string().optional(),
  }).strict(),
}).strict();

// 根据 run 状态计算控制能力
// — English: compute control capabilities from run status
export function computeRunControlCapabilities(input: {
  runStatus: string;
  active: boolean;
  checkpointIds?: string[];
}): RunControlCapabilities {
  const isRunning = input.runStatus === 'running' && input.active;
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(input.runStatus);
  const isInterrupted = input.runStatus === 'interrupted';
  return {
    interrupt: {
      enabled: isRunning,
      reason: isRunning ? undefined : 'run is not active',
    },
    resume: {
      enabled: isTerminal || isInterrupted,
      reason: isTerminal || isInterrupted ? undefined : 'run is not in a resumable state',
    },
    rollback: {
      enabled: true,
      checkpointIds: input.checkpointIds ?? [],
    },
  };
}
