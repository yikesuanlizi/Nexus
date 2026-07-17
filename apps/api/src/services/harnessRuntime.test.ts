import { describe, expect, it } from 'vitest';
import type { HarnessResult } from '@nexus/runtime';
import { HarnessRuntimeRegistry } from './harnessRuntime.js';

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

describe('HarnessRuntimeRegistry', () => {
  it('tracks a completed harness run', async () => {
    const registry = new HarnessRuntimeRegistry();
    const entry = registry.start({
      harnessRunId: 'harness-complete',
      threadId: 'thread-a',
      tenantId: 'tenant-a',
      run: async () => harnessResult('harness-complete'),
    });

    expect(entry.runtimeStatus).toBe('running');
    await expect(entry.promise).resolves.toMatchObject({ status: 'satisfied' });
    await Promise.resolve();

    expect(registry.get('harness-complete')).toMatchObject({
      runtimeStatus: 'completed',
      result: expect.objectContaining({ harnessRunId: 'harness-complete' }),
    });
    expect(registry.activeRunForThread('thread-a')).toBeUndefined();
  });

  it('cancels a running harness run with its abort signal', async () => {
    const registry = new HarnessRuntimeRegistry();
    let aborted = false;
    const entry = registry.start({
      harnessRunId: 'harness-cancel',
      threadId: 'thread-a',
      tenantId: 'tenant-a',
      run: async (signal) => new Promise<HarnessResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
    });

    expect(registry.activeRunForThread('thread-a')).toBe(entry);
    expect(registry.cancel('harness-cancel')).toBe(true);
    await expect(entry.promise).rejects.toThrow('aborted');

    expect(aborted).toBe(true);
    expect(entry.runtimeStatus).toBe('cancelled');
    expect(registry.cancel('harness-cancel')).toBe(false);
  });

  it('cleans up finished runs while keeping active runs', async () => {
    const registry = new HarnessRuntimeRegistry();
    const completed = registry.start({
      harnessRunId: 'harness-old',
      threadId: 'thread-a',
      tenantId: 'tenant-a',
      run: async () => harnessResult('harness-old'),
    });
    registry.start({
      harnessRunId: 'harness-active',
      threadId: 'thread-a',
      tenantId: 'tenant-a',
      run: async () => new Promise<HarnessResult>(() => undefined),
    });

    await completed.promise;
    await Promise.resolve();
    registry.cleanup(-1);

    expect(registry.get('harness-old')).toBeUndefined();
    expect(registry.get('harness-active')).toMatchObject({ runtimeStatus: 'running' });
    registry.abortAll();
  });
});
