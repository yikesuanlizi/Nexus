import { describe, expect, it } from 'vitest';
import { PostgresThreadStore, type PgClientLike } from './postgres.js';
import type { RunTraceDraft, ThreadMeta } from '@nexus/protocol';
import type { RunTraceStore } from './runTraceStore.js';

class RecordingPgClient implements PgClientLike {
  calls: Array<{ text: string; params: unknown[] }> = [];
  runRows = new Map<string, Record<string, unknown>>();
  traceHeads = new Map<string, number>();

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
    this.calls.push({ text, params });
    if (/SELECT \* FROM threads WHERE tenant_id = \$1 AND thread_id = \$2/.test(text)) {
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM threads WHERE tenant_id = \$1/.test(text)) {
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM run_records WHERE tenant_id = \$1 AND run_id = \$2/.test(text)) {
      const row = this.runRows.get(`${String(params[0])}:${String(params[1])}`);
      return { rows: (row ? [row] : []) as T[] };
    }
    if (/SELECT next_sequence FROM run_trace_heads WHERE tenant_id = \$1 AND run_id = \$2/.test(text)) {
      const next = this.traceHeads.get(`${String(params[0])}:${String(params[1])}`);
      return { rows: (next === undefined ? [] : [{ next_sequence: next }]) as T[] };
    }
    if (/INSERT INTO run_trace_heads/.test(text)) {
      this.traceHeads.set(`${String(params[0])}:${String(params[1])}`, Number(params[2]));
      return { rows: [] as T[] };
    }
    if (/UPDATE run_trace_heads SET next_sequence/.test(text)) {
      this.traceHeads.set(`${String(params[1])}:${String(params[2])}`, Number(params[0]));
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM run_trace_events/.test(text)) {
      return { rows: [] as T[] };
    }
    if (/SELECT value FROM settings/.test(text)) {
      return { rows: [] as T[] };
    }
    if (/SELECT COUNT\(\*\)::int AS count FROM thread_rollout_entries/.test(text)) {
      return { rows: [{ count: 0 } as T] };
    }
    return { rows: [] as T[] };
  }
}

function pgRunRow(runId = 'run-pg', tenantId = 'tenantTrace'): Record<string, unknown> {
  const now = '2026-07-21T00:00:00.000Z';
  return {
    tenant_id: tenantId,
    run_id: runId,
    thread_id: 'thread-pg',
    turn_id: 'turn-pg',
    kind: 'turn',
    status: 'running',
    caller: 'lead_agent',
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    tool_call_count: 0,
    model_call_count: 0,
    subagent_count: 0,
    middleware_event_count: 0,
    started_at: now,
    updated_at: now,
    metadata: {},
  };
}

function pgTraceDraft(runId = 'run-pg'): RunTraceDraft {
  return {
    runId,
    runKind: 'turn',
    threadId: 'thread-pg',
    turnId: 'turn-pg',
    spanId: 'span:run-pg:model:1',
    category: 'model',
    name: 'model',
    lifecycle: 'started',
    level: 'info',
    occurredAt: '2026-07-21T00:00:00.000Z',
    payload: { provider: 'openai', model: 'gpt-5', attempt: 1, streaming: true },
  };
}

function thread(threadId: string): ThreadMeta {
  const now = '2026-06-15T00:00:00.000Z';
  return {
    threadId,
    title: threadId,
    workspaceRoot: 'E:/workspace',
    status: 'active',
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ephemeral: false,
    tags: {},
  };
}

describe('PostgresThreadStore', () => {
  it('keeps tenant_id in metadata writes and owner-filtered reads', async () => {
    const client = new RecordingPgClient();
    const store = new PostgresThreadStore(client, 'tenantA');

    await store.createThread({ ...thread('thread-a'), tenantId: 'client-ignored' });
    await store.getThread('thread-a');
    await store.listThreads({ limit: 5 });

    const insert = client.calls.find((call) => call.text.includes('INSERT INTO threads'));
    expect(insert?.params[0]).toBe('tenantA');
    expect(insert?.params).not.toContain('client-ignored');
    expect(client.calls.some((call) => /WHERE tenant_id = \$1 AND thread_id = \$2/.test(call.text))).toBe(true);
    expect(client.calls.some((call) => /WHERE tenant_id = \$1\s+ORDER BY updated_at DESC\s+LIMIT \$2/.test(call.text))).toBe(true);
  });

  it('stores rollout entries in postgres instead of filesystem paths', async () => {
    const client = new RecordingPgClient();
    const store = new PostgresThreadStore(client, 'tenantB');

    await store.appendItems('thread-b', [
      { id: 'item-b', type: 'agent_message', turnId: 'turn-b', text: 'stored in postgres' },
    ]);

    const insert = client.calls.find((call) => call.text.includes('INSERT INTO thread_rollout_entries'));
    expect(insert?.params.slice(0, 4)).toEqual(['tenantB', 'thread-b', 0, 'item']);
    expect(JSON.stringify(insert?.params[4])).toContain('stored in postgres');
  });

  it('scopes settings by tenant while keeping schema version global', async () => {
    const client = new RecordingPgClient();
    const store = new PostgresThreadStore(client, 'tenantC');

    await store.setSetting('runConfig.default', { model: 'tenant-model' });
    await store.setSetting('storage.schemaVersion', { version: 3 });

    expect(client.calls.find((call) => call.params[0] === 'tenant:tenantC:runConfig.default')).toBeTruthy();
    expect(client.calls.find((call) => call.params[0] === 'storage.schemaVersion')).toBeTruthy();
  });

  it('writes and queries memory records with tenant scope', async () => {
    const client = new RecordingPgClient();
    const store = new PostgresThreadStore(client, 'tenantMem');

    await store.upsertMemoryRecord({
      id: 'mem-pg',
      type: 'project_fact',
      text: 'Postgres keeps memory rows tenant scoped.',
      status: 'active',
      scope: 'workspace',
      sourceThreadId: 'thread-pg',
      sourceTurnIds: ['turn-pg'],
      workspaceRoot: 'E:/workspace',
      tags: ['storage'],
      confidence: 0.8,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
    });
    await store.searchMemoryRecords('memory', { workspaceRoot: 'E:/workspace', limit: 5 });
    await store.recordMemoryUsage('mem-pg', '2026-06-19T00:01:00.000Z');
    await store.deleteMemoryRecord('mem-pg');

    expect(client.calls.find((call) => call.text.includes('INSERT INTO memory_records'))?.params[0]).toBe('tenantMem');
    expect(client.calls.some((call) => /FROM memory_records\s+WHERE tenant_id = \$1/.test(call.text))).toBe(true);
    expect(client.calls.find((call) => call.text.includes('usage_count = usage_count + 1'))?.params.slice(0, 3)).toEqual(['tenantMem', 'mem-pg', '2026-06-19T00:01:00.000Z']);
    expect(client.calls.find((call) => call.text.includes("status = 'deleted'"))?.params).toEqual(['tenantMem', 'mem-pg']);
  });

  it('writes and queries run monitor rows with tenant scope', async () => {
    const client = new RecordingPgClient();
    const store = new PostgresThreadStore(client, 'tenantRun');

    await store.createRunRecord({
      runId: 'run-pg',
      tenantId: 'client-ignored',
      threadId: 'thread-pg',
      kind: 'turn',
      status: 'running',
      caller: 'lead_agent',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      toolCallCount: 0,
      modelCallCount: 0,
      subagentCount: 0,
      middlewareEventCount: 0,
      startedAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
    });
    await store.appendRunEvent({
      eventId: 'event-pg',
      runId: 'run-pg',
      tenantId: 'client-ignored',
      threadId: 'thread-pg',
      sequence: 1,
      category: 'turn',
      type: 'turn.started',
      level: 'info',
      message: 'started',
      metadata: {},
      createdAt: '2026-06-16T00:00:00.000Z',
    });
    await store.listRunRecords({ threadId: 'thread-pg', status: 'running', limit: 5 });
    await store.listRunEvents('run-pg');

    expect(client.calls.find((call) => call.text.includes('INSERT INTO run_records'))?.params[0]).toBe('tenantRun');
    expect(client.calls.find((call) => call.text.includes('INSERT INTO run_events'))?.params[0]).toBe('tenantRun');
    expect(client.calls.some((call) => /FROM run_records WHERE tenant_id = \$1/.test(call.text))).toBe(true);
    expect(client.calls.some((call) => /FROM run_events WHERE tenant_id = \$1 AND run_id = \$2/.test(call.text))).toBe(true);
  });

  it('writes and queries run trace rows with tenant scope and sequence heads', async () => {
    const client = new RecordingPgClient();
    client.runRows.set('tenantTrace:run-pg', pgRunRow());
    const store = new PostgresThreadStore(client, 'tenantTrace') as PostgresThreadStore & RunTraceStore;

    const first = await store.appendRunTraceEvent(pgTraceDraft());
    const second = await store.appendRunTraceEvent({ ...pgTraceDraft(), spanId: 'span:run-pg:model:2' });
    await store.listRunTraceEvents('run-pg', { after: 1, limit: 10 });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(client.calls.find((call) => call.text.includes('INSERT INTO run_trace_events'))?.params[0]).toBe('tenantTrace');
    expect(client.calls.some((call) => /FROM run_trace_events WHERE tenant_id = \$1 AND run_id = \$2/.test(call.text))).toBe(true);
    expect(client.traceHeads.get('tenantTrace:run-pg')).toBe(3);
  });
});
