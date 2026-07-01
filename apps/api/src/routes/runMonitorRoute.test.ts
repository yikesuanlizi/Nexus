import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunRecord, ThreadStore } from '@nexus/storage';
import { handleRunMonitorRoute } from './runMonitorRoute.js';
import type { TenantContext } from '../shared/tenant.js';

class FakeStore implements Partial<ThreadStore> {
  runs: RunRecord[] = [{
    runId: 'run-a',
    tenantId: 'tenantA',
    threadId: 'thread-a',
    kind: 'turn',
    status: 'running',
    caller: 'lead_agent',
    inputTokens: 1,
    cachedInputTokens: 0,
    outputTokens: 2,
    reasoningOutputTokens: 0,
    toolCallCount: 1,
    modelCallCount: 1,
    subagentCount: 0,
    middlewareEventCount: 0,
    startedAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:01.000Z',
  }];
  events: RunEvent[] = [{
    eventId: 'event-a',
    runId: 'run-a',
    tenantId: 'tenantA',
    threadId: 'thread-a',
    sequence: 1,
    category: 'turn',
    type: 'turn.started',
    level: 'info',
    message: 'started',
    metadata: {},
    createdAt: '2026-06-16T00:00:00.000Z',
  }];
  updates: Array<{ runId: string; patch: Partial<RunRecord> }> = [];
  appended: RunEvent[] = [];

  async listRunRecords() {
    return this.runs;
  }

  async listRunEvents(runId: string) {
    return this.events.filter((event) => event.runId === runId);
  }

  async updateRunRecord(runId: string, patch: Partial<RunRecord>) {
    this.updates.push({ runId, patch });
  }

  async appendRunEvent(event: RunEvent) {
    this.appended.push(event);
  }
}

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new PassThrough();
  const req = stream as unknown as IncomingMessage;
  req.method = method;
  req.url = path;
  req.headers = headers;
  if (body !== undefined) stream.end(JSON.stringify(body));
  else stream.end();
  return req;
}

function response() {
  const chunks: Buffer[] = [];
  const res = new PassThrough() as unknown as ServerResponse & { statusCode: number; headers: Record<string, unknown>; body?: unknown };
  res.headers = {};
  res.writeHead = ((status: number, headers?: Record<string, unknown>) => {
    res.statusCode = status;
    res.headers = headers ?? {};
    return res;
  }) as never;
  res.write = ((chunk: string | Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }) as never;
  res.end = ((chunk?: string | Buffer) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    res.body = text ? JSON.parse(text) : undefined;
    return res;
  }) as never;
  return res;
}

const tenantContext: TenantContext = { tenantId: 'tenantA' };

describe('run monitor route', () => {
  it('lists current tenant runs and events', async () => {
    const store = new FakeStore();
    const res = response();

    const handled = await handleRunMonitorRoute({
      req: request('GET', '/api/runs?threadId=thread-a'),
      res,
      url: new URL('http://localhost/api/runs?threadId=thread-a'),
      segments: ['api', 'runs'],
      store: store as unknown as ThreadStore,
      tenantContext,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ runs: store.runs });

    const eventsRes = response();
    await handleRunMonitorRoute({
      req: request('GET', '/api/runs/run-a/events'),
      res: eventsRes,
      url: new URL('http://localhost/api/runs/run-a/events'),
      segments: ['api', 'runs', 'run-a', 'events'],
      store: store as unknown as ThreadStore,
      tenantContext,
    });
    expect(eventsRes.body).toEqual({ events: store.events });
  });

  it('requires admin token for cross-tenant monitor routes', async () => {
    const res = response();
    const handled = await handleRunMonitorRoute({
      req: request('GET', '/api/admin/runs'),
      res,
      url: new URL('http://localhost/api/admin/runs'),
      segments: ['api', 'admin', 'runs'],
      store: new FakeStore() as unknown as ThreadStore,
      tenantContext,
      adminToken: 'secret',
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Admin monitor token is required' });
  });

  it('records control actions as monitor events', async () => {
    const store = new FakeStore();
    const onControlRun = vi.fn(async () => ({ interrupted: true }));
    const res = response();

    await handleRunMonitorRoute({
      req: request('POST', '/api/runs/run-a/control', { action: 'interrupt', threadId: 'thread-a' }),
      res,
      url: new URL('http://localhost/api/runs/run-a/control'),
      segments: ['api', 'runs', 'run-a', 'control'],
      store: store as unknown as ThreadStore,
      tenantContext,
      onControlRun,
    });

    expect(onControlRun).toHaveBeenCalledWith('interrupt', expect.objectContaining({ runId: 'run-a', threadId: 'thread-a' }));
    expect(store.appended).toEqual([
      expect.objectContaining({
        runId: 'run-a',
        category: 'control',
        type: 'control.interrupt',
        tenantId: 'tenantA',
      }),
    ]);
    expect(res.body).toEqual({ ok: true, result: { interrupted: true } });
  });

  it('records failed rollback control actions as monitor events', async () => {
    const store = new FakeStore();
    const res = response();

    await handleRunMonitorRoute({
      req: request('POST', '/api/runs/run-a/control', { action: 'rollback', threadId: 'thread-a' }),
      res,
      url: new URL('http://localhost/api/runs/run-a/control'),
      segments: ['api', 'runs', 'run-a', 'control'],
      store: store as unknown as ThreadStore,
      tenantContext,
      onControlRun: async () => {
        throw new Error('Thread is running');
      },
    });

    expect(res.statusCode).toBe(409);
    expect(store.appended).toEqual([
      expect.objectContaining({
        runId: 'run-a',
        category: 'control',
        type: 'control.rollback',
        level: 'error',
        metadata: expect.objectContaining({ status: 'failed', error: 'Thread is running' }),
      }),
    ]);
    expect(res.body).toEqual({ ok: false, error: 'Thread is running' });
  });
});
