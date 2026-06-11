import type { ThreadMeta } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import type {
  BotDedupeState,
  BotInboundMessage,
  BotOutboundMessage,
  BotRunContext,
  BotRunResult,
  BotSession,
  BotSessionState,
  BotTurnResult,
} from './types.js';

export const BOT_SESSIONS_KEY = 'bot.sessions.v1';
export const BOT_DEDUPE_KEY = 'bot.dedupe.v1';

export interface BotGatewayOptions {
  store: ThreadStore;
  runTurn(threadId: string, text: string, context: BotRunContext): Promise<BotRunResult>;
  send(message: BotOutboundMessage): Promise<void>;
  isThreadRunning?(threadId: string): boolean | Promise<boolean>;
  now?(): string;
  createId?(): string;
  defaultWorkspaceRoot: string;
  preferredThreadId?: string;
  locale?: 'zh' | 'en';
  dedupeTtlMs?: number;
}

export class BotGateway {
  private readonly store: ThreadStore;
  private readonly runTurn: BotGatewayOptions['runTurn'];
  private readonly send: BotGatewayOptions['send'];
  private readonly isThreadRunning: NonNullable<BotGatewayOptions['isThreadRunning']>;
  private readonly now: NonNullable<BotGatewayOptions['now']>;
  private readonly createId: NonNullable<BotGatewayOptions['createId']>;
  private readonly defaultWorkspaceRoot: string;
  private readonly preferredThreadId: string;
  private readonly locale: 'zh' | 'en';
  private readonly dedupeTtlMs: number;

  constructor(options: BotGatewayOptions) {
    this.store = options.store;
    this.runTurn = options.runTurn;
    this.send = options.send;
    this.isThreadRunning = options.isThreadRunning ?? (() => false);
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    this.defaultWorkspaceRoot = options.defaultWorkspaceRoot;
    this.preferredThreadId = options.preferredThreadId?.trim() ?? '';
    this.locale = options.locale ?? 'zh';
    this.dedupeTtlMs = options.dedupeTtlMs ?? 24 * 60 * 60 * 1000;
  }

  async handleMessage(message: BotInboundMessage): Promise<BotTurnResult> {
    const trimmed = message.text.trim();
    if (!trimmed) return { status: 'failed', error: this.locale === 'zh' ? '消息为空' : 'Message is empty' };

    if (await this.hasSeen(message)) {
      return { status: 'duplicate' };
    }
    await this.markSeen(message);

    const session = await this.resolveSession(message);
    if (await this.isThreadRunning(session.threadId)) {
      const reply = this.locale === 'zh'
        ? '上一条消息还在处理中，请稍后再发。'
        : 'The previous message is still running. Please try again shortly.';
      await this.send({
        platform: message.platform,
        chatId: message.chatId,
        text: reply,
        threadId: session.threadId,
      });
      return { status: 'busy', threadId: session.threadId, reply };
    }

    try {
      const result = await this.runTurn(session.threadId, trimmed, {
        platform: message.platform,
        chatId: message.chatId,
        chatType: message.chatType,
        userId: message.userId,
        userName: message.userName,
        messageId: message.messageId,
        sessionKey: session.key,
      });
      const reply = result.text.trim() || (this.locale === 'zh' ? '已完成。' : 'Done.');
      await this.send({
        platform: message.platform,
        chatId: message.chatId,
        text: reply,
        threadId: session.threadId,
      });
      await this.touchSession(session.key);
      return { status: 'completed', threadId: session.threadId, reply };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      const reply = this.locale === 'zh' ? `处理失败：${err}` : `Failed: ${err}`;
      await this.send({
        platform: message.platform,
        chatId: message.chatId,
        text: reply,
        threadId: session.threadId,
      });
      return { status: 'failed', threadId: session.threadId, error: err, reply };
    }
  }

  private sessionKey(message: Pick<BotInboundMessage, 'platform' | 'chatType' | 'chatId' | 'threadId'>): string {
    const topic = message.threadId?.trim();
    return topic
      ? `${message.platform}:${message.chatType}:${message.chatId}:${topic}`
      : `${message.platform}:${message.chatType}:${message.chatId}`;
  }

  private dedupeKey(message: Pick<BotInboundMessage, 'platform' | 'messageId'>): string {
    return `${message.platform}:${message.messageId}`;
  }

  private async readSessions(): Promise<BotSessionState> {
    const stored = await this.store.getSetting<BotSessionState>(BOT_SESSIONS_KEY);
    return { sessions: Array.isArray(stored?.sessions) ? stored.sessions : [] };
  }

  private async writeSessions(state: BotSessionState): Promise<void> {
    await this.store.setSetting(BOT_SESSIONS_KEY, state);
  }

  private async resolveSession(message: BotInboundMessage): Promise<BotSession> {
    const key = this.sessionKey(message);
    const state = await this.readSessions();
    const existing = state.sessions.find((session) => session.key === key);
    if (existing) return existing;

    const now = this.now();
    const title = this.titleForMessage(message);
    const preferredThread = this.preferredThreadId ? await this.store.getThread(this.preferredThreadId) : null;
    if (preferredThread) {
      const session: BotSession = {
        key,
        platform: message.platform,
        chatId: message.chatId,
        chatType: message.chatType,
        threadId: preferredThread.threadId,
        title: preferredThread.title || title,
        createdAt: now,
        updatedAt: now,
      };
      state.sessions.unshift(session);
      await this.writeSessions(state);
      return session;
    }
    const threadId = this.createId();
    const thread: ThreadMeta = {
      threadId,
      title,
      workspaceRoot: this.defaultWorkspaceRoot,
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags: {
        botPlatform: message.platform,
        botSessionKey: key,
      },
    };
    await this.store.createThread(thread);

    const session: BotSession = {
      key,
      platform: message.platform,
      chatId: message.chatId,
      chatType: message.chatType,
      threadId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    state.sessions.unshift(session);
    await this.writeSessions(state);
    return session;
  }

  private async touchSession(key: string): Promise<void> {
    const state = await this.readSessions();
    const next = state.sessions.map((session) => (
      session.key === key ? { ...session, updatedAt: this.now() } : session
    ));
    await this.writeSessions({ sessions: next });
  }

  private titleForMessage(message: BotInboundMessage): string {
    if (message.chatType === 'group') return message.chatId || '微信群';
    return message.userName.trim() || message.userId || '微信联系人';
  }

  private async readDedupe(): Promise<BotDedupeState> {
    const stored = await this.store.getSetting<BotDedupeState>(BOT_DEDUPE_KEY);
    return { entries: Array.isArray(stored?.entries) ? stored.entries : [] };
  }

  private async hasSeen(message: BotInboundMessage): Promise<boolean> {
    const state = await this.readDedupe();
    const key = this.dedupeKey(message);
    return state.entries.some((entry) => entry.key === key);
  }

  private async markSeen(message: BotInboundMessage): Promise<void> {
    const state = await this.readDedupe();
    const now = this.now();
    const cutoff = Date.parse(now) - this.dedupeTtlMs;
    const key = this.dedupeKey(message);
    const entries = state.entries
      .filter((entry) => Date.parse(entry.seenAt) >= cutoff && entry.key !== key)
      .slice(0, 999);
    entries.unshift({ key, seenAt: now });
    await this.store.setSetting(BOT_DEDUPE_KEY, { entries });
  }
}
