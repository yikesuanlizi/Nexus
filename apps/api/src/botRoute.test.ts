import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadStore } from '@nexus/storage';
import type { AgentRunConfig } from './config.js';
import { handleBotRoute } from './botRoute.js';
import { DEFAULT_BOT_CONFIG } from './botConfig.js';

class BotRouteStore implements Partial<ThreadStore> {
  settings = new Map<string, unknown>();
  createdThreads: string[] = [];

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T | undefined) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }

  async createThread(meta: { threadId: string }): Promise<void> {
    this.createdThreads.push(meta.threadId);
  }
}

function req(method: string, path: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  return Object.assign(Readable.from(chunks), { method, url: path }) as IncomingMessage;
}

function res(): ServerResponse & { status?: number; body?: unknown } {
  const output = {
    writeHead(status: number) {
      output.status = status;
      return output;
    },
    end(raw: string) {
      output.body = raw ? JSON.parse(raw) : undefined;
    },
  } as unknown as ServerResponse & { status?: number; body?: unknown };
  return output;
}

function routePath(path: string) {
  const url = new URL(path, 'http://localhost');
  return { url, segments: url.pathname.split('/').filter(Boolean) };
}

const runConfig: AgentRunConfig = {
  workspaceRoot: 'E:\\langchain',
  provider: 'openai',
  model: 'test',
  baseUrl: '',
  permissions: 'workspace',
  dataDir: 'E:\\langchain\\.nexus',
  skillsRoot: 'C:\\Users\\test\\.nexus\\skills',
  webSearchMode: 'auto',
  reasoningEffort: 'medium',
  locale: 'zh',
};

describe('bot route', () => {
  it('saves bot config and returns a masked public config', async () => {
    const store = new BotRouteStore();
    const response = res();
    const path = routePath('/api/bot/config');

    const handled = await handleBotRoute({
      req: req('PATCH', '/api/bot/config', { config: { weixin: { enabled: true, accountId: 'wx_account_123456' } } }),
      res: response,
      url: path.url,
      segments: path.segments,
      store: store as unknown as ThreadStore,
      getDefaultRunConfig: async () => runConfig,
      createAgent: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ config: { weixin: { accountId: 'wx_a...3456' } } });
    expect(store.settings.get('bot.config.v1')).toMatchObject({ weixin: { accountId: 'wx_account_123456' } });
  });

  it('runs a Weixin inbound message through BotGateway', async () => {
    const store = new BotRouteStore();
    store.settings.set('bot.config.v1', {
      ...DEFAULT_BOT_CONFIG,
      weixin: { ...DEFAULT_BOT_CONFIG.weixin, enabled: true, accountId: 'wx_account' },
    });
    const sendMessage = vi.fn(async () => ({ ok: true, messageId: 'sent_1' }));
    const response = res();
    const path = routePath('/api/bot/weixin/message');

    await handleBotRoute({
      req: req('POST', '/api/bot/weixin/message', {
        chatId: 'friend_a',
        userId: 'friend_a',
        userName: '张三',
        text: '你好',
        messageId: 'msg_1',
        chatType: 'dm',
      }),
      res: response,
      url: path.url,
      segments: path.segments,
      store: store as unknown as ThreadStore,
      getDefaultRunConfig: async () => runConfig,
      createAgent: async () => ({
        agent: {
          getRuntimeState: () => ({ status: 'idle' }),
          runTurn: vi.fn(async () => ({
            items: [{ type: 'agent_message' as const, text: '收到', id: 'a', turnId: 't' }],
            usage: null,
          })),
        },
      }),
      createWeixinClient: () => ({ sendMessage } as never),
      createId: () => 'thread_bot',
      now: () => '2026-06-11T00:00:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ result: { status: 'completed', threadId: 'thread_bot' } });
    expect(sendMessage).toHaveBeenCalledWith({ accountId: 'wx_account', to: 'friend_a', text: '收到' });
  });
});
