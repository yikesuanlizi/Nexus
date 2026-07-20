import { describe, expect, it } from 'vitest';
import {
  threadEventSchema,
  taskRuntimeUpdatedEventSchema,
  taskCognitionUpdatedEventSchema,
  taskContextUpdatedEventSchema,
  taskLoopUpdatedEventSchema,
} from './schemas.js';

describe('Task Runtime 事件 schema（第 2 步骨架）', () => {
  it('task.runtime.updated 通过 threadEventSchema 解析', () => {
    const event = {
      type: 'task.runtime.updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'before_turn',
      status: 'running',
      runProfile: 'runtime_os',
      timestamp: new Date().toISOString(),
    };
    expect(threadEventSchema.parse(event)).toEqual(event);
    expect(taskRuntimeUpdatedEventSchema.parse(event)).toEqual(event);
  });

  it('task.cognition.updated 通过 threadEventSchema 解析', () => {
    const event = {
      type: 'task.cognition.updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      cognition: {
        goal: '介绍航空保障包',
        constraints: ['必须基于现有资料'],
        knownFacts: ['扩展包用于补充能力'],
        unknowns: [],
        risks: [],
        confidence: 0.7,
        verificationCriteria: ['说明用途'],
      },
      timestamp: new Date().toISOString(),
    };
    expect(threadEventSchema.parse(event)).toEqual(event);
    expect(taskCognitionUpdatedEventSchema.parse(event)).toEqual(event);
  });

  it('task.context.updated 只接收 metadata，不接收完整 chunk content', () => {
    const event = {
      type: 'task.context.updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      chunks: [
        {
          id: 'chunk-task-1',
          source: 'task-context-provider',
          tokens: 120,
          priority: 10,
          truncated: false,
          summary: '当前任务认知摘要',
        },
      ],
      usedTokens: 120,
      remainingTokens: 7880,
      timestamp: new Date().toISOString(),
    };
    const parsed = taskContextUpdatedEventSchema.parse(event);
    expect(parsed.chunks[0]).not.toHaveProperty('content');
    // chunk 字段中不应有 content / prompt 等敏感字段
    expect(JSON.stringify(parsed)).not.toContain('prompt');
    expect(JSON.stringify(parsed)).not.toContain('content');
    // 通过总 schema 也能解析
    expect(threadEventSchema.parse(event)).toEqual(event);
  });

  it('task.loop.updated 兼容 harness continuation 状态', () => {
    const event = {
      type: 'task.loop.updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      loopId: 'harness-run-001',
      iteration: 2,
      maxIterations: 8,
      noProgressCount: 0,
      continuationReason: 'continue',
      status: 'active',
      timestamp: new Date().toISOString(),
    };
    expect(threadEventSchema.parse(event)).toEqual(event);
    expect(taskLoopUpdatedEventSchema.parse(event)).toEqual(event);
  });

  it('拒绝缺少必填字段的事件', () => {
    expect(() => taskRuntimeUpdatedEventSchema.parse({ type: 'task.runtime.updated' })).toThrow();
    expect(() => taskCognitionUpdatedEventSchema.parse({ type: 'task.cognition.updated', threadId: 't' })).toThrow();
  });
});
