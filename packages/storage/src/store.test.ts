import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './index.js';
import type { ThreadMeta, TurnMeta } from '@nexus/protocol';

describe('LocalThreadStore settings', () => {
  it('persists arbitrary JSON settings by key', async () => {
    const { store } = createStore(mkdtempSync(join(tmpdir(), 'nexus-storage-')));

    await store.setSetting('runConfig.default', {
      provider: 'volcengine',
      model: 'doubao-seed-1.6',
    });

    await expect(store.getSetting('runConfig.default')).resolves.toEqual({
      provider: 'volcengine',
      model: 'doubao-seed-1.6',
    });
  });
});

describe('LocalThreadStore threads', () => {
  it('persists thread spawn edges and lists children by open/closed status', async () => {
    const { store } = createStore(mkdtempSync(join(tmpdir(), 'nexus-storage-')));
    const now = new Date().toISOString();
    const parent: ThreadMeta = {
      threadId: 'thread-parent',
      title: 'Parent',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags: {},
    };
    const child: ThreadMeta = {
      ...parent,
      threadId: 'thread-child',
      title: 'Child',
      parentThreadId: parent.threadId,
      agentNickname: 'worker',
      agentRole: 'reviewer',
    };

    await store.createThread(parent);
    await store.createThread(child);
    await store.upsertThreadSpawnEdge({
      parentThreadId: parent.threadId,
      childThreadId: child.threadId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    });

    await expect(store.listThreadSpawnChildren(parent.threadId)).resolves.toEqual([
      expect.objectContaining({
        parentThreadId: parent.threadId,
        childThreadId: child.threadId,
        status: 'open',
      }),
    ]);

    await store.setThreadSpawnEdgeStatus(parent.threadId, child.threadId, 'closed');

    await expect(store.listThreadSpawnChildren(parent.threadId, 'open')).resolves.toEqual([]);
    await expect(store.listThreadSpawnChildren(parent.threadId, 'closed')).resolves.toEqual([
      expect.objectContaining({
        childThreadId: child.threadId,
        status: 'closed',
      }),
    ]);
  });

  it('recovers missing thread and turn metadata from rollout JSONL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nexus-storage-'));
    const threadId = 'thread-recover-test';
    const turnId = 'turn-recover-test';
    const now = '2026-06-08T10:00:00.000Z';

    mkdirSync(join(dataDir, 'rollouts'), { recursive: true });
    writeFileSync(
      join(dataDir, 'rollouts', `${threadId}.jsonl`),
      [
        JSON.stringify({
          type: '__checkpoint__',
          threadId,
          turnId,
          itemIndex: 0,
          timestamp: now,
        }),
        JSON.stringify({
          id: `${turnId}_item_0`,
          type: 'user_message',
          turnId,
          text: '恢复这个旧会话',
        }),
        JSON.stringify({
          id: `${turnId}_item_1`,
          type: 'agent_message',
          turnId,
          text: '已恢复。',
        }),
        '',
      ].join('\n'),
      'utf-8',
    );

    const { store } = createStore(dataDir);

    await expect(store.listThreads()).resolves.toMatchObject([
      {
        threadId,
        title: '恢复这个旧会话',
        status: 'active',
        turnCount: 1,
      },
    ]);
    await expect(store.getTurns(threadId)).resolves.toMatchObject([
      {
        turnId,
        threadId,
        index: 0,
        userInput: { type: 'text', text: '恢复这个旧会话' },
        status: 'completed',
      },
    ]);
    await expect(store.getItems(threadId)).resolves.toHaveLength(2);
  });

  it('deletes thread metadata, turns, and rollout items', async () => {
    const { store } = createStore(mkdtempSync(join(tmpdir(), 'nexus-storage-')));
    const now = new Date().toISOString();
    const thread: ThreadMeta = {
      threadId: 'thread-delete-test',
      title: 'Delete me',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags: {},
    };
    const turn: TurnMeta = {
      turnId: 'turn-delete-test',
      threadId: thread.threadId,
      index: 0,
      userInput: { type: 'text', text: 'hello' },
      status: 'completed',
      startedAt: now,
      completedAt: now,
    };

    await store.createThread(thread);
    await store.saveTurn(turn);
    await store.appendItems(thread.threadId, [
      {
        id: 'item-delete-test',
        type: 'agent_message',
        turnId: turn.turnId,
        text: 'ok',
      },
    ]);

    await store.deleteThread(thread.threadId);

    await expect(store.getThread(thread.threadId)).resolves.toBeNull();
    await expect(store.getTurns(thread.threadId)).resolves.toEqual([]);
    await expect(store.getItems(thread.threadId)).resolves.toEqual([]);
  });

  it('records schema migrations so future upgrades are explicit', async () => {
    const { store } = createStore(mkdtempSync(join(tmpdir(), 'nexus-storage-')));

    await expect(store.getSetting('storage.schemaVersion')).resolves.toEqual({
      version: 1,
    });
  });

  it('compacts rollout JSONL before the latest checkpoint item index', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nexus-storage-'));
    const { store } = createStore(dataDir);
    const threadId = 'thread-rollout-compact';
    const now = new Date().toISOString();
    await store.appendItems(threadId, [
      { id: 'old-user', type: 'user_message', turnId: 'turn-old', text: 'old' },
      { id: 'old-agent', type: 'agent_message', turnId: 'turn-old', text: 'old reply' },
    ]);
    await store.appendCheckpoint(threadId, {
      threadId,
      turnId: 'turn-new',
      generation: 1,
      itemIndex: 2,
      status: 'completed',
      timestamp: now,
    });
    await store.appendItems(threadId, [
      { id: 'new-user', type: 'user_message', turnId: 'turn-new', text: 'new' },
      { id: 'new-agent', type: 'agent_message', turnId: 'turn-new', text: 'new reply' },
    ]);

    const result = await store.compactRollout(threadId);

    expect(result.removedItems).toBe(2);
    await expect(store.getItems(threadId)).resolves.toEqual([
      expect.objectContaining({ id: 'new-user' }),
      expect.objectContaining({ id: 'new-agent' }),
    ]);
    expect(readFileSync(join(dataDir, 'rollouts', `${threadId}.jsonl`), 'utf-8')).toContain('__checkpoint__');
  });
});
