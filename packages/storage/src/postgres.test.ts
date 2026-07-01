import { describe, expect, it } from 'vitest';
import { PostgresThreadStore, type PgClientLike } from './postgres.js';
import type { ThreadMeta } from '@nexus/protocol';

class RecordingPgClient implements PgClientLike {
  calls: Array<{ text: string; params: unknown[] }> = [];
  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
    this.calls.push({ text, params });
    if (/SELECT \* FROM threads WHERE tenant_id = \$1 AND thread_id = \$2/.test(text)) {
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM threads WHERE tenant_id = \$1/.test(text)) {
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
});
