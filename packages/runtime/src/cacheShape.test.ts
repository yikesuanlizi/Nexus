import { describe, expect, it } from 'vitest';
import { buildPromptCacheShape, comparePromptCacheShape } from './cacheShape.js';

describe('prompt cache shape', () => {
  it('keeps the same hash when tool schema object keys are reordered', () => {
    const first = buildPromptCacheShape(
      [{ role: 'system', content: 'stable system' }],
      [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' }, limit: { type: 'number' } },
            },
          },
        },
      ],
    );
    const second = buildPromptCacheShape(
      [{ role: 'system', content: 'stable system' }],
      [
        {
          type: 'function',
          function: {
            description: 'Read file',
            parameters: {
              properties: { limit: { type: 'number' }, path: { type: 'string' } },
              type: 'object',
            },
            name: 'read_file',
          },
        },
      ],
    );

    expect(second).toEqual(first);
  });

  it('reports whether system or tools changed', () => {
    const base = buildPromptCacheShape(
      [{ role: 'system', content: 'stable system' }],
      [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object' } } }],
    );
    expect(comparePromptCacheShape(base, buildPromptCacheShape(
      [{ role: 'system', content: 'changed system' }],
      [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object' } } }],
    ))).toEqual({ stable: false, reasons: ['system'] });

    expect(comparePromptCacheShape(base, buildPromptCacheShape(
      [{ role: 'system', content: 'stable system' }],
      [{ type: 'function', function: { name: 'search_content', description: 'Search', parameters: { type: 'object' } } }],
    ))).toEqual({ stable: false, reasons: ['tools'] });
  });
});
