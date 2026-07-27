import { z } from 'zod';

export const accessModeSchema = z.enum(['chat', 'workspace', 'danger_full_access']);
export const accessKindSchema = z.enum(['read', 'write', 'command', 'network', 'tool_call']);
export const accessEffectSchema = z.enum(['allow', 'deny']);
export const accessRuleScopeSchema = z.enum(['global', 'thread']);
export const temporaryAccessScopeSchema = z.enum(['tool_call', 'turn', 'session']);

export const accessTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('command'), command: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('network'), host: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('tool'), toolName: z.string().trim().min(1) }).strict(),
]);

export const accessRuleSchema = z.object({
  id: z.string().trim().min(1),
  effect: accessEffectSchema,
  access: accessKindSchema,
  target: accessTargetSchema,
  scope: accessRuleScopeSchema,
  reason: z.string().trim().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const temporaryAccessGrantSchema = z.object({
  id: z.string().trim().min(1),
  effect: accessEffectSchema,
  access: accessKindSchema,
  target: accessTargetSchema,
  scope: temporaryAccessScopeSchema,
  threadId: z.string().trim().optional(),
  turnId: z.string().trim().optional(),
  toolCallId: z.string().trim().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const accessRequestSchema = z.object({
  access: accessKindSchema,
  target: accessTargetSchema,
  threadId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  toolName: z.string().trim().optional(),
  toolCallId: z.string().trim().optional(),
  agentThreadId: z.string().trim().optional(),
  agentRole: z.string().nullable().optional(),
  description: z.string().trim().min(1),
}).strict();

export const accessDecisionSchema = z.object({
  decision: z.enum(['allow', 'prompt', 'deny']),
  request: accessRequestSchema,
  source: z.enum([
    'hard_deny',
    'persistent_rule',
    'workspace_default',
    'temporary_grant',
    'approval_required',
    'default_deny',
  ]),
  matchedRuleId: z.string().optional(),
  matchedRuleScope: z.union([accessRuleScopeSchema, temporaryAccessScopeSchema]).optional(),
  justification: z.string(),
}).strict();

export const accessPolicyConfigSchema = z.object({
  mode: accessModeSchema.default('workspace'),
  workspaceRoot: z.string().default(''),
  persistentRules: z.array(accessRuleSchema).default([]),
  temporaryGrants: z.array(temporaryAccessGrantSchema).default([]),
}).strict();
