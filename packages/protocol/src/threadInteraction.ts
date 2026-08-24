import { z } from 'zod';
import type { ThreadId, TurnId } from './types.js';

/** Agent 主动请求用户在当前 turn 中作出的可恢复决策。 */
export type AgentDecisionAction = 'way_one' | 'way_two' | 'custom_input' | 'cancel' | 'confirm';

export interface AgentDecisionOption {
  id: string;
  action: 'way_one' | 'way_two' | 'custom_input' | 'confirm';
  label: string;
  description?: string;
}

export interface AgentDecisionRequest {
  requestId: string;
  threadId: ThreadId;
  turnId: TurnId;
  runId?: string;
  prompt: string;
  options: AgentDecisionOption[];
  allowCustomInput: boolean;
  createdAt: string;
  status: 'pending' | 'resolved' | 'cancelled' | 'expired';
  resolvedAt?: string;
  selectedAction?: AgentDecisionAction;
  selectedOptionId?: string;
  customInput?: string;
}

export interface AgentDecisionResponse {
  requestId: string;
  action: AgentDecisionAction;
  optionId?: string;
  customInput?: string;
}

export type ThreadExecutionStatus = 'idle' | 'running' | 'stopping' | 'waiting_user_input' | 'terminal';

export const agentDecisionOptionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['way_one', 'way_two', 'custom_input', 'confirm']),
  label: z.string().min(1),
  description: z.string().optional(),
}).strict();

export const agentDecisionRequestSchema = z.object({
  requestId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  runId: z.string().min(1).optional(),
  prompt: z.string(),
  options: z.array(agentDecisionOptionSchema),
  allowCustomInput: z.boolean(),
  createdAt: z.string(),
  status: z.enum(['pending', 'resolved', 'cancelled', 'expired']),
  resolvedAt: z.string().optional(),
  selectedAction: z.enum(['way_one', 'way_two', 'custom_input', 'cancel', 'confirm']).optional(),
  selectedOptionId: z.string().optional(),
  customInput: z.string().optional(),
}).strict();

export const agentDecisionResponseSchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(['way_one', 'way_two', 'custom_input', 'cancel', 'confirm']),
  optionId: z.string().optional(),
  customInput: z.string().optional(),
}).strict();

export const threadExecutionStatusSchema = z.enum(['idle', 'running', 'stopping', 'waiting_user_input', 'terminal']);
