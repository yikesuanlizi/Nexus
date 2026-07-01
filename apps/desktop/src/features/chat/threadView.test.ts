import { describe, expect, it } from 'vitest';
import { applyAgentMessageDelta, describeEvent, eventRenderKey, groupTranscriptItems, mergeThreadItems, removeThreadItem, withSyntheticUserMessages } from './threadView.js';

describe('threadView', () => {
  it('groups assistant text and tool calls from the same turn into one assistant bubble', () => {
    const groups = groupTranscriptItems(
      [
        { id: 'u1', type: 'user_message', turnId: 'turn-1', text: 'start' },
        { id: 'a1', type: 'agent_message', turnId: 'turn-1', text: 'first' },
        { id: 'tool1', type: 'collab_tool_call', turnId: 'turn-1', tool: 'spawn_agent', status: 'completed' },
        { id: 'a2', type: 'agent_message', turnId: 'turn-1', text: 'second' },
      ],
      [{ turnId: 'turn-1', userInput: { type: 'text', text: 'start' }, status: 'completed' }],
    );

    expect(groups).toEqual([
      expect.objectContaining({ kind: 'user', item: expect.objectContaining({ id: 'u1' }) }),
      expect.objectContaining({
        kind: 'assistant',
        turnId: 'turn-1',
        status: 'completed',
        items: [
          expect.objectContaining({ id: 'a1' }),
          expect.objectContaining({ id: 'tool1' }),
          expect.objectContaining({ id: 'a2' }),
        ],
      }),
    ]);
  });

  it('keeps a turn user message before its error bubble even when the error item arrives first', () => {
    const groups = groupTranscriptItems(
      [
        { id: 'err-1', type: 'error', turnId: 'turn-1', message: 'model failed' },
        { id: 'u1', type: 'user_message', turnId: 'turn-1', text: '为什么失败' },
      ],
      [{ turnId: 'turn-1', userInput: { type: 'text', text: '为什么失败' }, status: 'failed' }],
    );

    expect(groups.map((group) => group.kind)).toEqual(['user', 'assistant']);
    expect(groups[0]).toMatchObject({ kind: 'user', item: { id: 'u1' } });
    expect(groups[1]).toMatchObject({
      kind: 'assistant',
      turnId: 'turn-1',
      items: [expect.objectContaining({ id: 'err-1' })],
    });
  });

  it('keeps context compaction items out of the transcript', () => {
    const groups = groupTranscriptItems([
      {
        id: 'compact-1',
        type: 'context_compaction',
        turnId: 'turn-1',
        status: 'completed',
        summary: {
          raw: '[Context compaction completed]\n当前进度：内部摘要不应显示在聊天气泡里。',
        },
      },
      { id: 'user-1', type: 'user_message', turnId: 'turn-2', text: '继续' },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ kind: 'user', item: expect.objectContaining({ id: 'user-1' }) }),
    ]);
  });

  it('replaces existing items by id instead of appending duplicates', () => {
    const current = [
      { id: 'item-1', type: 'agent_message', text: 'old' },
      { id: 'item-2', type: 'tool_call', toolName: 'read_file', status: 'in_progress' },
    ];
    const incoming = [
      { id: 'item-1', type: 'agent_message', text: 'new' },
      { id: 'item-3', type: 'agent_message', text: 'third' },
    ];

    expect(mergeThreadItems(current, incoming)).toEqual([
      { id: 'item-1', type: 'agent_message', text: 'new' },
      { id: 'item-2', type: 'tool_call', toolName: 'read_file', status: 'in_progress' },
      { id: 'item-3', type: 'agent_message', text: 'third' },
    ]);
  });

  it('applies agent message deltas directly to the current transcript item', () => {
    expect(
      applyAgentMessageDelta(
        [
          {
            id: 'agent-1',
            type: 'agent_message',
            turnId: 'turn-1',
            text: '你',
          },
        ],
        {
          itemId: 'agent-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          delta: '好',
        },
      ),
    ).toEqual([
      {
        id: 'agent-1',
        type: 'agent_message',
        turnId: 'turn-1',
        text: '你好',
      },
    ]);
  });

  it('removes a transient transcript item by id', () => {
    expect(
      removeThreadItem(
        [
          { id: 'agent-1', type: 'agent_message', turnId: 'turn-1', text: '临时工具文本' },
          { id: 'agent-2', type: 'agent_message', turnId: 'turn-1', text: '最终回答' },
        ],
        'agent-1',
      ),
    ).toEqual([
      { id: 'agent-2', type: 'agent_message', turnId: 'turn-1', text: '最终回答' },
    ]);
  });

  it('turns raw lifecycle events into readable Chinese timeline entries', () => {
    expect(describeEvent({ type: 'turn.started', turnIndex: 0 }, 'zh')).toMatchObject({
      title: '第 1 轮开始',
      tone: 'running',
    });

    expect(
      describeEvent(
        {
          type: 'item.completed',
          item: {
            id: 'item-1',
            type: 'tool_call',
            toolName: 'shell_command',
            status: 'completed',
          },
        },
        'zh',
      ),
    ).toMatchObject({
      title: '工具调用：完成',
      detail: 'shell_command · completed',
      tone: 'success',
    });
  });

  it('does not create timeline noise for streaming agent text updates', () => {
    expect(
      describeEvent(
        {
          type: 'item.updated',
          item: {
            id: 'agent-1',
            type: 'agent_message',
            turnId: 'turn-1',
            text: '流式',
          },
        },
        'zh',
      ),
    ).toBeNull();
  });

  it('describes model retry events in the timeline', () => {
    expect(
      describeEvent(
        {
          type: 'model.retry',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1,
          status: 429,
        },
        'zh',
      ),
    ).toMatchObject({
      title: '模型重试',
      detail: expect.stringContaining('1/3'),
      tone: 'warning',
    });
  });

  it('describes recoverable stream errors without treating them as turn failure', () => {
    expect(
      describeEvent(
        {
          type: 'stream.error',
          threadId: 'thread-1',
          turnId: 'turn-1',
          recoverable: true,
          message: 'The operation was aborted due to timeout',
          error: {
            message: 'The operation was aborted due to timeout',
            info: { kind: 'ResponseStreamDisconnected' },
          },
        },
        'zh',
      ),
    ).toMatchObject({
      title: '流式响应中断',
      tone: 'warning',
    });
  });

  it('keeps user messages in the transcript instead of the event timeline', () => {
    expect(
      describeEvent(
        {
          type: 'item.completed',
          item: {
            id: 'user-1',
            type: 'user_message',
            turnId: 'turn-1',
            text: '现在几点',
          },
        },
        'zh',
      ),
    ).toBeNull();
  });

  it('uses stable render keys for event status updates', () => {
    expect(
      eventRenderKey({
        id: 25,
        key: 'item:turn-1:tool:current_time',
        kind: 'item.started',
        title: '工具调用：进行中',
        detail: 'current_time · in_progress',
        tone: 'running',
        timestamp: '2026-06-08T02:00:00.000Z',
      }),
    ).toBe(
      eventRenderKey({
        id: 26,
        key: 'item:turn-1:tool:current_time',
        kind: 'item.completed',
        title: '工具调用：完成',
        detail: 'current_time · completed',
        tone: 'success',
        timestamp: '2026-06-08T02:00:01.000Z',
      }),
    );
  });

  it('synthesizes missing user messages from persisted turns', () => {
    expect(
      withSyntheticUserMessages(
        [
          {
            turnId: 'turn-1',
            userInput: { type: 'text', text: '现在几点' },
          },
        ],
        [
          {
            id: 'item-1',
            type: 'agent_message',
            turnId: 'turn-1',
            text: '现在是上午 10 点。',
          },
        ],
      ),
    ).toEqual([
      {
        id: 'turn-1_user',
        type: 'user_message',
        turnId: 'turn-1',
        text: '现在几点',
      },
      {
        id: 'item-1',
        type: 'agent_message',
        turnId: 'turn-1',
        text: '现在是上午 10 点。',
      },
    ]);
  });
});
