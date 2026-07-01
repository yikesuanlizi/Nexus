import { describe, expect, it } from 'vitest';
import { affectsTurnStatus, toNexusErrorInfo } from './runtimeError.js';

describe('runtime error classification', () => {
  it('classifies model timeout as response stream disconnected', () => {
    expect(toNexusErrorInfo(new Error('The operation was aborted due to timeout'))).toMatchObject({
      kind: 'ResponseStreamDisconnected',
    });
  });

  it('classifies common HTTP status codes', () => {
    expect(toNexusErrorInfo(Object.assign(new Error('HTTP 401'), { status: 401 }))).toMatchObject({ kind: 'Unauthorized' });
    expect(toNexusErrorInfo(Object.assign(new Error('HTTP 429'), { status: 429 }))).toMatchObject({ kind: 'UsageLimitExceeded' });
    expect(toNexusErrorInfo(Object.assign(new Error('HTTP 500'), { status: 500 }))).toMatchObject({ kind: 'InternalServerError' });
  });

  it('keeps rollback/control marker errors from failing the turn status', () => {
    expect(affectsTurnStatus({ kind: 'ThreadRollbackFailed' })).toBe(false);
    expect(affectsTurnStatus({ kind: 'ActiveTurnNotSteerable' })).toBe(false);
    expect(affectsTurnStatus({ kind: 'ResponseStreamDisconnected' })).toBe(true);
  });
});
