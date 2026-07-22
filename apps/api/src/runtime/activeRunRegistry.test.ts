import { describe, expect, it, vi } from 'vitest';
import { ActiveRunRegistry } from './activeRunRegistry.js';

describe('ActiveRunRegistry', () => {
  it('register stores handle and unregister removes it', () => {
    const registry = new ActiveRunRegistry();
    const interrupt = vi.fn();
    const handle = {
      runId: 'run-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      interrupt,
    };

    const unregister = registry.register(handle);
    expect(registry.get('run-1')).toBe(handle);

    unregister();
    expect(registry.get('run-1')).toBeNull();
  });

  it('get returns null for unknown runId', () => {
    const registry = new ActiveRunRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('finish removes handle', () => {
    const registry = new ActiveRunRegistry();
    const handle = {
      runId: 'run-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      interrupt: vi.fn(),
    };

    registry.register(handle);
    expect(registry.get('run-1')).toBe(handle);

    registry.finish('run-1');
    expect(registry.get('run-1')).toBeNull();
  });

  it('concurrent runs: interrupting run A does not affect run B', () => {
    const registry = new ActiveRunRegistry();
    const interruptA = vi.fn();
    const interruptB = vi.fn();

    const handleA = {
      runId: 'run-A',
      threadId: 'thread-A',
      turnId: 'turn-A',
      interrupt: interruptA,
    };
    const handleB = {
      runId: 'run-B',
      threadId: 'thread-B',
      turnId: 'turn-B',
      interrupt: interruptB,
    };

    registry.register(handleA);
    registry.register(handleB);

    const foundA = registry.get('run-A');
    expect(foundA).not.toBeNull();
    foundA!.interrupt();

    expect(interruptA).toHaveBeenCalledTimes(1);
    expect(interruptB).not.toHaveBeenCalled();

    expect(registry.get('run-B')).toBe(handleB);
  });

  it('clear removes all handles', () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      runId: 'run-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      interrupt: vi.fn(),
    });
    registry.register({
      runId: 'run-2',
      threadId: 'thread-2',
      turnId: 'turn-2',
      interrupt: vi.fn(),
    });

    expect(registry.get('run-1')).not.toBeNull();
    expect(registry.get('run-2')).not.toBeNull();

    registry.clear();

    expect(registry.get('run-1')).toBeNull();
    expect(registry.get('run-2')).toBeNull();
  });
});
