// RunControl 协议测试：discriminated union、strict schema、capabilities、result
// — English: RunControl tests — discriminated union, strict schema, capabilities, result
import { describe, expect, it } from 'vitest';
import {
  RUN_CONTROL_ACTIONS,
  RunControlAction,
  RunControlCapabilities,
  RunControlRequest,
  RunControlResult,
  computeRunControlCapabilities,
  runControlCapabilitiesSchema,
  runControlRequestSchema,
  runControlResultSchema,
} from './runControl.js';

describe('RunControlRequest — discriminated union', () => {
  it('interrupt 分支只允许 action=interrupt', () => {
    const result = runControlRequestSchema.safeParse({ action: 'interrupt' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('interrupt');
    }
  });

  it('resume 分支只允许 action=resume', () => {
    const result = runControlRequestSchema.safeParse({ action: 'resume' });
    expect(result.success).toBe(true);
  });

  it('rollback 分支必须有 checkpointId', () => {
    const result = runControlRequestSchema.safeParse({ action: 'rollback', checkpointId: 'cp-1' });
    expect(result.success).toBe(true);
  });

  it('rollback 分支缺 checkpointId 会被拒绝', () => {
    const result = runControlRequestSchema.safeParse({ action: 'rollback' });
    expect(result.success).toBe(false);
  });

  it('rollback 分支 checkpointId 为空字符串会被拒绝', () => {
    const result = runControlRequestSchema.safeParse({ action: 'rollback', checkpointId: '' });
    expect(result.success).toBe(false);
  });

  it('interrupt 分支不允许携带 checkpointId', () => {
    const result = runControlRequestSchema.safeParse({ action: 'interrupt', checkpointId: 'cp-1' });
    expect(result.success).toBe(false);
  });

  it('resume 分支不允许携带 reason/count 等附加字段', () => {
    const result = runControlRequestSchema.safeParse({ action: 'resume', reason: 'because' });
    expect(result.success).toBe(false);
  });

  it('任何分支不允许携带 threadId', () => {
    const result = runControlRequestSchema.safeParse({ action: 'interrupt', threadId: 'thread-1' });
    expect(result.success).toBe(false);
  });

  it('未知 action 会被拒绝', () => {
    const result = runControlRequestSchema.safeParse({ action: 'pause' });
    expect(result.success).toBe(false);
  });

  it('approve/deny/retry 都不在合法 action 中', () => {
    expect(runControlRequestSchema.safeParse({ action: 'approve' }).success).toBe(false);
    expect(runControlRequestSchema.safeParse({ action: 'deny' }).success).toBe(false);
    expect(runControlRequestSchema.safeParse({ action: 'retry' }).success).toBe(false);
  });

  it('RUN_CONTROL_ACTIONS 包含 interrupt/resume/rollback', () => {
    expect(RUN_CONTROL_ACTIONS.has('interrupt')).toBe(true);
    expect(RUN_CONTROL_ACTIONS.has('resume')).toBe(true);
    expect(RUN_CONTROL_ACTIONS.has('rollback')).toBe(true);
    expect(RUN_CONTROL_ACTIONS.has('approve' as never)).toBe(false);
  });
});

describe('RunControlRequest — TS 类型层 discriminated union', () => {
  it('rollback 请求必须配 checkpointId', () => {
    const req: RunControlRequest = { action: 'rollback', checkpointId: 'cp-1' };
    expect(req.action).toBe('rollback');
  });

  it('interrupt 请求不需要 checkpointId', () => {
    const req: RunControlRequest = { action: 'interrupt' };
    expect(req.action).toBe('interrupt');
  });

  it('resume 请求不需要 checkpointId', () => {
    const req: RunControlRequest = { action: 'resume' };
    expect(req.action).toBe('resume');
  });
});

describe('RunControlResult schema', () => {
  it('接受合法的 accepted result', () => {
    const result: RunControlResult = {
      targetRunId: 'run-1',
      controlRunId: 'run-ctrl-1',
      threadId: 'thread-1',
      action: 'interrupt',
      accepted: true,
    };
    expect(runControlResultSchema.parse(result)).toEqual(result);
  });

  it('接受带 reason 的 rejected result', () => {
    const result = {
      targetRunId: 'run-1',
      controlRunId: 'run-ctrl-1',
      threadId: 'thread-1',
      action: 'rollback',
      accepted: false,
      reason: 'run is not in a resumable state',
    };
    expect(runControlResultSchema.parse(result)).toEqual(result);
  });

  it('拒绝缺 targetRunId 的 result', () => {
    const result = {
      controlRunId: 'run-ctrl-1',
      threadId: 'thread-1',
      action: 'interrupt',
      accepted: true,
    };
    expect(() => runControlResultSchema.parse(result)).toThrow();
  });

  it('拒绝缺 controlRunId 的 result', () => {
    const result = {
      targetRunId: 'run-1',
      threadId: 'thread-1',
      action: 'interrupt',
      accepted: true,
    };
    expect(() => runControlResultSchema.parse(result)).toThrow();
  });

  it('拒绝未知字段', () => {
    const result = {
      targetRunId: 'run-1',
      controlRunId: 'run-ctrl-1',
      threadId: 'thread-1',
      action: 'interrupt',
      accepted: true,
      bogus: true,
    };
    expect(() => runControlResultSchema.parse(result)).toThrow();
  });

  it('拒绝非法 action', () => {
    const result = {
      targetRunId: 'run-1',
      controlRunId: 'run-ctrl-1',
      threadId: 'thread-1',
      action: 'pause',
      accepted: true,
    };
    expect(() => runControlResultSchema.parse(result)).toThrow();
  });
});

describe('RunControlCapabilities schema', () => {
  it('接受合法的 capabilities', () => {
    const caps: RunControlCapabilities = {
      interrupt: { enabled: true },
      resume: { enabled: false, reason: 'run is active' },
      rollback: { enabled: true, checkpointIds: ['cp-1', 'cp-2'] },
    };
    expect(runControlCapabilitiesSchema.parse(caps)).toEqual(caps);
  });

  it('拒绝缺 interrupt 的 capabilities', () => {
    const caps = {
      resume: { enabled: false },
      rollback: { enabled: true, checkpointIds: [] },
    };
    expect(() => runControlCapabilitiesSchema.parse(caps)).toThrow();
  });

  it('拒绝 rollback 缺 checkpointIds', () => {
    const caps = {
      interrupt: { enabled: false },
      resume: { enabled: false },
      rollback: { enabled: true },
    };
    expect(() => runControlCapabilitiesSchema.parse(caps)).toThrow();
  });

  it('拒绝未知字段', () => {
    const caps = {
      interrupt: { enabled: false },
      resume: { enabled: false },
      rollback: { enabled: true, checkpointIds: [] },
      unexpected: true,
    };
    expect(() => runControlCapabilitiesSchema.parse(caps)).toThrow();
  });
});

describe('computeRunControlCapabilities', () => {
  it('运行中 run 允许 interrupt，不允许 resume', () => {
    const caps = computeRunControlCapabilities({ runStatus: 'running', active: true });
    expect(caps.interrupt.enabled).toBe(true);
    expect(caps.resume.enabled).toBe(false);
    expect(caps.rollback.enabled).toBe(true);
  });

  it('已完成 run 不允许 interrupt，允许 resume', () => {
    const caps = computeRunControlCapabilities({ runStatus: 'completed', active: false });
    expect(caps.interrupt.enabled).toBe(false);
    expect(caps.resume.enabled).toBe(true);
  });

  it('interrupted 状态允许 resume', () => {
    const caps = computeRunControlCapabilities({ runStatus: 'interrupted', active: false });
    expect(caps.interrupt.enabled).toBe(false);
    expect(caps.resume.enabled).toBe(true);
  });

  it('rollback 始终启用，并返回传入的 checkpointIds', () => {
    const caps = computeRunControlCapabilities({
      runStatus: 'running',
      active: true,
      checkpointIds: ['cp-a', 'cp-b'],
    });
    expect(caps.rollback.enabled).toBe(true);
    expect(caps.rollback.checkpointIds).toEqual(['cp-a', 'cp-b']);
  });

  it('未传 checkpointIds 时 rollback.checkpointIds 为空数组', () => {
    const caps = computeRunControlCapabilities({ runStatus: 'running', active: true });
    expect(caps.rollback.checkpointIds).toEqual([]);
  });
});

describe('RunControlAction — TS 类型层', () => {
  it('RunControlAction 等于 RunControlRequest[\'action\']', () => {
    const a: RunControlAction = 'interrupt';
    const b: RunControlAction = 'resume';
    const c: RunControlAction = 'rollback';
    expect([a, b, c]).toEqual(['interrupt', 'resume', 'rollback']);
  });
});
