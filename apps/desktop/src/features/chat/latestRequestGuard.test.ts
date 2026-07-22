import { describe, expect, it } from 'vitest';
import { createLatestRequestGuard } from './latestRequestGuard.js';

describe('createLatestRequestGuard', () => {
  it('aborts the previous request and rejects its result', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first.generation)).toBe(false);
    expect(guard.isCurrent(second.generation)).toBe(true);
  });

  it('dispose aborts current request and invalidates generation', () => {
    const guard = createLatestRequestGuard();
    const request = guard.begin();
    expect(guard.isCurrent(request.generation)).toBe(true);
    guard.dispose();
    expect(request.signal.aborted).toBe(true);
    expect(guard.isCurrent(request.generation)).toBe(false);
  });

  it('isCurrent returns false after generation increments', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    const third = guard.begin();
    expect(guard.isCurrent(first.generation)).toBe(false);
    expect(guard.isCurrent(second.generation)).toBe(false);
    expect(guard.isCurrent(third.generation)).toBe(true);
  });
});
