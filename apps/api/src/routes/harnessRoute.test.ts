import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMeta, UserInput } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import type { AgentLoop, HarnessResult, RunTurnOptions } from '@nexus/runtime';
import { handleHarnessRoute } from './harnessRoute.js';
import { harnessRuntimeRegistry } from '../services/harnessRuntime.js';
import type { TenantContext } from '../shared/tenant.js';
import type { AgentRunConfig } from '../config/config.js';
import { defaultConfig } from '../config/config.js';

class FakeStore implements Partial<ThreadStore> {
  thread: ThreadMeta;

  constructor(tags: Record<string, string> = {}) {
    const now = '2026-07-16T00:00:00.000Z';
    this.thread = {
      threadId: 'thread-harness',
      title: 'Harness',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags,
    };
  }

  async getThread(threadId: string) {
    return threadId === this.thread.threadId ? this.thread : null;
  }

  async updateThreadMetadata(_threadId: string, patch: Partial<Pick<ThreadMeta, 'tags'>>) {
    this.thread = {
      ...this.thread,
      tags: patch.tags ?? this.thread.tags,
    };
  }
}

function request(method: string, path: string, body?: unknown): IncomingMessage {
  const stream = new PassThrough();
  const req = stream as unknown as IncomingMessage;
  req.method = method;
  req.url = path;
  req.headers = {};
  if (body !== undefined) stream.end(JSON.stringify(body));
  else stream.end();
  return req;
}

function response() {
  const chunks: Buffer[] = [];
  const res = new PassThrough() as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, unknown>;
    body?: unknown;
  };
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

function harnessResult(runId: string): HarnessResult {
  return {
    status: 'satisfied',
    harnessRunId: runId,
    iterations: 1,
    finalEvaluation: null,
    evidenceCount: 0,
    items: [],
    usage: null,
  };
}

const tenantContext: TenantContext = { tenantId: 'tenant-a' };

afterEach(() => {
  harnessRuntimeRegistry.abortAll();
  harnessRuntimeRegistry.cleanup(-1);
});

describe('harness route', () => {
  const mockGetThreadRunConfig = vi.fn(async (_threadId: string): Promise<AgentRunConfig> => ({
    ...defaultConfig,
    model: 'thread-model',
  }));

  it('returns false for non-harness paths', async () => {
    const handled = await handleHarnessRoute({
      req: request('GET', '/api/threads/thread-harness'),
      res: response(),
      url: new URL('http://localhost/api/threads/thread-harness'),
      segments: ['api', 'threads', 'thread-harness'],
      store: new FakeStore() as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({}) as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(handled).toBe(false);
  });

  it('starts a harness run and exposes runtime status', async () => {
    let capturedSignal: AbortSignal | undefined;
    const runHarness = vi.fn(async (
      _threadId: string,
      _input: UserInput,
      options?: RunTurnOptions & {
        goal?: string;
        acceptanceCriteria?: string[];
        maxContinuations?: number;
        signal?: AbortSignal;
      },
    ) => {
      capturedSignal = options?.signal;
      return harnessResult(options?.harnessRunId ?? 'missing-run-id');
    });
    const store = new FakeStore();
    const res = response();

    const handled = await handleHarnessRoute({
      req: request('POST', '/api/threads/thread-harness/harness/start', {
        input: 'ship autonomous loop',
        goal: 'ship autonomous loop',
        acceptanceCriteria: ['tests pass'],
        maxContinuations: 3,
      }),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/start'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'start'],
      store: store as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({ runHarness }) as unknown as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      threadId: 'thread-harness',
      status: 'running',
    });
    expect(runHarness).toHaveBeenCalledWith(
      'thread-harness',
      { type: 'text', text: 'ship autonomous loop' },
      expect.objectContaining({
        goal: 'ship autonomous loop',
        acceptanceCriteria: ['tests pass'],
        maxContinuations: 3,
        harnessRunId: expect.stringMatching(/^harness_/),
      }),
    );
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    await Promise.resolve();
    const harnessRunId = (res.body as { harnessRunId: string }).harnessRunId;
    const statusRes = response();
    await handleHarnessRoute({
      req: request('GET', `/api/threads/thread-harness/harness/status?runId=${harnessRunId}`),
      res: statusRes,
      url: new URL(`http://localhost/api/threads/thread-harness/harness/status?runId=${harnessRunId}`),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'status'],
      store: store as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({}) as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.body).toMatchObject({
      threadId: 'thread-harness',
      harnessRunId,
      runtimeStatus: 'completed',
      result: expect.objectContaining({ harnessRunId }),
    });
  });

  it('rejects start when the thread already has an active harness run', async () => {
    const res = response();

    await handleHarnessRoute({
      req: request('POST', '/api/threads/thread-harness/harness/start', { input: 'again' }),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/start'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'start'],
      store: new FakeStore({ activeHarnessRunId: 'harness-active' }) as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({}) as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'Thread already has an active harness run. Cancel or wait for it to finish first.',
    });
  });

  it('returns persisted status for a requested run id after the runtime entry is gone', async () => {
    const persistedState = {
      harnessRunId: 'harness-persisted',
      goal: {
        objective: 'finish harness',
        acceptanceCriteria: ['done'],
        maxContinuations: 8,
        maxNoProgress: 2,
      },
      plan: [],
      activeNodeId: null,
      iteration: 2,
      noProgressCount: 0,
      lastEvaluation: null,
      lastProgressSignature: null,
      status: 'satisfied',
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:01:00.000Z',
    };
    const store = new FakeStore({
      activeHarnessRunId: '',
      'harnessState:harness-persisted': JSON.stringify(persistedState),
    });
    const res = response();

    await handleHarnessRoute({
      req: request('GET', '/api/threads/thread-harness/harness/status?runId=harness-persisted'),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/status?runId=harness-persisted'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'status'],
      store: store as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({}) as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      threadId: 'thread-harness',
      harnessRunId: 'harness-persisted',
      runtimeStatus: 'unknown',
      persistedStatus: 'satisfied',
      iteration: 2,
      goal: 'finish harness',
      acceptanceCriteria: ['done'],
    });
  });

  it('cancels the active harness run for a thread', async () => {
    const store = new FakeStore();
    harnessRuntimeRegistry.start({
      harnessRunId: 'harness-route-cancel',
      threadId: 'thread-harness',
      tenantId: 'tenant-a',
      run: async (signal) => new Promise<HarnessResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')));
      }),
    });
    const res = response();

    await handleHarnessRoute({
      req: request('POST', '/api/threads/thread-harness/harness/cancel'),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/cancel'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'cancel'],
      store: store as unknown as ThreadStore,
      tenantContext,
      createAgent: async () => ({}) as AgentLoop,
      publishEvent: vi.fn(),
      getThreadRunConfig: mockGetThreadRunConfig,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      harnessRunId: 'harness-route-cancel',
      runtimeStatus: 'cancelled',
    });
  });

  it('uses thread config when body.config is not provided', async () => {
    const threadConfig: AgentRunConfig = {
      ...defaultConfig,
      model: 'thread-specific-model',
      provider: 'thread-provider',
    };
    const getConfig = vi.fn(async () => threadConfig);
    let capturedConfig: Partial<AgentRunConfig> | undefined;
    const createAgent = vi.fn(async (config?: Partial<AgentRunConfig>) => {
      capturedConfig = config;
      return {
        runHarness: vi.fn(async () => harnessResult('harness-test')),
      } as unknown as AgentLoop;
    });

    const res = response();
    await handleHarnessRoute({
      req: request('POST', '/api/threads/thread-harness/harness/start', {
        input: 'test input',
      }),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/start'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'start'],
      store: new FakeStore() as unknown as ThreadStore,
      tenantContext,
      createAgent,
      publishEvent: vi.fn(),
      getThreadRunConfig: getConfig,
    });

    expect(getConfig).toHaveBeenCalledWith('thread-harness');
    expect(createAgent).toHaveBeenCalled();
    expect(capturedConfig).toMatchObject({
      model: 'thread-specific-model',
      provider: 'thread-provider',
    });
    expect(res.statusCode).toBe(202);
  });

  it('merges body.config as overlay on top of thread config (without persistence)', async () => {
    const threadConfig: AgentRunConfig = {
      ...defaultConfig,
      model: 'thread-model',
      provider: 'thread-provider',
    };
    const getConfig = vi.fn(async () => threadConfig);
    let capturedConfig: Partial<AgentRunConfig> | undefined;
    const createAgent = vi.fn(async (config?: Partial<AgentRunConfig>) => {
      capturedConfig = config;
      return {
        runHarness: vi.fn(async () => harnessResult('harness-test')),
      } as unknown as AgentLoop;
    });

    const res = response();
    await handleHarnessRoute({
      req: request('POST', '/api/threads/thread-harness/harness/start', {
        input: 'test input',
        config: {
          model: 'overlay-model',
        },
      }),
      res,
      url: new URL('http://localhost/api/threads/thread-harness/harness/start'),
      segments: ['api', 'threads', 'thread-harness', 'harness', 'start'],
      store: new FakeStore() as unknown as ThreadStore,
      tenantContext,
      createAgent,
      publishEvent: vi.fn(),
      getThreadRunConfig: getConfig,
    });

    expect(getConfig).toHaveBeenCalledWith('thread-harness');
    expect(createAgent).toHaveBeenCalled();
    expect(capturedConfig).toMatchObject({
      model: 'overlay-model',
      provider: 'thread-provider',
    });
    expect(res.statusCode).toBe(202);
  });
});
