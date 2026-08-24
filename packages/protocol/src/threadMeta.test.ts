import { describe, expect, it } from 'vitest';
import { threadMetaSchema, threadModeSchema, threadTaskPresetSchema } from './schemas.js';
import type { ThreadMeta, ThreadMode, ThreadTaskPreset } from './types.js';

const legacyThread: ThreadMeta = {
  threadId: 'thread-1',
  title: '旧线程',
  workspaceRoot: 'D:/workspace',
  status: 'active',
  turnCount: 0,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
  archivedAt: null,
  ephemeral: false,
  tags: {},
};

describe('Thread Ops entrance metadata', () => {
  it('accepts chat and ops modes without changing runProfile', () => {
    const mode: ThreadMode = 'ops';
    const taskPreset: ThreadTaskPreset = 'ops';
    const parsed = threadMetaSchema.parse({ ...legacyThread, mode, taskPreset });
    expect(parsed.mode).toBe('ops');
    expect(parsed.taskPreset).toBe('ops');
  });

  it('keeps legacy thread metadata compatible and permits clearing the preset', () => {
    expect(threadMetaSchema.parse(legacyThread)).toEqual(legacyThread);
    expect(
      threadMetaSchema.parse({ ...legacyThread, mode: 'chat', taskPreset: null }),
    ).toMatchObject({
      mode: 'chat',
      taskPreset: null,
    });
  });

  it('rejects unsupported modes and task presets', () => {
    expect(threadModeSchema.safeParse('runtime_os').success).toBe(false);
    expect(threadTaskPresetSchema.safeParse('incident_response').success).toBe(false);
    expect(() => threadMetaSchema.parse({ ...legacyThread, mode: 'runtime_os' })).toThrow();
  });
});
