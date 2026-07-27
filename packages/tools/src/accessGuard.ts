import * as path from 'node:path';
import type { AccessDecision, AccessKind, AccessRequest } from '@nexus/protocol';
import type { ToolResult } from './registry.js';

export interface ResolveToolPathAccessInput {
  workspaceRoot: string;
  path: string;
  access: Extract<AccessKind, 'read' | 'write'>;
  threadId: string;
  turnId: string;
  toolName: string;
  toolCallId?: string;
  description: string;
}

export function resolveToolPath(workspaceRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  return path.resolve(workspaceRoot, filePath);
}

export function resolveToolPathAccess(input: ResolveToolPathAccessInput): AccessRequest {
  return {
    access: input.access,
    target: { kind: 'path', path: resolveToolPath(input.workspaceRoot, input.path) },
    threadId: input.threadId,
    turnId: input.turnId,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    description: input.description,
  };
}

export function toolResultFromAccessDecision(decision: AccessDecision): ToolResult {
  return {
    output: decision.justification,
    status: 'failed',
    error: {
      message: decision.justification,
      code: decision.decision === 'prompt' ? 'ACCESS_APPROVAL_REQUIRED' : 'ACCESS_DENIED',
    },
    data: { accessDecision: decision },
  };
}
