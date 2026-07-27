import { describe, expect, it } from 'vitest';
import type { AccessPolicyConfig, AccessRequest } from '@nexus/protocol';
import { evaluateAccessRequest } from './accessPolicy.js';

const baseRequest: AccessRequest = {
  access: 'read',
  target: { kind: 'path', path: 'E:\\langchain\\Nexus\\README.md' },
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolName: 'read_file',
  toolCallId: 'call-1',
  description: 'read README',
};

describe('evaluateAccessRequest', () => {
  it('allows workspace reads and writes in workspace mode', () => {
    const policy: AccessPolicyConfig = {
      mode: 'workspace',
      workspaceRoot: 'E:\\langchain\\Nexus',
      persistentRules: [],
      temporaryGrants: [],
    };

    expect(evaluateAccessRequest(policy, baseRequest).decision).toBe('allow');
    expect(evaluateAccessRequest(policy, { ...baseRequest, access: 'write' }).decision).toBe('allow');
  });

  it('prompts for external paths in workspace mode', () => {
    const policy: AccessPolicyConfig = {
      mode: 'workspace',
      workspaceRoot: 'E:\\langchain\\Nexus',
      persistentRules: [],
      temporaryGrants: [],
    };

    const decision = evaluateAccessRequest(policy, {
      ...baseRequest,
      target: { kind: 'path', path: 'E:\\langchain\\dexin-agent\\v1.docx' },
    });

    expect(decision.decision).toBe('prompt');
    expect(decision.source).toBe('approval_required');
  });

  it('denies when a persistent deny matches even if temporary allow exists', () => {
    const policy: AccessPolicyConfig = {
      mode: 'workspace',
      workspaceRoot: 'E:\\langchain\\Nexus',
      persistentRules: [
        {
          id: 'deny-docs',
          effect: 'deny',
          access: 'read',
          target: { kind: 'path', path: 'E:\\langchain\\dexin-agent' },
          scope: 'global',
        },
      ],
      temporaryGrants: [
        {
          id: 'allow-docs-once',
          effect: 'allow',
          access: 'read',
          target: { kind: 'path', path: 'E:\\langchain\\dexin-agent' },
          scope: 'turn',
          threadId: 'thread-1',
          turnId: 'turn-1',
          createdAt: '2026-07-27T00:00:00.000Z',
        },
      ],
    };

    const decision = evaluateAccessRequest(policy, {
      ...baseRequest,
      target: { kind: 'path', path: 'E:\\langchain\\dexin-agent\\v1.docx' },
    });

    expect(decision.decision).toBe('deny');
    expect(decision.matchedRuleId).toBe('deny-docs');
  });

  it('allows matching temporary grant for the same turn', () => {
    const policy: AccessPolicyConfig = {
      mode: 'chat',
      workspaceRoot: 'E:\\langchain\\Nexus\\.nexus\\chat-workspace',
      persistentRules: [],
      temporaryGrants: [
        {
          id: 'allow-on-turn',
          effect: 'allow',
          access: 'read',
          target: { kind: 'path', path: 'E:\\langchain\\dexin-agent' },
          scope: 'turn',
          threadId: 'thread-1',
          turnId: 'turn-1',
          createdAt: '2026-07-27T00:00:00.000Z',
        },
      ],
    };

    expect(evaluateAccessRequest(policy, {
      ...baseRequest,
      target: { kind: 'path', path: 'E:\\langchain\\dexin-agent\\v1.docx' },
    }).decision).toBe('allow');
  });
});
