import { describe, expect, it, vi } from 'vitest';
import type { ThreadId, ThreadItem, ThreadMeta } from '@nexus/protocol';
import { TaskHarnessEngine, type HarnessAgentLoop } from './taskHarness.js';
import { DEFAULT_HARNESS_CONFIG } from './types.js';

class FakeHarnessStore {
  private tags: Record<string, string> = {};

  async getThread(threadId: ThreadId): Promise<ThreadMeta> {
    return {
      threadId,
      title: 'Harness test',
      workspaceRoot: '',
      status: 'active' as const,
      turnCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      ephemeral: false,
      tags: this.tags,
    };
  }

  async updateThreadMetadata(_threadId: ThreadId, patch: { tags?: Record<string, string> }) {
    this.tags = patch.tags ?? this.tags;
  }

  async getRecentItems() {
    return [];
  }

  async getItems() {
    return [];
  }

  async getCompactionSummary() {
    return null;
  }
}

describe('TaskHarnessEngine', () => {
  it('lets a pure answer reach goal evaluation instead of retrying readiness forever', async () => {
    let turnCalls = 0;
    const answerItems: ThreadItem[] = [{
      id: 'item_answer',
      type: 'agent_message',
      turnId: 'turn_answer',
      text: '航空保障包（扩展包）用于补充航空保障相关能力。',
      status: 'completed',
      timestamp: new Date().toISOString(),
    } as unknown as ThreadItem];

    const agentLoop: HarnessAgentLoop = {
      runTurn: vi.fn(async () => {
        turnCalls += 1;
        if (turnCalls > 2) throw new Error('readiness retry loop');
        return { items: answerItems, usage: null };
      }),
    };
    const model = {
      completeOnce: vi.fn(async () => JSON.stringify({
        satisfied: true,
        status: 'satisfied',
        passedCriteria: ['介绍一下航空保障包（扩展包）'],
        failedCriteria: [],
        evidenceSummary: 'The assistant answered the requested introduction.',
        reasoning: 'Pure informational answer satisfies the criterion.',
        criteriaEvidenceMap: {},
      })),
    };

    const engine = new TaskHarnessEngine(
      agentLoop,
      model,
      new FakeHarnessStore(),
      { ...DEFAULT_HARNESS_CONFIG, maxContinuations: 2, maxNoProgress: 1 },
    );

    const result = await engine.runHarness(
      'thread-harness-pure-answer',
      { type: 'text', text: '介绍一下航空保障包（扩展包）' },
      {
        acceptanceCriteria: ['介绍一下航空保障包（扩展包）'],
        maxContinuations: 2,
      },
    );

    expect(result.status).toBe('satisfied');
    expect(agentLoop.runTurn).toHaveBeenCalledTimes(1);
    expect(model.completeOnce).toHaveBeenCalledTimes(1);
  });

  it('stops repeated readiness failures through no-progress instead of retrying indefinitely', async () => {
    let turnCalls = 0;
    const changedItems: ThreadItem[] = [{
      id: 'item_change',
      type: 'file_change',
      turnId: 'turn_change',
      status: 'completed',
      timestamp: new Date().toISOString(),
      changes: [{
        kind: 'update',
        path: 'src/example.ts',
        summary: 'changed example',
        hunks: [],
      }],
    } as unknown as ThreadItem];

    const agentLoop: HarnessAgentLoop = {
      runTurn: vi.fn(async () => {
        turnCalls += 1;
        if (turnCalls > 3) throw new Error('readiness retry loop');
        return { items: changedItems, usage: null };
      }),
    };
    const model = {
      completeOnce: vi.fn(async () => JSON.stringify({
        satisfied: false,
        status: 'continue',
        passedCriteria: [],
        failedCriteria: ['修改 src/example.ts 并通过测试'],
        evidenceSummary: '',
        reasoning: 'not called when readiness fails',
      })),
    };

    const engine = new TaskHarnessEngine(
      agentLoop,
      model,
      new FakeHarnessStore(),
      { ...DEFAULT_HARNESS_CONFIG, maxContinuations: 5, maxNoProgress: 1 },
    );

    const result = await engine.runHarness(
      'thread-harness-readiness-stop',
      { type: 'text', text: '修改 src/example.ts 并通过测试' },
      {
        acceptanceCriteria: ['修改 src/example.ts 并通过测试'],
        maxContinuations: 5,
      },
    );

    expect(result.status).toBe('no_progress');
    expect(agentLoop.runTurn).toHaveBeenCalledTimes(2);
    expect(model.completeOnce).not.toHaveBeenCalled();
  });
});
