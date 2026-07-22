import { describe, expect, it } from 'vitest';
import { redactTracePayload } from './runTraceRedaction.js';

describe('redactTracePayload', () => {
  it('recursively redacts sensitive keys without mutating the source object', () => {
    const source = {
      Authorization: 'Bearer secret',
      nested: {
        api_key: 'abc',
        safe: 'visible',
        list: [{ password: 'pw' }, 'ok'],
      },
    };

    const redacted = redactTracePayload(source);

    expect(redacted).toEqual({
      Authorization: '[REDACTED]',
      nested: {
        api_key: '[REDACTED]',
        safe: 'visible',
        list: [{ password: '[REDACTED]' }, 'ok'],
      },
    });
    expect(source.nested.api_key).toBe('abc');
  });

  it('handles cycles and truncates oversized strings', () => {
    const source: Record<string, unknown> = { text: 'abcdef' };
    source.self = source;

    const redacted = redactTracePayload(source, { maxStringBytes: 3 });

    expect(redacted).toEqual({
      text: { value: 'abc', truncated: true, originalBytes: 6 },
      self: '[Circular]',
    });
  });
});
