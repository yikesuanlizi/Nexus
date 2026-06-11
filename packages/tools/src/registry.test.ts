import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './registry.js';

describe('ToolRegistry output truncation', () => {
  it('adds structured truncation metadata when tool output is shortened', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'large_output',
      description: 'test tool',
      parameters: { type: 'object' },
      requiredPolicy: 'readonly',
      maxOutputLength: 10,
      async execute() {
        return {
          status: 'completed',
          output: '0123456789abcdef',
          data: { ok: true },
        };
      },
    });

    const result = await registry.execute(
      'large_output',
      {},
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.output).toContain('[truncated 6 chars]');
    expect(result.data).toMatchObject({
      ok: true,
      truncation: {
        originalLength: 16,
        returnedLength: expect.any(Number),
      },
    });
  });

  it('returns OpenAI tool schemas sorted by tool name for stable prompt prefixes', () => {
    const registry = new ToolRegistry();
    for (const name of ['write_file', 'read_file', 'search_content']) {
      registry.register({
        name,
        description: `${name} tool`,
        parameters: { type: 'object' },
        requiredPolicy: 'readonly',
        async execute() {
          return { status: 'completed', output: '' };
        },
      });
    }

    expect(registry.toOpenAITools().map((tool) => tool.function.name)).toEqual([
      'read_file',
      'search_content',
      'write_file',
    ]);
  });
});
