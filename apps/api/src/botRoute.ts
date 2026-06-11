import type { IncomingMessage, ServerResponse } from 'node:http';
import { BotGateway, WeixinBridgeClient, type BotInboundMessage } from '@nexus/bot';
import type { ThreadItem } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { readJson, sendError, sendJson } from './http.js';
import type { AgentRunConfig } from './config.js';
import {
  BOT_CONFIG_KEY,
  DEFAULT_BOT_CONFIG,
  mergeBotConfig,
  normalizeBotConfig,
  publicBotConfig,
  type BotConfig,
} from './botConfig.js';

interface MinimalAgent {
  runTurn(threadId: string, input: { type: 'text'; text: string }): Promise<{ items: ThreadItem[]; usage: unknown }>;
  getRuntimeState(threadId: string): { status?: string } | Promise<{ status?: string }>;
}

interface WeixinClientLike {
  health(): Promise<unknown>;
  startLogin(): Promise<unknown>;
  waitLogin(sessionKey: string): Promise<{ connected?: boolean; accountId?: string }>;
  startMonitor(accountId: string): Promise<unknown>;
  stopMonitor(accountId?: string): Promise<unknown>;
  sendMessage(params: { accountId: string; to: string; text: string; contextToken?: string }): Promise<unknown>;
}

export interface BotRouteOptions {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  segments: string[];
  store: ThreadStore;
  getDefaultRunConfig(): Promise<AgentRunConfig>;
  createAgent(config: Partial<AgentRunConfig>): Promise<{ agent: MinimalAgent }>;
  createWeixinClient?(config: BotConfig): WeixinClientLike;
  createId?(): string;
  now?(): string;
}

export async function handleBotRoute(options: BotRouteOptions): Promise<boolean> {
  const { req, res, segments } = options;
  if (segments[0] !== 'api' || segments[1] !== 'bot') return false;

  if (req.method === 'GET' && segments[2] === 'config') {
    sendJson(res, 200, { config: publicBotConfig(await readBotConfig(options.store)) });
    return true;
  }

  if (req.method === 'PATCH' && segments[2] === 'config') {
    const body = await readJson<{ config?: unknown }>(req);
    const current = await readBotConfig(options.store);
    const next = mergeBotConfig(current, body.config ?? {});
    await options.store.setSetting(BOT_CONFIG_KEY, next);
    sendJson(res, 200, { ok: true, config: publicBotConfig(next) });
    return true;
  }

  if (req.method === 'GET' && segments[2] === 'status') {
    const config = await readBotConfig(options.store);
    const status: Record<string, unknown> = {
      weixin: { enabled: config.weixin.enabled, bridgeUrl: config.weixin.bridgeUrl, connected: Boolean(config.weixin.accountId) },
      feishu: { enabled: config.feishu.enabled, status: 'pending' },
      dingtalk: { enabled: config.dingtalk.enabled, status: 'pending' },
      qq: { enabled: config.qq.enabled, status: 'pending' },
    };
    if (config.weixin.enabled) {
      try {
        await createWeixinClient(options, config).health();
        status.weixin = { ...status.weixin as Record<string, unknown>, bridge: 'online' };
      } catch (error) {
        status.weixin = {
          ...status.weixin as Record<string, unknown>,
          bridge: 'offline',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    sendJson(res, 200, { config: publicBotConfig(config), status });
    return true;
  }

  if (segments[2] !== 'weixin') {
    sendError(res, 404, 'Bot platform not found');
    return true;
  }

  if (req.method === 'POST' && segments[3] === 'login' && segments[4] === 'start') {
    const body = await readJson<{ threadId?: string | null }>(req);
    const current = await readBotConfig(options.store);
    const next = mergeBotConfig(current, { weixin: { enabled: true, activeThreadId: body.threadId?.trim() ?? '' } });
    await options.store.setSetting(BOT_CONFIG_KEY, next);
    const result = await createWeixinClient(options, next).startLogin();
    sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && segments[3] === 'login' && segments[4] === 'wait') {
    const body = await readJson<{ sessionKey?: string }>(req);
    const sessionKey = body.sessionKey?.trim();
    if (!sessionKey) {
      sendError(res, 400, 'sessionKey is required');
      return true;
    }
    const current = await readBotConfig(options.store);
    const result = await createWeixinClient(options, current).waitLogin(sessionKey);
    if (result.connected && result.accountId) {
      const next = mergeBotConfig(current, { weixin: { enabled: true, accountId: result.accountId } });
      await options.store.setSetting(BOT_CONFIG_KEY, next);
    }
    sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && segments[3] === 'message') {
    const raw = await readJson<Record<string, unknown>>(req);
    const message = normalizeWeixinInbound(raw);
    if (!message) {
      sendError(res, 400, 'Invalid Weixin message');
      return true;
    }
    const config = await readBotConfig(options.store);
    const defaultRunConfig = await options.getDefaultRunConfig();
    const runConfig = {
      ...defaultRunConfig,
      workspaceRoot: '',
    };
    const client = createWeixinClient(options, config);
    const gateway = new BotGateway({
      store: options.store,
      defaultWorkspaceRoot: runConfig.workspaceRoot,
      preferredThreadId: config.weixin.activeThreadId,
      locale: runConfig.locale ?? 'zh',
      createId: options.createId,
      now: options.now,
      isThreadRunning: async (threadId) => {
        const { agent } = await options.createAgent(runConfig);
        const state = await agent.getRuntimeState(threadId);
        return state.status === 'running';
      },
      runTurn: async (threadId, text) => {
        const { agent } = await options.createAgent(runConfig);
        const result = await agent.runTurn(threadId, { type: 'text', text });
        return { text: latestAgentText(result.items) };
      },
      send: async (outbound) => {
        await client.sendMessage({
          accountId: config.weixin.accountId,
          to: outbound.chatId,
          text: outbound.text,
        });
      },
    });
    const result = await gateway.handleMessage(message);
    sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && segments[3] === 'test-send') {
    const body = await readJson<{ chatId?: string; text?: string; accountId?: string }>(req);
    const chatId = body.chatId?.trim();
    const text = body.text?.trim();
    if (!chatId || !text) {
      sendError(res, 400, 'chatId and text are required');
      return true;
    }
    const config = await readBotConfig(options.store);
    const accountId = body.accountId?.trim() || config.weixin.accountId;
    if (!accountId) {
      sendError(res, 400, 'Weixin account is not connected');
      return true;
    }
    const result = await createWeixinClient(options, config).sendMessage({ accountId, to: chatId, text });
    sendJson(res, 200, { ok: true, result });
    return true;
  }

  sendError(res, 404, 'Bot route not found');
  return true;
}

export async function readBotConfig(store: ThreadStore): Promise<BotConfig> {
  return normalizeBotConfig(await store.getSetting<unknown>(BOT_CONFIG_KEY) ?? DEFAULT_BOT_CONFIG);
}

function createWeixinClient(options: BotRouteOptions, config: BotConfig): WeixinClientLike {
  return options.createWeixinClient?.(config) ?? new WeixinBridgeClient({ rpcUrl: config.weixin.bridgeUrl });
}

function normalizeWeixinInbound(raw: Record<string, unknown>): BotInboundMessage | null {
  const text = normalizeText(raw.text) || normalizeText(asRecord(raw.message).text);
  const chatId = normalizeText(raw.chatId) || normalizeText(raw.fromUserId) || normalizeText(raw.senderId);
  const userId = normalizeText(raw.userId) || normalizeText(raw.senderId) || chatId;
  const messageId = normalizeText(raw.messageId) || normalizeText(raw.id);
  if (!text || !chatId || !userId || !messageId) return null;
  const chatType = raw.chatType === 'group' ? 'group' : 'dm';
  return {
    platform: 'weixin',
    chatType,
    chatId,
    userId,
    userName: normalizeText(raw.userName) || normalizeText(raw.senderName) || userId,
    text,
    messageId,
    threadId: normalizeText(raw.threadId) || undefined,
  };
}

function latestAgentText(items: ThreadItem[]): string {
  return [...items].reverse().find((item) => item.type === 'agent_message')?.text ?? '';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
