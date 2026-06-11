import { describe, expect, it, vi } from 'vitest';
import type { ThreadMeta } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { BotGateway } from './index.js';

class MemoryBotStore implements Partial<ThreadStore> {
  settings = new Map<string, unknown>();
  threads = new Map<string, ThreadMeta>();

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T | undefined) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }

  async createThread(meta: ThreadMeta): Promise<void> {
    this.threads.set(meta.threadId, meta);
  }

  async getThread(threadId: string): Promise<ThreadMeta | null> {
    return this.threads.get(threadId) ?? null;
  }
}

describe('BotGateway', () => {
  it('creates one Nexus thread per WeChat dm session and sends the final reply', async () => {
    const store = new MemoryBotStore();
    const send = vi.fn(async () => {});
    const runTurn = vi.fn(async () => ({ text: '处理完成' }));
    const gateway = new BotGateway({
      store: store as unknown as ThreadStore,
      runTurn,
      send,
      now: () => '2026-06-11T00:00:00.000Z',
      createId: () => 'thread_1',
      defaultWorkspaceRoot: 'E:\\langchain',
      locale: 'zh',
    });

    const result = await gateway.handleMessage({
      platform: 'weixin',
      chatType: 'dm',
      chatId: 'friend_a',
      userId: 'friend_a',
      userName: '张三',
      text: '帮我看一下项目',
      messageId: 'msg_1',
    });

    expect(result).toMatchObject({ status: 'completed', threadId: 'thread_1' });
    expect(runTurn).toHaveBeenCalledWith('thread_1', '帮我看一下项目', expect.any(Object));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'weixin',
      chatId: 'friend_a',
      text: '处理完成',
    }));

    await gateway.handleMessage({
      platform: 'weixin',
      chatType: 'dm',
      chatId: 'friend_a',
      userId: 'friend_a',
      userName: '张三',
      text: '继续',
      messageId: 'msg_2',
    });
    expect(runTurn).toHaveBeenLastCalledWith('thread_1', '继续', expect.any(Object));
  });

  it('deduplicates repeated platform message ids before running the agent', async () => {
    const store = new MemoryBotStore();
    const runTurn = vi.fn(async () => ({ text: 'ok' }));
    const gateway = new BotGateway({
      store: store as unknown as ThreadStore,
      runTurn,
      send: vi.fn(async () => {}),
      now: () => '2026-06-11T00:00:00.000Z',
      createId: () => 'thread_1',
      defaultWorkspaceRoot: 'E:\\langchain',
      locale: 'zh',
    });
    const message = {
      platform: 'weixin' as const,
      chatType: 'dm' as const,
      chatId: 'friend_a',
      userId: 'friend_a',
      userName: '张三',
      text: '重复消息',
      messageId: 'same_msg',
    };

    await gateway.handleMessage(message);
    const duplicate = await gateway.handleMessage(message);

    expect(duplicate.status).toBe('duplicate');
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it('returns a busy reply when the session thread is already running', async () => {
    const store = new MemoryBotStore();
    store.settings.set('bot.sessions.v1', {
      sessions: [{
        key: 'weixin:group:room_1',
        platform: 'weixin',
        chatId: 'room_1',
        chatType: 'group',
        threadId: 'thread_busy',
        title: '项目群',
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
      }],
    });
    const send = vi.fn(async () => {});
    const gateway = new BotGateway({
      store: store as unknown as ThreadStore,
      runTurn: vi.fn(async () => ({ text: 'never' })),
      send,
      isThreadRunning: () => true,
      now: () => '2026-06-11T00:00:00.000Z',
      createId: () => 'thread_busy',
      defaultWorkspaceRoot: 'E:\\langchain',
      locale: 'zh',
    });

    const result = await gateway.handleMessage({
      platform: 'weixin',
      chatType: 'group',
      chatId: 'room_1',
      userId: 'friend_a',
      userName: '张三',
      text: '新的任务',
      messageId: 'msg_busy',
    });

    expect(result.status).toBe('busy');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'room_1',
      text: expect.stringContaining('上一条'),
    }));
  });
});
