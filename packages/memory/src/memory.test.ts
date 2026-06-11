import { describe, expect, it } from 'vitest';
import type { ThreadId, ThreadItem, ThreadMeta, TurnMeta } from '@nexus/protocol';
import { compactThread, getCompactionPressure, shouldCompact } from './memory.js';
import type { ThreadStore } from '@nexus/storage';

class MemoryStore implements ThreadStore {
  thread: ThreadMeta;
  turns: TurnMeta[];
  items: ThreadItem[];
  appended: ThreadItem[] = [];

  constructor(threadId: ThreadId) {
    this.thread = {
      threadId,
      title: 'long thread',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 5,
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
      archivedAt: null,
      ephemeral: false,
      tags: {},
    };
    this.turns = Array.from({ length: 5 }, (_, index) => ({
      turnId: `turn-${index}`,
      threadId,
      index,
      userInput: { type: 'text', text: `request ${index}` },
      status: 'completed',
      startedAt: `2026-06-10T00:0${index}:00.000Z`,
      completedAt: `2026-06-10T00:0${index}:10.000Z`,
    }));
    this.items = this.turns.flatMap((turn) => [
      {
        id: `${turn.turnId}-user`,
        type: 'user_message' as const,
        turnId: turn.turnId,
        text: String((turn.userInput as { text: string }).text),
      },
      {
        id: `${turn.turnId}-agent`,
        type: 'agent_message' as const,
        turnId: turn.turnId,
        text: 'x'.repeat(120),
      },
    ]);
  }

  async appendItems(_threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    this.appended.push(...items);
    this.items.push(...items);
  }
  async updateThreadMetadata(_threadId: ThreadId, patch: Partial<ThreadMeta>): Promise<void> {
    this.thread = { ...this.thread, ...patch };
  }
  async createThread(): Promise<void> {}
  async getThread(): Promise<ThreadMeta | null> { return this.thread; }
  async listThreads(): Promise<ThreadMeta[]> { return [this.thread]; }
  async deleteThread(): Promise<void> {}
  async getItems(): Promise<ThreadItem[]> { return this.items; }
  async getTurns(): Promise<TurnMeta[]> { return this.turns; }
  async saveTurn(): Promise<void> {}
  async getRecentItems(): Promise<ThreadItem[]> { return this.items; }
  async getLastCheckpoint(): Promise<null> { return null; }
  async appendCheckpoint(): Promise<void> {}
  async getSetting<T = unknown>(): Promise<T | null> { return null; }
  async setSetting(): Promise<void> {}
  async upsertThreadSpawnEdge(): Promise<void> {}
  async setThreadSpawnEdgeStatus(): Promise<void> {}
  async listThreadSpawnChildren(): Promise<never[]> { return []; }
  async listThreadSpawnDescendants(): Promise<never[]> { return []; }
}

class SummaryModel {
  async chat() {
    return {
      choices: [
        {
          message: {
            content: [
              '用户目标：完成长任务。',
              '已完成变更：读取并整理历史。',
              '关键约束：保留最近上下文。',
              '未完成事项：继续当前任务。',
            ].join('\n'),
          },
        },
      ],
    };
  }
}

describe('compactThread', () => {
  it('reports soft compaction pressure before hard compaction is needed', () => {
    const store = new MemoryStore('thread-pressure');
    const pressure = getCompactionPressure(store.items, {
      maxTokens: 250,
      softCompactRatio: 0.5,
      hardCompactRatio: 0.8,
    });

    expect(pressure.status).toBe('soft');
    expect(pressure.estimatedTokens).toBeGreaterThanOrEqual(125);
    expect(shouldCompact(store.items, {
      maxTokens: 250,
      softCompactRatio: 0.5,
      hardCompactRatio: 0.8,
    })).toBe(false);
  });

  it('only auto-compacts after the hard threshold', () => {
    const store = new MemoryStore('thread-hard-pressure');
    expect(shouldCompact(store.items, {
      maxTokens: 180,
      softCompactRatio: 0.5,
      hardCompactRatio: 0.8,
    })).toBe(true);
  });

  it('auto-compacts once the hard threshold is reached even when below the absolute max', async () => {
    const store = new MemoryStore('thread-auto-hard-threshold');

    const result = await compactThread('thread-auto-hard-threshold', store, new SummaryModel() as never, {
      trigger: 'auto',
      maxTokens: 170,
      softCompactRatio: 0.5,
      hardCompactRatio: 0.8,
      keepRecentTurns: 3,
    });

    expect(result.compactedTurns).toBe(2);
    expect(store.appended[0]).toMatchObject({
      type: 'context_compaction',
      trigger: 'auto',
      compactedTurnIds: ['turn-0', 'turn-1'],
    });
  });

  it('persists a visible context_compaction item with structured summary and preserved tail turns', async () => {
    const store = new MemoryStore('thread-compact-visible');

    const result = await compactThread('thread-compact-visible', store, new SummaryModel() as never, {
      maxTokens: 10,
      keepRecentTurns: 3,
    });

    expect(result.compactedTurns).toBe(2);
    expect(store.appended).toEqual([
      expect.objectContaining({
        type: 'context_compaction',
        status: 'completed',
        compactedTurnIds: ['turn-0', 'turn-1'],
        retainedTurnIds: ['turn-2', 'turn-3', 'turn-4'],
        summary: expect.objectContaining({
          userGoal: expect.stringContaining('完成长任务'),
          openTasks: expect.stringContaining('继续当前任务'),
        }),
      }),
    ]);
    expect(store.thread.tags?.compactedSummary).toContain('用户目标');
    expect(JSON.parse(store.thread.tags?.compactedRanges ?? '[]')).toEqual([
      expect.objectContaining({
        compactedTurnIds: ['turn-0', 'turn-1'],
        retainedTurnIds: ['turn-2', 'turn-3', 'turn-4'],
        compactionItemId: expect.any(String),
      }),
    ]);
  });

  it('attaches the compaction item to the active compaction turn instead of an old summarized turn', async () => {
    const store = new MemoryStore('thread-compact-turn');

    await compactThread('thread-compact-turn', store, new SummaryModel() as never, {
      maxTokens: 10,
      keepRecentTurns: 3,
      compactionTurnId: 'turn-compact-active',
    });

    expect(store.appended[0]).toMatchObject({
      type: 'context_compaction',
      turnId: 'turn-compact-active',
      compactedTurnIds: ['turn-0', 'turn-1'],
    });
  });

  it('supports local compaction without calling the model', async () => {
    const store = new MemoryStore('thread-local-compact');
    const model = {
      async chat() {
        throw new Error('local compaction must not call model');
      },
    };

    const result = await compactThread('thread-local-compact', store, model as never, {
      maxTokens: 10,
      keepRecentTurns: 3,
      strategy: 'local',
    });

    expect(result.compactedTurns).toBe(2);
    expect(result.summary).toContain('request 0');
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(store.appended[0]).toMatchObject({
      type: 'context_compaction',
      status: 'completed',
      compactedTurnIds: ['turn-0', 'turn-1'],
    });
  });
});
