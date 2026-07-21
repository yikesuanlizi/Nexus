// RunTrace V2 协议测试：覆盖 envelope 关联性、lifecycle、sequence/version、schema strict、JSON 往返、runKind/turnId 关联
// — English: RunTrace V2 tests covering envelope correlation, lifecycle, sequence/version, schema strictness, JSON round-trip, runKind/turnId
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RUN_TRACE_VERSION } from './runTrace.js';
import type { RunTraceEnvelope, RunTraceDraft, RunTraceObservation } from './runTrace.js';
import {
  runTraceEnvelopeSchema,
  runTraceEnvelopeSchemasByCategory,
  runTraceDraftSchema,
  runTraceObservationSchema,
} from './runTraceSchemas.js';

// 构造合法的 model envelope（带必要字段），用于后续测试复用
// — English: build a valid model envelope for reuse across tests
function makeModelEnvelope(overrides: Partial<RunTraceEnvelope> = {}): RunTraceEnvelope {
  return {
    version: RUN_TRACE_VERSION,
    eventId: 'evt-1',
    sequence: 1,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: 'span-1',
    category: 'model',
    name: 'model.call',
    lifecycle: 'completed',
    level: 'info',
    occurredAt: '2026-07-20T00:00:00.000Z',
    durationMs: 120,
    payload: {
      provider: 'openai',
      model: 'gpt-4o',
      attempt: 1,
      streaming: true,
      ttftMs: 30,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      finishReason: 'stop',
    },
    ...overrides,
  } as RunTraceEnvelope;
}

// 构造合法的 tool envelope
// — English: build a valid tool envelope
function makeToolEnvelope(overrides: Partial<RunTraceEnvelope> = {}): RunTraceEnvelope {
  return {
    version: RUN_TRACE_VERSION,
    eventId: 'evt-2',
    sequence: 2,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: 'span-2',
    parentSpanId: 'span-1',
    itemId: 'item-tool-1',
    category: 'tool',
    name: 'tool.search',
    lifecycle: 'completed',
    level: 'info',
    occurredAt: '2026-07-20T00:00:01.000Z',
    durationMs: 80,
    payload: {
      toolName: 'search',
      callId: 'call-1',
      decision: 'allow',
      argsSummary: { query: 'hello' },
      resultSummary: { count: 3 },
      exitCode: 0,
      outputBytes: 128,
    },
    ...overrides,
  } as RunTraceEnvelope;
}

// 构造合法的 item envelope
// — English: build a valid item envelope
function makeItemEnvelope(overrides: Partial<RunTraceEnvelope> = {}): RunTraceEnvelope {
  return {
    version: RUN_TRACE_VERSION,
    eventId: 'evt-3',
    sequence: 3,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: 'span-3',
    parentSpanId: 'span-1',
    itemId: 'item-1',
    category: 'item',
    name: 'item.started',
    lifecycle: 'instant',
    level: 'info',
    occurredAt: '2026-07-20T00:00:02.000Z',
    payload: { itemType: 'user_message', status: 'completed' },
    ...overrides,
  } as RunTraceEnvelope;
}

describe('RunTrace envelope — TS 类型层关联性', () => {
  it('RunTraceEnvelope 是 model envelope 时 payload 必须是 model payload 形状', () => {
    const modelEvent: RunTraceEnvelope = makeModelEnvelope();
    expectTypeOf(modelEvent).toMatchTypeOf<RunTraceEnvelope>();
    expect(modelEvent.category).toBe('model');
  });

  it('model 事件不能携带 tool payload（TS 编译期约束）', () => {
    // 故意写错 payload 类型；TS 应当报错
    // — English: intentionally wrong payload; TS should reject
    const badModelEvent: RunTraceEnvelope = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-bad',
      sequence: 1,
      runId: 'run-1',
      runKind: 'turn',
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-bad',
      category: 'model',
      name: 'model.bad',
      lifecycle: 'instant',
      level: 'info',
      occurredAt: '2026-07-20T00:00:00.000Z',
      // @ts-expect-error — model category 不能配 tool payload
      payload: { toolName: 'search', callId: 'call-1' },
    };
    expect(badModelEvent).toBeDefined();
  });

  it('tool 事件不能携带 model payload', () => {
    const badToolEvent: RunTraceEnvelope = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-bad2',
      sequence: 1,
      runId: 'run-1',
      runKind: 'turn',
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-bad2',
      category: 'tool',
      name: 'tool.bad',
      lifecycle: 'instant',
      level: 'info',
      occurredAt: '2026-07-20T00:00:00.000Z',
      // @ts-expect-error — tool category 不能配 model payload
      payload: { provider: 'openai', model: 'gpt-4o', attempt: 1, streaming: true },
    };
    expect(badToolEvent).toBeDefined();
  });
});

describe('RunTrace envelope — schema 层关联性', () => {
  it('model 事件携带 tool payload 会被 schema 拒绝', () => {
    const badEvent = {
      ...makeModelEnvelope(),
      payload: { toolName: 'search', callId: 'call-1' },
    };
    expect(() => runTraceEnvelopeSchema.parse(badEvent)).toThrow();
  });

  it('合法的 model envelope 通过 schema', () => {
    const event = makeModelEnvelope();
    expect(runTraceEnvelopeSchema.parse(event)).toEqual(event);
  });

  it('合法的 tool envelope 通过 schema', () => {
    const event = makeToolEnvelope();
    expect(runTraceEnvelopeSchema.parse(event)).toEqual(event);
  });

  it('合法的 item envelope（带 itemId）通过 schema', () => {
    const event = makeItemEnvelope();
    expect(runTraceEnvelopeSchema.parse(event)).toEqual(event);
  });
});

describe('RunTrace lifecycle 与 durationMs / itemId 关联', () => {
  it('lifecycle=completed 时允许 durationMs', () => {
    const event = makeModelEnvelope({ lifecycle: 'completed', durationMs: 100 });
    expect(() => runTraceEnvelopeSchema.parse(event)).not.toThrow();
  });

  it('lifecycle=failed 时允许 durationMs', () => {
    const event = makeModelEnvelope({ lifecycle: 'failed', durationMs: 50 });
    expect(() => runTraceEnvelopeSchema.parse(event)).not.toThrow();
  });

  it('lifecycle=instant 时携带 durationMs 会被 schema 拒绝', () => {
    const event = makeModelEnvelope({ lifecycle: 'instant', durationMs: 1 });
    expect(() => runTraceEnvelopeSchema.parse(event)).toThrow();
  });

  it('lifecycle=started 时携带 durationMs 会被 schema 拒绝', () => {
    const event = makeModelEnvelope({ lifecycle: 'started', durationMs: 1 });
    expect(() => runTraceEnvelopeSchema.parse(event)).toThrow();
  });

  it('lifecycle=discarded 时携带 durationMs 会被 schema 拒绝', () => {
    const event = makeModelEnvelope({ lifecycle: 'discarded', durationMs: 1 });
    expect(() => runTraceEnvelopeSchema.parse(event)).toThrow();
  });

  it('category=item 但缺少 itemId 会被 schema 拒绝', () => {
    const { itemId, ...rest } = makeItemEnvelope();
    expect(itemId).toBe('item-1');
    expect(() => runTraceEnvelopeSchema.parse(rest)).toThrow();
  });

  it('category=item 且带 itemId 通过 schema', () => {
    const event = makeItemEnvelope({ itemId: 'item-x' });
    expect(() => runTraceEnvelopeSchema.parse(event)).not.toThrow();
  });
});

describe('RunTrace sequence 与 version 约束', () => {
  it('sequence 必须是大于 0 的整数', () => {
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), sequence: 0 })).toThrow();
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), sequence: -1 })).toThrow();
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), sequence: 1.5 })).toThrow();
  });

  it('version 只能是 2', () => {
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), version: 1 })).toThrow();
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), version: 3 })).toThrow();
    expect(() => runTraceEnvelopeSchema.parse({ ...makeModelEnvelope(), version: '2' as never })).toThrow();
  });

  it('RUN_TRACE_VERSION 常量等于 2', () => {
    expect(RUN_TRACE_VERSION).toBe(2);
  });
});

describe('RunTrace payload strict — 未知字段不能绕过 schema', () => {
  it('model payload 多了未知字段会被拒绝', () => {
    const badEvent = {
      ...makeModelEnvelope(),
      payload: { ...makeModelEnvelope().payload, bogus: 'unknown' },
    };
    expect(() => runTraceEnvelopeSchema.parse(badEvent)).toThrow();
  });

  it('tool payload 多了未知字段会被拒绝', () => {
    const toolEvent = makeToolEnvelope();
    const badEvent = {
      ...toolEvent,
      payload: { ...toolEvent.payload, surprise: true },
    };
    expect(() => runTraceEnvelopeSchema.parse(badEvent)).toThrow();
  });

  it('model payload 缺 provider 会被拒绝', () => {
    // 使用类型守卫将 payload 窄化到 model 分支，以访问 provider 字段
    // — English: use a type guard to narrow payload to model branch for provider access
    const envelope = makeModelEnvelope();
    if (envelope.category !== 'model') throw new Error('expected model envelope');
    const { provider, ...rest } = envelope.payload;
    expect(provider).toBe('openai');
    const badEvent = { ...envelope, payload: rest };
    expect(() => runTraceEnvelopeSchema.parse(badEvent)).toThrow();
  });

  it('envelope 顶层多了未知字段会被拒绝', () => {
    const badEvent = { ...makeModelEnvelope(), unknownTopField: true };
    expect(() => runTraceEnvelopeSchema.parse(badEvent)).toThrow();
  });
});

describe('RunTrace JSON 往返保持字段', () => {
  it('JSON.parse(JSON.stringify(envelope)) 保持 eventId/runId/turnId/spanId/parentSpanId/itemId/sequence', () => {
    const original = makeToolEnvelope(); // tool envelope 带 parentSpanId + itemId
    const roundTripped = JSON.parse(JSON.stringify(original)) as RunTraceEnvelope;
    expect(roundTripped.eventId).toBe(original.eventId);
    expect(roundTripped.runId).toBe(original.runId);
    expect(roundTripped.turnId).toBe(original.turnId);
    expect(roundTripped.spanId).toBe(original.spanId);
    expect(roundTripped.parentSpanId).toBe(original.parentSpanId);
    expect(roundTripped.itemId).toBe(original.itemId);
    expect(roundTripped.sequence).toBe(original.sequence);
    expect(roundTripped.version).toBe(RUN_TRACE_VERSION);
    expect(roundTripped.category).toBe(original.category);
    // schema 仍能解析往返后的对象
    expect(runTraceEnvelopeSchema.parse(roundTripped)).toEqual(original);
  });

  it('JSON 往返 control envelope（turnId:null）保持字段', () => {
    const controlEnvelope: RunTraceEnvelope = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ctrl',
      sequence: 10,
      runId: 'run-ctrl-1',
      runKind: 'control',
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-ctrl',
      category: 'control',
      name: 'control.interrupt',
      lifecycle: 'instant',
      level: 'info',
      occurredAt: '2026-07-20T00:00:10.000Z',
      payload: { action: 'interrupt', outcome: 'accepted' },
    } as RunTraceEnvelope;
    const roundTripped = JSON.parse(JSON.stringify(controlEnvelope)) as RunTraceEnvelope;
    expect(roundTripped.runId).toBe('run-ctrl-1');
    expect(roundTripped.threadId).toBe('thread-1');
    expect(roundTripped.turnId).toBeNull();
    expect(roundTripped.spanId).toBe('span-ctrl');
    expect(roundTripped.eventId).toBe('evt-ctrl');
    expect(roundTripped.sequence).toBe(10);
    expect(runTraceEnvelopeSchema.parse(roundTripped)).toEqual(controlEnvelope);
  });
});

describe('RunTrace runKind 与 turnId 关联', () => {
  it('runKind=turn 必须有 turnId', () => {
    const withoutTurnId = { ...makeModelEnvelope(), turnId: undefined };
    expect(() => runTraceEnvelopeSchema.parse(withoutTurnId)).toThrow();
    const withNullTurnId = { ...makeModelEnvelope(), turnId: null };
    expect(() => runTraceEnvelopeSchema.parse(withNullTurnId)).toThrow();
  });

  it('runKind=control 允许 turnId:null，但仍必须有 runId/threadId/spanId', () => {
    const controlEvent: RunTraceEnvelope = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ctrl-2',
      sequence: 11,
      runId: 'run-ctrl-2',
      runKind: 'control',
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-ctrl-2',
      category: 'control',
      name: 'control.resume',
      lifecycle: 'instant',
      level: 'info',
      occurredAt: '2026-07-20T00:00:20.000Z',
      payload: { action: 'resume', outcome: 'completed' },
    } as RunTraceEnvelope;
    expect(() => runTraceEnvelopeSchema.parse(controlEvent)).not.toThrow();
    expect(runTraceEnvelopeSchema.parse(controlEvent)).toEqual(controlEvent);
  });

  it('runKind=workflow 允许 turnId:null', () => {
    const workflowEvent: RunTraceEnvelope = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-wf',
      sequence: 12,
      runId: 'run-wf',
      runKind: 'workflow',
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-wf',
      category: 'checkpoint',
      name: 'workflow.checkpoint',
      lifecycle: 'instant',
      level: 'info',
      occurredAt: '2026-07-20T00:00:30.000Z',
      payload: { checkpointId: 'cp-1', turnCount: 3, itemIndex: 5, status: 'completed' },
    } as RunTraceEnvelope;
    expect(() => runTraceEnvelopeSchema.parse(workflowEvent)).not.toThrow();
  });

  it('runKind=control 缺少 runId 会被拒绝', () => {
    const { runId, ...rest } = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ctrl-3',
      sequence: 13,
      runId: 'run-ctrl-3',
      runKind: 'control' as const,
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-ctrl-3',
      category: 'control' as const,
      name: 'control.resume',
      lifecycle: 'instant' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:40.000Z',
      payload: { action: 'resume' as const, outcome: 'completed' as const },
    };
    expect(runId).toBe('run-ctrl-3');
    expect(() => runTraceEnvelopeSchema.parse(rest)).toThrow();
  });

  it('runKind=control 缺少 threadId 会被拒绝', () => {
    const { threadId, ...rest } = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ctrl-4',
      sequence: 14,
      runId: 'run-ctrl-4',
      runKind: 'control' as const,
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-ctrl-4',
      category: 'control' as const,
      name: 'control.interrupt',
      lifecycle: 'instant' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:50.000Z',
      payload: { action: 'interrupt' as const, outcome: 'accepted' as const },
    };
    expect(threadId).toBe('thread-1');
    expect(() => runTraceEnvelopeSchema.parse(rest)).toThrow();
  });

  it('runKind=control 缺少 spanId（root span）会被拒绝', () => {
    const { spanId, ...rest } = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ctrl-5',
      sequence: 15,
      runId: 'run-ctrl-5',
      runKind: 'control' as const,
      threadId: 'thread-1',
      turnId: null,
      spanId: 'span-ctrl-5',
      category: 'control' as const,
      name: 'control.interrupt',
      lifecycle: 'instant' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:01:00.000Z',
      payload: { action: 'interrupt' as const, outcome: 'accepted' as const },
    };
    expect(spanId).toBe('span-ctrl-5');
    expect(() => runTraceEnvelopeSchema.parse(rest)).toThrow();
  });
});

describe('RunTraceDraft / RunTraceObservation 派生类型', () => {
  it('RunTraceDraft 不含 eventId/sequence/version', () => {
    const draft: RunTraceDraft = {
      runId: 'run-1',
      runKind: 'turn',
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-1',
      category: 'model',
      name: 'model.call',
      lifecycle: 'completed',
      level: 'info',
      occurredAt: '2026-07-20T00:00:00.000Z',
      durationMs: 100,
      payload: { provider: 'openai', model: 'gpt-4o', attempt: 1, streaming: true },
    } as RunTraceDraft;
    expectTypeOf(draft).toMatchTypeOf<RunTraceDraft>();
    expect(draft.runId).toBe('run-1');
    // 不应包含 storage identity 字段
    expectTypeOf(draft).not.toHaveProperty('eventId');
    expectTypeOf(draft).not.toHaveProperty('sequence');
    expectTypeOf(draft).not.toHaveProperty('version');
  });

  it('RunTraceObservation 不含 runId/parentRunId/threadId/turnId', () => {
    const observation: RunTraceObservation = {
      spanId: 'span-1',
      category: 'model',
      name: 'model.call',
      lifecycle: 'completed',
      level: 'info',
      occurredAt: '2026-07-20T00:00:00.000Z',
      durationMs: 100,
      payload: { provider: 'openai', model: 'gpt-4o', attempt: 1, streaming: true },
    } as RunTraceObservation;
    expectTypeOf(observation).toMatchTypeOf<RunTraceObservation>();
    expectTypeOf(observation).not.toHaveProperty('runId');
    expectTypeOf(observation).not.toHaveProperty('parentRunId');
    expectTypeOf(observation).not.toHaveProperty('threadId');
    expectTypeOf(observation).not.toHaveProperty('turnId');
  });

  it('runTraceDraftSchema 接受无 storage identity 的事件', () => {
    const draft = {
      runId: 'run-1',
      runKind: 'turn' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-1',
      category: 'model' as const,
      name: 'model.call',
      lifecycle: 'completed' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:00.000Z',
      durationMs: 100,
      payload: { provider: 'openai', model: 'gpt-4o', attempt: 1, streaming: true },
    };
    expect(() => runTraceDraftSchema.parse(draft)).not.toThrow();
  });

  it('runTraceObservationSchema 接受无 run context 的事件', () => {
    // observation 保留 runKind（不属于 run context），仅去掉 runId/parentRunId/threadId/turnId
    // — English: observation keeps runKind (not part of run context); only runId/parentRunId/threadId/turnId are removed
    const observation = {
      runKind: 'turn' as const,
      spanId: 'span-1',
      category: 'model' as const,
      name: 'model.call',
      lifecycle: 'completed' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:00.000Z',
      durationMs: 100,
      payload: { provider: 'openai', model: 'gpt-4o', attempt: 1, streaming: true },
    };
    expect(() => runTraceObservationSchema.parse(observation)).not.toThrow();
  });
});

describe('RunTrace 各 category payload schema 独立校验', () => {
  it('每个 category 都有对应的 envelope schema', () => {
    const categories = Object.keys(runTraceEnvelopeSchemasByCategory);
    expect(categories).toHaveLength(14);
    expect(categories.sort()).toEqual([
      'agent', 'checkpoint', 'context', 'control', 'error', 'evidence',
      'file', 'item', 'iteration', 'memory', 'middleware', 'model',
      'tool', 'turn',
    ]);
  });

  it('checkpoint envelope payload 缺 status 会被拒绝', () => {
    const cpEvent = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-cp',
      sequence: 1,
      runId: 'run-1',
      runKind: 'turn' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-cp',
      category: 'checkpoint' as const,
      name: 'checkpoint.created',
      lifecycle: 'instant' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:00.000Z',
      payload: {
        checkpointId: 'cp-1',
        turnCount: 3,
        itemIndex: 5,
        // status 缺失
      },
    };
    expect(() => runTraceEnvelopeSchema.parse(cpEvent)).toThrow();
  });

  it('evidence envelope payload 包含未知字段会被拒绝', () => {
    const ev = {
      version: RUN_TRACE_VERSION,
      eventId: 'evt-ev',
      sequence: 1,
      runId: 'run-1',
      runKind: 'turn' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      spanId: 'span-ev',
      category: 'evidence' as const,
      name: 'evidence.passed',
      lifecycle: 'instant' as const,
      level: 'info' as const,
      occurredAt: '2026-07-20T00:00:00.000Z',
      payload: { kind: 'test', label: 'unit-test', passed: true, unknown: 'x' },
    };
    expect(() => runTraceEnvelopeSchema.parse(ev)).toThrow();
  });
});
