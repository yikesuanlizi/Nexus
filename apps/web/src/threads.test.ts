import { describe, expect, it } from 'vitest';
import { visibleConversationThreads, buildThreadTreeRows, filterConversationThreads, optimisticDeleteThread } from './threads.js';
import type { ThreadMeta } from './types.js';

function thread(threadId: string): ThreadMeta {
  return {
    threadId,
    title: threadId,
    status: 'active',
    turnCount: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  };
}

describe('buildThreadTreeRows', () => {
  it('hides spawned subagent threads from the default conversation list', () => {
    expect(visibleConversationThreads([
      thread('parent'),
      { ...thread('child'), parentThreadId: 'parent' },
    ]).map((item) => item.threadId)).toEqual(['parent']);
  });

  it('places spawned child threads under their parent with depth metadata', () => {
    const parent = thread('parent');
    const sibling = { ...thread('sibling'), updatedAt: '2026-06-09T00:00:00.000Z' };
    const child = {
      ...thread('child'),
      parentThreadId: parent.threadId,
      updatedAt: '2026-06-10T00:00:00.000Z',
    };

    expect(buildThreadTreeRows([child, parent, sibling]).map((row) => ({
      id: row.thread.threadId,
      depth: row.depth,
    }))).toEqual([
      { id: 'sibling', depth: 0 },
      { id: 'parent', depth: 0 },
      { id: 'child', depth: 1 },
    ]);
  });
});

describe('optimisticDeleteThread', () => {
  it('removes the deleted thread immediately and selects the next visible thread', () => {
    expect(optimisticDeleteThread([thread('a'), thread('b'), thread('c')], 'b', 'b')).toEqual({
      threads: [thread('a'), thread('c')],
      nextThreadId: 'a',
    });
  });

  it('keeps the active thread when deleting another thread', () => {
    expect(optimisticDeleteThread([thread('a'), thread('b')], 'b', 'a')).toEqual({
      threads: [thread('a')],
      nextThreadId: 'a',
    });
  });
});

describe('filterConversationThreads', () => {
  it('filters conversations by title and agent metadata without showing child-only matches', () => {
    expect(filterConversationThreads([
      { ...thread('a'), title: '代码审查' },
      { ...thread('b'), title: '部署说明' },
      { ...thread('child'), parentThreadId: 'a', agentNickname: 'reviewer' },
    ], '审查').map((item) => item.threadId)).toEqual(['a']);

    expect(filterConversationThreads([
      { ...thread('a'), title: '代码审查' },
      { ...thread('b'), title: '部署说明' },
    ], 'deploy')).toEqual([]);
  });
});
