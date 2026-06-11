import { describe, expect, it } from 'vitest';
import {
  buildChildActivityByThread,
  childActivityForCollabItem,
  isChildActivityItem,
} from './subagentActivity.js';
import type { ThreadChildInfo, ThreadItem } from './types.js';

function info(items: ThreadItem[]): ThreadChildInfo {
  return {
    thread: {
      threadId: 'child-1',
      title: 'child',
      status: 'active',
      turnCount: 1,
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:01:00.000Z',
      parentThreadId: 'parent',
    },
    edge: {
      parentThreadId: 'parent',
      childThreadId: 'child-1',
      status: 'open',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:01:00.000Z',
    },
    state: {
      threadId: 'child-1',
      status: 'running',
      checkpoint: null,
      resumable: false,
      stale: false,
    },
    latestTurn: null,
    latestCollabItem: null,
    items,
  };
}

describe('subagent activity helpers', () => {
  it('keeps tool and agent output from child history, but skips user prompts', () => {
    const user: ThreadItem = { id: 'u1', type: 'user_message', text: 'do work' };
    const tool: ThreadItem = {
      id: 't1',
      type: 'tool_call',
      turnId: 'turn-child',
      toolName: 'read_file',
      arguments: { path: 'src/index.ts' },
      status: 'completed',
    };
    const answer: ThreadItem = {
      id: 'a1',
      type: 'agent_message',
      turnId: 'turn-child',
      text: 'done',
      status: 'completed',
    };

    expect(isChildActivityItem(user)).toBe(false);
    expect(buildChildActivityByThread([info([user, tool, answer])])).toEqual({
      'child-1': [tool, answer],
    });
  });

  it('finds child activity for spawn and wait collaboration items', () => {
    const childTool: ThreadItem = {
      id: 't1',
      type: 'tool_call',
      toolName: 'search_content',
      arguments: { pattern: 'AgentLoop' },
      status: 'completed',
    };
    const byThread = buildChildActivityByThread([info([childTool])]);

    expect(childActivityForCollabItem({
      id: 'spawn',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      newThreadId: 'child-1',
      receiverThreadId: 'child-1',
      status: 'completed',
    }, byThread)).toEqual([childTool]);

    expect(childActivityForCollabItem({
      id: 'other',
      type: 'tool_call',
      toolName: 'read_file',
      status: 'completed',
    }, byThread)).toEqual([]);
  });
});
