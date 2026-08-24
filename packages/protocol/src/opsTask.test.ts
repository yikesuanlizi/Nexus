import { describe, expect, it } from 'vitest';
import {
  OPS_TASK_TRANSITIONS,
  OpsTaskError,
  OpsTaskSession,
  canTransitionOpsTaskState,
  createOpsTaskRetry,
  createOpsTaskRetrySpec,
  isOpsTaskTerminalState,
  opsTaskSessionSchema,
  opsTaskSpecSchema,
  transitionOpsTask,
  validateOpsTaskVersion,
} from './opsTask.js';

const spec = {
  taskId: 'task-1',
  threadId: 'thread-1',
  presetId: 'ops' as const,
  workspaceRoot: 'D:/workspace',
  environmentId: 'local',
  target: { hostIds: ['host-1'] },
  policyProfile: 'ops_readonly' as const,
  budgets: {
    maxAdapterCalls: 20,
    maxConcurrentCalls: 2,
    maxOutputBytes: 1024,
    maxWallTimeMs: 30_000,
  },
  acceptanceCriteria: ['服务恢复'],
  allowLocalPatchProposal: true,
  allowLocalTest: false,
};

function session(overrides: Partial<OpsTaskSession> = {}): OpsTaskSession {
  return {
    spec,
    state: 'draft',
    currentPhase: 'observe',
    hypothesisIds: [],
    evidenceIds: [],
    checkpointSequence: 0,
    taskVersion: 0,
    sequence: 0,
    ...overrides,
  };
}

describe('Ops task state machine', () => {
  it('matches the documented transitions and terminal states', () => {
    expect(OPS_TASK_TRANSITIONS.running).toEqual([
      'paused',
      'waiting_confirmation',
      'verifying',
      'blocked',
      'cancelled',
      'failed',
    ]);
    expect(canTransitionOpsTaskState('blocked', 'queued')).toBe(true);
    expect(canTransitionOpsTaskState('waiting_confirmation', 'running')).toBe(true);
    expect(canTransitionOpsTaskState('queued', 'cancelled')).toBe(true);
    expect(canTransitionOpsTaskState('failed', 'running')).toBe(false);
    expect(isOpsTaskTerminalState('completed')).toBe(true);
  });

  it('advances state and task version without mutating the source', () => {
    const current = session();
    const next = transitionOpsTask(current, 'queued', { expectedTaskVersion: 0 });
    expect(next).toMatchObject({ state: 'queued', taskVersion: 1, sequence: 1 });
    expect(current).toMatchObject({ state: 'draft', taskVersion: 0, sequence: 0 });
  });

  it('rejects invalid transitions and terminal task operations with stable codes', () => {
    expect(() => transitionOpsTask(session({ state: 'draft' }), 'running')).toThrowError(
      OpsTaskError,
    );
    try {
      transitionOpsTask(session({ state: 'draft' }), 'running');
    } catch (error) {
      expect(error).toMatchObject({ code: 'OPS_INVALID_TRANSITION' });
    }
    try {
      transitionOpsTask(session({ state: 'failed' }), 'running');
    } catch (error) {
      expect(error).toMatchObject({ code: 'OPS_TERMINAL_STATE' });
    }
  });

  it('rejects stale optimistic-lock versions', () => {
    expect(validateOpsTaskVersion(3, 3)).toBe(true);
    expect(() => validateOpsTaskVersion(3, 2)).toThrowError(OpsTaskError);
    try {
      validateOpsTaskVersion(3, 2);
    } catch (error) {
      expect(error).toMatchObject({ code: 'OPS_VERSION_CONFLICT' });
    }
  });
});

describe('Ops task retry relation', () => {
  it('creates a fresh draft with a new id and parentTaskId', () => {
    const source = session({ state: 'failed', taskVersion: 4, sequence: 9 });
    const retry = createOpsTaskRetry(source, {
      taskId: 'task-2',
      parentTaskId: 'task-1',
      expectedParentTaskVersion: 4,
    });
    expect(retry.spec).toMatchObject({ taskId: 'task-2', parentTaskId: 'task-1' });
    expect(retry).toMatchObject({ state: 'draft', taskVersion: 0, sequence: 0 });
    expect(source.state).toBe('failed');
  });

  it('derives a retry spec without carrying task identity or history fields', () => {
    const retrySpec = createOpsTaskRetrySpec(spec, 'task-2');
    expect(retrySpec).toMatchObject({ taskId: 'task-2', parentTaskId: 'task-1' });
    expect(retrySpec).not.toHaveProperty('evidenceIds');
    expect(() => createOpsTaskRetrySpec(spec, 'task-1')).toThrowError(OpsTaskError);
  });

  it('does not retry a non-terminal task or reuse the parent id', () => {
    expect(() =>
      createOpsTaskRetry(session({ state: 'running' }), {
        taskId: 'task-2',
        parentTaskId: 'task-1',
      }),
    ).toThrowError(OpsTaskError);
    expect(() =>
      createOpsTaskRetry(session({ state: 'failed' }), {
        taskId: 'task-1',
        parentTaskId: 'task-1',
      }),
    ).toThrowError(OpsTaskError);
  });
});

describe('Ops task schemas', () => {
  it('validates the spec and session contracts', () => {
    const parsedSpec = opsTaskSpecSchema.parse(spec);
    expect(parsedSpec.taskId).toBe('task-1');
    expect(opsTaskSessionSchema.parse(session())).toMatchObject({ state: 'draft', taskVersion: 0 });
  });

  it('rejects unknown fields and negative versions', () => {
    expect(() => opsTaskSpecSchema.parse({ ...spec, unexpected: true })).toThrow();
    expect(() => opsTaskSessionSchema.parse(session({ taskVersion: -1 }))).toThrow();
  });

  it('does not model a redaction failure as persisted Evidence', () => {
    const task = session({
      evidence: [{
        id: 'evidence-1',
        source: 'replay',
        status: 'complete',
        contentHash: 'hash',
        summary: '[REDACTED]',
        observedAt: '2026-08-19T00:00:00.000Z',
        detectorVersion: 'secret-redactor-v1',
      }],
    });
    expect(() => opsTaskSessionSchema.parse({
      ...task,
      evidence: [{ ...task.evidence?.[0], status: 'redaction_failed' }],
    })).toThrow();
  });
});
