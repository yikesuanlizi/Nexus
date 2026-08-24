import { describe, expect, it } from 'vitest';
import { agentDecisionRequestSchema, agentDecisionResponseSchema } from './threadInteraction.js';

describe('thread interaction protocol', () => {
  it('accepts durable agent decision requests and strict responses', () => {
    const request = agentDecisionRequestSchema.parse({
      requestId: 'decision-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      prompt: '请选择方案',
      options: [{ id: 'one', action: 'way_one', label: '方式一' }],
      allowCustomInput: true,
      createdAt: '2026-08-23T00:00:00.000Z',
      status: 'pending',
    });
    expect(request.status).toBe('pending');
    expect(agentDecisionResponseSchema.parse({ requestId: 'decision-1', action: 'custom_input', customInput: '按我的方案' })).toMatchObject({ action: 'custom_input' });
    expect(() => agentDecisionResponseSchema.parse({ requestId: 'decision-1', action: 'way_one', extra: true })).toThrow();
  });
});
