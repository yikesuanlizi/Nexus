import type { IncomingMessage, ServerResponse } from 'node:http';
import { compactThread } from '@nexus/memory';
import type { ModelGateway } from '@nexus/model-gateway';
import type { ThreadStore } from '@nexus/storage';
import type { ThreadEvent, ThreadId, ThreadItem, TurnMeta } from '@nexus/protocol';
import { readJson, sendError, sendJson } from './http.js';
import type { AgentRunConfig } from './config.js';

export async function handleCompactThread(options: {
  req: IncomingMessage;
  res: ServerResponse;
  threadId: ThreadId;
  store: ThreadStore;
  getThreadRunConfig(threadId: ThreadId): Promise<AgentRunConfig>;
  saveThreadRunConfig(threadId: ThreadId, config: Partial<AgentRunConfig>): Promise<AgentRunConfig>;
  createModel(config: AgentRunConfig): Promise<ModelGateway>;
  publishEvent(event: ThreadEvent): void;
  generateId(): string;
}): Promise<void> {
  const body = await readJson<{ config?: Partial<AgentRunConfig>; mode?: 'manual' | 'auto'; strategy?: 'llm' | 'local' }>(options.req);
  const config = body.config
    ? await options.saveThreadRunConfig(options.threadId, body.config)
    : await options.getThreadRunConfig(options.threadId);
  const model = await options.createModel(config);
  const thread = await options.store.getThread(options.threadId);
  if (!thread) {
    sendError(options.res, 404, 'Thread not found');
    return;
  }

  const turnId = options.generateId();
  const startedAt = new Date().toISOString();
  const turn: TurnMeta = {
    turnId,
    threadId: options.threadId,
    index: thread.turnCount,
    userInput: { type: 'text', text: '/compact' },
    status: 'running',
    startedAt,
    completedAt: null,
  };
  await options.store.saveTurn(turn);
  await options.store.updateThreadMetadata(options.threadId, { turnCount: thread.turnCount + 1 });
  options.publishEvent({ type: 'turn.started', threadId: options.threadId, turnId, turnIndex: thread.turnCount });

  try {
    const result = await compactThread(options.threadId, options.store, model, {
      trigger: body.mode ?? 'manual',
      compactionTurnId: turnId,
      strategy: body.strategy ?? 'llm',
    });
    if (result.item) {
      options.publishEvent({ type: 'item.started', threadId: options.threadId, turnId, item: result.item });
      options.publishEvent({ type: 'item.completed', threadId: options.threadId, turnId, item: result.item });
      options.publishEvent({
        type: 'thread.compacted',
        threadId: options.threadId,
        compactedTurns: result.compactedTurns,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      });
    }
    turn.status = 'completed';
    turn.completedAt = new Date().toISOString();
    await options.store.saveTurn(turn);
    options.publishEvent({ type: 'turn.completed', threadId: options.threadId, turnId, usage: null, status: 'completed' });
    sendJson(options.res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorItem: ThreadItem = {
      id: `${turnId}_item_error`,
      type: 'error',
      turnId,
      message,
      timestamp: new Date().toISOString(),
    };
    await options.store.appendItems(options.threadId, [errorItem]);
    options.publishEvent({ type: 'item.completed', threadId: options.threadId, turnId, item: errorItem });
    turn.status = 'failed';
    turn.completedAt = new Date().toISOString();
    await options.store.saveTurn(turn);
    options.publishEvent({ type: 'turn.failed', threadId: options.threadId, turnId, error: { message } });
    sendError(options.res, 500, message);
  }
}
