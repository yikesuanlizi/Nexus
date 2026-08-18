export type AccessMode = 'chat' | 'workspace' | 'danger_full_access';
export type AccessKind = 'read' | 'write' | 'command' | 'network' | 'tool_call';
export type AccessEffect = 'allow' | 'deny';
export type AccessRuleScope = 'global' | 'workspace' | 'thread';
export type PersistentAccessScope = AccessRuleScope;
export type TemporaryAccessScope = 'tool_call' | 'turn' | 'session';
export type AccessDecisionKind = 'allow' | 'prompt' | 'deny';

export interface AccessTarget {
  kind: 'path' | 'command' | 'network' | 'tool';
  path?: string;
  command?: string;
  host?: string;
  toolName?: string;
}

export interface AccessRule {
  id: string;
  effect: AccessEffect;
  access: AccessKind;
  target: AccessTarget;
  scope: AccessRuleScope;
  /** Bound when a rule applies only to one workspace or thread. */
  workspaceRoot?: string;
  threadId?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemporaryAccessGrant {
  id: string;
  effect: AccessEffect;
  access: AccessKind;
  target: AccessTarget;
  scope: TemporaryAccessScope;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface AccessPolicyConfig {
  mode: AccessMode;
  workspaceRoot: string;
  persistentRules: AccessRule[];
  temporaryGrants: TemporaryAccessGrant[];
}

export interface AccessRequest {
  access: AccessKind;
  target: AccessTarget;
  threadId: string;
  turnId: string;
  toolName?: string;
  toolCallId?: string;
  agentThreadId?: string;
  agentRole?: string | null;
  /** Workspace that originated this request, used by workspace-scoped rules. */
  workspaceRoot?: string;
  description: string;
}

export interface AccessDecision {
  decision: AccessDecisionKind;
  request: AccessRequest;
  source:
    | 'hard_deny'
    | 'persistent_rule'
    | 'workspace_default'
    | 'temporary_grant'
    | 'approval_required'
    | 'default_deny';
  matchedRuleId?: string;
  matchedRuleScope?: AccessRuleScope | TemporaryAccessScope;
  justification: string;
}

export function normalizeAccessPolicyConfig(input: Partial<AccessPolicyConfig> = {}): AccessPolicyConfig {
  const mode = input.mode === 'chat' || input.mode === 'workspace' || input.mode === 'danger_full_access'
    ? input.mode
    : 'workspace';
  return {
    mode,
    workspaceRoot: typeof input.workspaceRoot === 'string' ? input.workspaceRoot : '',
    persistentRules: Array.isArray(input.persistentRules)
      ? input.persistentRules.map((rule) => normalizeAccessRule(rule))
      : [],
    temporaryGrants: Array.isArray(input.temporaryGrants)
      ? input.temporaryGrants.map((grant) => ({
          ...grant,
          target: normalizeAccessTarget(grant.target),
        }))
      : [],
  };
}

export function normalizeAccessRule(rule: AccessRule): AccessRule {
  return {
    ...rule,
    reason: rule.reason?.trim() || undefined,
    target: normalizeAccessTarget(rule.target),
  };
}

export function normalizeAccessTarget(target: AccessTarget): AccessTarget {
  if (target.kind === 'path') {
    return { kind: 'path', path: target.path?.trim() ?? '' };
  }
  if (target.kind === 'command') {
    return { kind: 'command', command: target.command?.trim() ?? '' };
  }
  if (target.kind === 'network') {
    return { kind: 'network', host: target.host?.trim().toLowerCase() ?? '' };
  }
  return { kind: 'tool', toolName: target.toolName?.trim() ?? '' };
}

export function redactAccessPolicyForPublicConfig(config: AccessPolicyConfig): AccessPolicyConfig {
  return {
    ...normalizeAccessPolicyConfig(config),
    temporaryGrants: [],
  };
}
