import { describe, expect, it } from 'vitest';
import type {
  Checkpoint,
  ThreadId,
  ThreadItem,
  ThreadMeta,
  TurnMeta,
  UserInput,
} from '@nexus/protocol';
import { AgentLoop } from './agent.js';
import { ThreadStateManager } from './state.js';
import type { ThreadStore } from '@nexus/storage';
import { LocalSkillRegistry } from '@nexus/extensions';

class FakeStore implements ThreadStore {
  thread: ThreadMeta;
  turns: TurnMeta[];
  items: ThreadItem[] = [];
  checkpoint: Checkpoint | null = null;
  savedTurns: TurnMeta[] = [];

  constructor(threadId: ThreadId, turnId: string) {
    this.thread = {
      threadId,
      title: 'test',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 1,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
      archivedAt: null,
      ephemeral: false,
      tags: {},
    };
    this.turns = [
      {
        turnId,
        threadId,
        index: 0,
        userInput: { type: 'text', text: 'continue me' },
        status: 'running',
        startedAt: '2026-06-07T00:00:00.000Z',
        completedAt: null,
      },
    ];
    this.checkpoint = {
      threadId,
      turnId,
      itemIndex: 0,
      timestamp: '2026-06-07T00:00:01.000Z',
    };
  }

  async appendItems(_threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    this.items.push(...items);
  }

  async updateThreadMetadata(_threadId: ThreadId, patch: Partial<ThreadMeta>): Promise<void> {
    this.thread = { ...this.thread, ...patch };
  }

  async createThread(meta: ThreadMeta): Promise<void> {
    this.thread = meta;
  }

  async getThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    return threadId === this.thread.threadId ? this.thread : null;
  }

  async listThreads(): Promise<ThreadMeta[]> {
    return [this.thread];
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    if (threadId === this.thread.threadId) {
      this.turns = [];
      this.items = [];
      this.checkpoint = null;
    }
  }

  async getItems(): Promise<ThreadItem[]> {
    return this.items;
  }

  async getTurns(): Promise<TurnMeta[]> {
    return this.turns;
  }

  async saveTurn(turn: TurnMeta): Promise<void> {
    this.savedTurns.push(turn);
  }

  async getRecentItems(): Promise<ThreadItem[]> {
    return this.items;
  }

  async getLastCheckpoint(): Promise<Checkpoint | null> {
    return this.checkpoint;
  }

  async appendCheckpoint(_threadId: ThreadId, ckpt: Checkpoint): Promise<void> {
    this.checkpoint = ckpt;
  }

  async getSetting<T = unknown>(): Promise<T | null> {
    return null;
  }

  async setSetting(): Promise<void> {}

  async upsertThreadSpawnEdge(): Promise<void> {}

  async setThreadSpawnEdgeStatus(): Promise<void> {}

  async listThreadSpawnChildren(): Promise<never[]> {
    return [];
  }

  async listThreadSpawnDescendants(): Promise<never[]> {
    return [];
  }
}

class FakeModel {
  lastUserContent: string | null = null;

  async *chatStream(req: { messages: Array<{ role: string; content: unknown }> }) {
    const lastUser = [...req.messages].reverse().find((msg) => msg.role === 'user');
    this.lastUserContent = typeof lastUser?.content === 'string' ? lastUser.content : null;
    yield { type: 'delta' as const, content: 'resumed' };
    yield { type: 'done' as const };
  }
}

class FailingModel {
  async *chatStream() {
    throw new Error('model stream broke');
  }
}

class ToolCallingModel {
  calls: Array<Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }>> = [];

  async *chatStream(req: { messages: Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }> }) {
    this.calls.push(req.messages);

    if (this.calls.length === 1) {
      yield {
        type: 'tool_call_end' as const,
        id: 'call_current_time',
        name: 'current_time',
        arguments: '{}',
      };
      yield { type: 'done' as const };
      return;
    }

    yield { type: 'delta' as const, content: 'ok' };
    yield { type: 'done' as const };
  }
}

class ToolListModel {
  toolNames: string[][] = [];

  async *chatStream(req: { tools?: Array<{ function: { name: string } }> }) {
    this.toolNames.push((req.tools ?? []).map((tool) => tool.function.name));
    yield { type: 'delta' as const, content: 'ok' };
    yield { type: 'done' as const };
  }
}

class MessageCapturingModel {
  messages: Array<Array<{ role: string; content: unknown }>> = [];

  async *chatStream(req: { messages: Array<{ role: string; content: unknown }> }) {
    this.messages.push(req.messages);
    yield { type: 'delta' as const, content: 'ok' };
    yield { type: 'done' as const };
  }
}

class UsageModel {
  async *chatStream() {
    yield { type: 'delta' as const, content: 'ok' };
    yield {
      type: 'done' as const,
      usage: {
        prompt_tokens: 11,
        cached_tokens: 5,
        completion_tokens: 7,
        total_tokens: 18,
        cache_strategy: 'deepseek-native',
      },
    };
  }
}

class MultiThreadStore implements ThreadStore {
  threads = new Map<ThreadId, ThreadMeta>();
  turns = new Map<ThreadId, TurnMeta[]>();
  items = new Map<ThreadId, ThreadItem[]>();
  edges: Array<{
    parentThreadId: ThreadId;
    childThreadId: ThreadId;
    status: 'open' | 'closed';
    createdAt: string;
    updatedAt: string;
  }> = [];
  checkpoints = new Map<ThreadId, Checkpoint>();

  constructor(rootThread: ThreadMeta) {
    this.threads.set(rootThread.threadId, rootThread);
  }

  async appendItems(threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    this.items.set(threadId, [...(this.items.get(threadId) ?? []), ...items]);
  }

  async updateThreadMetadata(threadId: ThreadId, patch: Partial<ThreadMeta>): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) this.threads.set(threadId, { ...thread, ...patch });
  }

  async createThread(meta: ThreadMeta): Promise<void> {
    this.threads.set(meta.threadId, meta);
  }

  async getThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    return this.threads.get(threadId) ?? null;
  }

  async listThreads(): Promise<ThreadMeta[]> {
    return [...this.threads.values()];
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    this.threads.delete(threadId);
    this.turns.delete(threadId);
    this.items.delete(threadId);
    this.edges = this.edges.filter((edge) => edge.parentThreadId !== threadId && edge.childThreadId !== threadId);
  }

  async getItems(threadId: ThreadId): Promise<ThreadItem[]> {
    return this.items.get(threadId) ?? [];
  }

  async getTurns(threadId: ThreadId): Promise<TurnMeta[]> {
    return this.turns.get(threadId) ?? [];
  }

  async saveTurn(turn: TurnMeta): Promise<void> {
    const turns = this.turns.get(turn.threadId) ?? [];
    const index = turns.findIndex((existing) => existing.turnId === turn.turnId);
    if (index >= 0) {
      turns[index] = turn;
    } else {
      turns.push(turn);
    }
    this.turns.set(turn.threadId, turns);
  }

  async getRecentItems(threadId: ThreadId): Promise<ThreadItem[]> {
    return this.items.get(threadId) ?? [];
  }

  async getLastCheckpoint(threadId: ThreadId): Promise<Checkpoint | null> {
    return this.checkpoints.get(threadId) ?? null;
  }

  async appendCheckpoint(threadId: ThreadId, ckpt: Checkpoint): Promise<void> {
    this.checkpoints.set(threadId, ckpt);
  }

  async getSetting<T = unknown>(): Promise<T | null> {
    return null;
  }

  async setSetting(): Promise<void> {}

  async upsertThreadSpawnEdge(edge: {
    parentThreadId: ThreadId;
    childThreadId: ThreadId;
    status: 'open' | 'closed';
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    this.edges = this.edges.filter((existing) => (
      existing.parentThreadId !== edge.parentThreadId || existing.childThreadId !== edge.childThreadId
    ));
    this.edges.push(edge);
  }

  async setThreadSpawnEdgeStatus(parentThreadId: ThreadId, childThreadId: ThreadId, status: 'open' | 'closed'): Promise<void> {
    this.edges = this.edges.map((edge) => (
      edge.parentThreadId === parentThreadId && edge.childThreadId === childThreadId
        ? { ...edge, status, updatedAt: new Date().toISOString() }
        : edge
    ));
  }

  async listThreadSpawnChildren(parentThreadId: ThreadId, status?: 'open' | 'closed') {
    return this.edges.filter((edge) => edge.parentThreadId === parentThreadId && (!status || edge.status === status));
  }

  async listThreadSpawnDescendants(parentThreadId: ThreadId, status?: 'open' | 'closed') {
    const result: typeof this.edges = [];
    const visit = (id: ThreadId) => {
      for (const edge of this.edges.filter((candidate) => candidate.parentThreadId === id && (!status || candidate.status === status))) {
        result.push(edge);
        visit(edge.childThreadId);
      }
    };
    visit(parentThreadId);
    return result;
  }
}

class CollabModel {
  async *chatStream(req: { messages: Array<{ role: string; content: unknown }> }) {
    const lastUser = [...req.messages].reverse().find((message) => message.role === 'user');
    const toolResults = req.messages.filter((message) => message.role === 'tool');
    if (lastUser?.content === 'inspect package') {
      yield { type: 'delta' as const, content: 'child done' };
      yield { type: 'done' as const };
      return;
    }
    if (toolResults.length === 0) {
      yield {
        type: 'tool_call_end' as const,
        id: 'call_spawn',
        name: 'spawn_agent',
        arguments: JSON.stringify({
          prompt: 'inspect package',
          agentRole: 'reviewer',
          agentNickname: 'worker',
        }),
      };
      yield { type: 'done' as const };
      return;
    }
    if (toolResults.length === 1) {
      yield {
        type: 'tool_call_end' as const,
        id: 'call_wait',
        name: 'wait',
        arguments: '{}',
      };
      yield { type: 'done' as const };
      return;
    }
    yield { type: 'delta' as const, content: 'parent done' };
    yield { type: 'done' as const };
  }
}

class CollabCommandModel {
  constructor(
    private readonly toolName: string,
    private readonly args: Record<string, unknown>,
    private readonly childReplies: Record<string, string> = {},
  ) {}

  async *chatStream(req: { messages: Array<{ role: string; content: unknown }> }) {
    const lastUser = [...req.messages].reverse().find((message) => message.role === 'user');
    if (typeof lastUser?.content === 'string' && this.childReplies[lastUser.content]) {
      yield { type: 'delta' as const, content: this.childReplies[lastUser.content] };
      yield { type: 'done' as const };
      return;
    }

    const toolResults = req.messages.filter((message) => message.role === 'tool');
    if (toolResults.length === 0) {
      yield {
        type: 'tool_call_end' as const,
        id: `call_${this.toolName}`,
        name: this.toolName,
        arguments: JSON.stringify(this.args),
      };
      yield { type: 'done' as const };
      return;
    }

    yield { type: 'delta' as const, content: 'parent done' };
    yield { type: 'done' as const };
  }
}

function createThread(threadId: ThreadId, title = threadId): ThreadMeta {
  const now = new Date().toISOString();
  return {
    threadId,
    title,
    workspaceRoot: process.cwd(),
    status: 'active',
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ephemeral: false,
    tags: {},
  };
}

describe('AgentLoop resumeRunning', () => {
  it('loads checkpoint and original user input from storage when process state was lost', async () => {
    const threadId = 'thread-cold-resume';
    const turnId = 'turn-cold-resume';
    const store = new FakeStore(threadId, turnId);
    const model = new FakeModel();
    const stateManager = new ThreadStateManager();

    const agent = new AgentLoop(
      {
        workspaceRoot: process.cwd(),
        sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
        model: model as never,
        store,
      },
      stateManager,
    );

    const result = await agent.resumeRunning(threadId);

    expect(model.lastUserContent).toBe('continue me');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe('agent_message');
    expect(store.savedTurns).toHaveLength(1);
    expect(store.savedTurns[0]?.turnId).toBe(turnId);
    expect(store.savedTurns[0]?.status).toBe('completed');
  });
});

describe('AgentLoop runTurn failure handling', () => {
  it('persists an error item when the model stream fails', async () => {
    const threadId = 'thread-failing-turn';
    const store = new FakeStore(threadId, 'previous-turn');
    const stateManager = new ThreadStateManager();
    const agent = new AgentLoop(
      {
        workspaceRoot: process.cwd(),
        sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
        model: new FailingModel() as never,
        store,
      },
      stateManager,
    );

    await expect(agent.runTurn(threadId, { type: 'text', text: '今天周几' })).rejects.toThrow(
      'model stream broke',
    );

    expect(store.items.map((item) => item.type)).toEqual(['user_message', 'error']);
    expect(store.items[1]).toMatchObject({
      type: 'error',
      message: 'model stream broke',
    });
    expect(store.savedTurns.at(-1)).toMatchObject({
      status: 'failed',
    });
  });
});

describe('AgentLoop checkpoint metadata', () => {
  it('writes terminal checkpoints with status and generation and without running expiry', async () => {
    const threadId = 'thread-checkpoint-status';
    const store = new FakeStore(threadId, 'previous-turn');
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: new FakeModel() as never,
      store,
    });

    await agent.runTurn(threadId, { type: 'text', text: '检查 checkpoint' });

    expect(store.checkpoint).toMatchObject({
      threadId,
      itemIndex: 2,
      status: 'completed',
      generation: expect.any(Number),
    });
    expect(store.checkpoint?.expiresAt).toBeUndefined();
  });
});

describe('AgentLoop interrupt handling', () => {
  it('emits an interrupted completion event instead of a failed turn', () => {
    const threadId = 'thread-interrupt';
    const turnId = 'turn-interrupt';
    const stateManager = new ThreadStateManager();
    stateManager.startTurn(threadId, turnId);
    const agent = new AgentLoop(
      {
        workspaceRoot: process.cwd(),
        sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
        model: new FakeModel() as never,
        store: new FakeStore(threadId, turnId),
      },
      stateManager,
    );
    const events: Array<{ type: string; status?: string }> = [];
    agent.onEvent((event) => events.push(event as never));

    expect(agent.interrupt(threadId)).toBe(true);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.completed',
      status: 'interrupted',
    }));
    expect(events.some((event) => event.type === 'turn.failed')).toBe(false);
  });
});

describe('AgentLoop message history', () => {
  it('does not replay persisted tool results as orphan OpenAI tool messages on the next turn', async () => {
    const threadId = 'thread-tool-history';
    const store = new FakeStore(threadId, 'previous-turn');
    const model = new ToolCallingModel();
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: model as never,
      store,
    });

    await agent.runTurn(threadId, { type: 'text', text: '现在几点' });
    await agent.runTurn(threadId, { type: 'text', text: '继续' });

    const secondTurnInitialMessages = model.calls[2] ?? [];
    expect(secondTurnInitialMessages.some((msg) => msg.role === 'tool')).toBe(false);
  });

  it('injects the selected skill body when the user mentions a skill token', async () => {
    const skills = new LocalSkillRegistry();
    skills.register({
      name: 'frontend-design',
      description: 'Design frontend UI.',
      body: 'Use the frontend-design body, not only the summary.',
      sourcePath: 'C:/skills/frontend-design/SKILL.md',
    });
    const model = new MessageCapturingModel();
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: model as never,
      store: new FakeStore('thread-skill-token', 'previous-turn'),
      skills,
    });

    await agent.runTurn('thread-skill-token', {
      type: 'text',
      text: '$frontend-design 优化这个界面',
    });

    expect(model.messages[0]?.some((message) => (
      message.role === 'system'
      && typeof message.content === 'string'
      && message.content.includes('Use the frontend-design body')
    ))).toBe(true);
  });

  it('does not include compacted turn items in model history after compaction', async () => {
    const threadId = 'thread-compacted-history';
    const store = new FakeStore(threadId, 'previous-turn');
    store.turns = [
      {
        turnId: 'old-turn',
        threadId,
        index: 0,
        userInput: { type: 'text', text: 'old secret request' },
        status: 'completed',
        startedAt: '2026-06-10T00:00:00.000Z',
        completedAt: '2026-06-10T00:00:01.000Z',
      },
      {
        turnId: 'recent-turn',
        threadId,
        index: 1,
        userInput: { type: 'text', text: 'recent request' },
        status: 'completed',
        startedAt: '2026-06-10T00:01:00.000Z',
        completedAt: '2026-06-10T00:01:01.000Z',
      },
    ];
    store.items = [
      { id: 'old-user', type: 'user_message', turnId: 'old-turn', text: 'old secret request' },
      { id: 'old-tool', type: 'tool_call', turnId: 'old-turn', toolName: 'read_file', arguments: {}, result: 'OLD_TOOL_OUTPUT_SECRET', status: 'completed' },
      { id: 'recent-user', type: 'user_message', turnId: 'recent-turn', text: 'recent request' },
      { id: 'recent-agent', type: 'agent_message', turnId: 'recent-turn', text: 'recent answer' },
    ];
    store.thread = {
      ...store.thread,
      status: 'compacted',
      tags: {
        compactedSummary: 'Summary keeps the old goal without raw tool output.',
        compactedRanges: JSON.stringify([
          {
            compactedTurnIds: ['old-turn'],
            retainedTurnIds: ['recent-turn'],
            compactionItemId: 'compact-1',
            summary: 'Summary keeps the old goal without raw tool output.',
          },
        ]),
      },
    };
    const model = new MessageCapturingModel();
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: model as never,
      store,
    });

    await agent.runTurn(threadId, { type: 'text', text: 'continue' });

    const serialized = JSON.stringify(model.messages[0]);
    expect(serialized).toContain('Summary keeps the old goal');
    expect(serialized).toContain('recent answer');
    expect(serialized).not.toContain('OLD_TOOL_OUTPUT_SECRET');
    expect(serialized).not.toContain('old secret request');
  });
});

describe('AgentLoop usage accounting', () => {
  it('emits and persists thread-level cumulative token usage', async () => {
    const threadId = 'thread-usage';
    const store = new FakeStore(threadId, 'previous-turn');
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: new UsageModel() as never,
      store,
    });
    const usageEvents: unknown[] = [];
    agent.onEvent((event) => {
      if (event.type === 'thread.token_usage.updated') usageEvents.push(event);
    });

    await agent.runTurn(threadId, { type: 'text', text: 'first' });
    await agent.runTurn(threadId, { type: 'text', text: 'second' });

    expect(usageEvents.at(-1)).toMatchObject({
      type: 'thread.token_usage.updated',
      threadId,
      usage: {
        total: {
          inputTokens: 22,
          cachedInputTokens: 10,
          outputTokens: 14,
          cacheStrategy: 'deepseek-native',
        },
      },
    });
    expect(JSON.parse(store.thread.tags.threadUsage)).toMatchObject({
      total: {
        inputTokens: 22,
        cachedInputTokens: 10,
        outputTokens: 14,
        cacheStrategy: 'deepseek-native',
      },
    });
  });

  it('emits soft compaction pressure before automatic compaction is triggered', async () => {
    const threadId = 'thread-soft-pressure';
    const store = new FakeStore(threadId, 'previous-turn');
    store.items = [
      {
        id: 'old-agent',
        type: 'agent_message',
        turnId: 'old-turn',
        text: 'x'.repeat(90_000),
      },
    ];
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: new FakeModel() as never,
      store,
    });
    const pressureEvents: unknown[] = [];
    agent.onEvent((event) => {
      if (event.type === 'context.compaction_pressure') pressureEvents.push(event);
    });

    await agent.runTurn(threadId, { type: 'text', text: '继续' });

    expect(pressureEvents).toEqual([
      expect.objectContaining({
        type: 'context.compaction_pressure',
        threadId,
        pressure: expect.objectContaining({ status: 'soft' }),
      }),
    ]);
  });
});

describe('AgentLoop web search tool policy', () => {
  it('only exposes web_search when the configured policy enables it', async () => {
    const offModel = new ToolListModel();
    const offAgent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: offModel as never,
      store: new FakeStore('thread-web-search-off', 'previous-turn'),
      webSearchMode: 'off',
    });
    await offAgent.runTurn('thread-web-search-off', {
      type: 'text',
      text: '联网搜索 LangChain 最新版本',
    });
    expect(offModel.toolNames[0]).not.toContain('web_search');

    const onModel = new ToolListModel();
    const onAgent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: onModel as never,
      store: new FakeStore('thread-web-search-on', 'previous-turn'),
      webSearchMode: 'on',
    });
    await onAgent.runTurn('thread-web-search-on', {
      type: 'text',
      text: '普通问题',
    });
    expect(onModel.toolNames[0]).toContain('web_search');

    const autoModel = new ToolListModel();
    const autoAgent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: autoModel as never,
      store: new FakeStore('thread-web-search-auto', 'previous-turn'),
      webSearchMode: 'auto',
    });
    await autoAgent.runTurn('thread-web-search-auto', {
      type: 'text',
      text: '联网搜索 LangChain 最新版本',
    });
    expect(autoModel.toolNames[0]).toContain('web_search');
  });
});

describe('AgentLoop collaboration tools', () => {
  it('spawns a child thread, records collab tool calls, and waits for the child result', async () => {
    const now = new Date().toISOString();
    const parentThread: ThreadMeta = {
      threadId: 'thread-parent-collab',
      title: 'parent',
      workspaceRoot: process.cwd(),
      status: 'active',
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ephemeral: false,
      tags: {},
    };
    const store = new MultiThreadStore(parentThread);
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: new CollabModel() as never,
      store,
      locale: 'zh',
    });
    const events: Array<{ type: string; threadId?: string; childThreadId?: string; event?: { type?: string } }> = [];
    agent.onEvent((event) => events.push(event as never));

    await agent.runTurn(parentThread.threadId, { type: 'text', text: '派一个子 agent 检查项目' });

    const child = [...store.threads.values()].find((thread) => thread.parentThreadId === parentThread.threadId);
    expect(child).toMatchObject({
      agentNickname: 'worker',
      agentRole: 'reviewer',
    });
    expect(store.edges).toEqual([
      expect.objectContaining({
        parentThreadId: parentThread.threadId,
        childThreadId: child?.threadId,
        status: 'open',
      }),
    ]);
    expect(store.items.get(parentThread.threadId)?.filter((item) => item.type === 'collab_tool_call')).toEqual([
      expect.objectContaining({
        tool: 'spawn_agent',
        status: 'completed',
        newThreadId: child?.threadId,
        result: expect.objectContaining({
          envelope: expect.objectContaining({
            schemaVersion: 1,
            senderThreadId: parentThread.threadId,
            receiverThreadId: child?.threadId,
            task: 'inspect package',
            locale: 'zh',
            webSearchMode: 'auto',
            permissions: expect.objectContaining({ level: 'workspace_write' }),
            constraints: expect.arrayContaining([
              expect.objectContaining({ layer: 'parent_delegation' }),
              expect.objectContaining({ layer: 'subagent_role' }),
            ]),
          }),
        }),
      }),
      expect.objectContaining({ tool: 'wait', status: 'completed', receiverThreadId: child?.threadId }),
    ]);
    expect((store.items.get(child!.threadId) ?? []).some((item) => item.type === 'agent_message' && item.text === 'child done')).toBe(true);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'child_agent.event',
        threadId: parentThread.threadId,
        childThreadId: child?.threadId,
        event: expect.objectContaining({ type: 'item.completed' }),
      }),
    ]));
    expect(store.items.get(parentThread.threadId)?.at(-1)).toMatchObject({
      type: 'agent_message',
      text: 'parent done',
    });
  });

  it('send_input starts a new child turn and records the delegated prompt', async () => {
    const parent = createThread('thread-parent-send', 'parent');
    const child = {
      ...createThread('thread-child-send', 'child'),
      parentThreadId: parent.threadId,
      agentRole: 'reviewer',
      agentNickname: 'worker',
    };
    const store = new MultiThreadStore(parent);
    await store.createThread(child);
    await store.upsertThreadSpawnEdge({
      parentThreadId: parent.threadId,
      childThreadId: child.threadId,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const agent = new AgentLoop({
      workspaceRoot: process.cwd(),
      sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
      model: new CollabCommandModel('send_input', {
        threadId: child.threadId,
        prompt: 'follow up',
      }, { 'follow up': 'child followup done' }) as never,
      store,
      locale: 'zh',
    });

    await agent.runTurn(parent.threadId, { type: 'text', text: '继续子 agent' });

    const childTurn = store.turns.get(child.threadId)?.at(-1);
    expect(childTurn).toMatchObject({
      threadId: child.threadId,
      userInput: { type: 'text', text: 'follow up' },
    });
    expect(['running', 'completed']).toContain(childTurn?.status);
    expect(store.items.get(child.threadId)?.some((item) => (
      item.type === 'user_message' && item.text === 'follow up'
    ))).toBe(true);
    expect(store.items.get(parent.threadId)?.find((item) => item.type === 'collab_tool_call')).toMatchObject({
      tool: 'send_input',
      status: 'completed',
      receiverThreadId: child.threadId,
      prompt: 'follow up',
      agentStatus: 'running',
    });
  });

  it('close_agent closes the edge and persists an interrupted running child turn', async () => {
    const parent = createThread('thread-parent-close', 'parent');
    const child = {
      ...createThread('thread-child-close', 'child'),
      parentThreadId: parent.threadId,
      turnCount: 1,
    };
    const runningTurn: TurnMeta = {
      turnId: 'child-running-turn',
      threadId: child.threadId,
      index: 0,
      userInput: { type: 'text', text: 'long child work' },
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    const store = new MultiThreadStore(parent);
    await store.createThread(child);
    await store.saveTurn(runningTurn);
    await store.appendCheckpoint(child.threadId, {
      threadId: child.threadId,
      turnId: runningTurn.turnId,
      itemIndex: 0,
      timestamp: new Date().toISOString(),
      status: 'running',
    });
    await store.upsertThreadSpawnEdge({
      parentThreadId: parent.threadId,
      childThreadId: child.threadId,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const stateManager = new ThreadStateManager();
    stateManager.startTurn(child.threadId, runningTurn.turnId);
    const agent = new AgentLoop(
      {
        workspaceRoot: process.cwd(),
        sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
        model: new CollabCommandModel('close_agent', { threadId: child.threadId }) as never,
        store,
      },
      stateManager,
    );

    await agent.runTurn(parent.threadId, { type: 'text', text: '关闭子 agent' });

    expect(store.edges[0]).toMatchObject({ childThreadId: child.threadId, status: 'closed' });
    expect(store.turns.get(child.threadId)?.[0]).toMatchObject({
      turnId: runningTurn.turnId,
      status: 'interrupted',
    });
    expect(store.checkpoints.get(child.threadId)).toMatchObject({
      threadId: child.threadId,
      turnId: runningTurn.turnId,
      status: 'interrupted',
    });
    expect(stateManager.isRunning(child.threadId)).toBe(false);
  });

  it('resume_agent reconnects an open child running checkpoint into runtime state', async () => {
    const parent = createThread('thread-parent-resume-agent', 'parent');
    const child = {
      ...createThread('thread-child-resume-agent', 'child'),
      parentThreadId: parent.threadId,
      agentRole: 'researcher',
      agentNickname: 'worker',
      turnCount: 1,
    };
    const runningTurn: TurnMeta = {
      turnId: 'child-resumable-turn',
      threadId: child.threadId,
      index: 0,
      userInput: { type: 'text', text: 'resumable child work' },
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    const checkpoint: Checkpoint = {
      threadId: child.threadId,
      turnId: runningTurn.turnId,
      itemIndex: 2,
      timestamp: new Date().toISOString(),
      status: 'running',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const store = new MultiThreadStore(parent);
    await store.createThread(child);
    await store.saveTurn(runningTurn);
    await store.appendCheckpoint(child.threadId, checkpoint);
    await store.upsertThreadSpawnEdge({
      parentThreadId: parent.threadId,
      childThreadId: child.threadId,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const stateManager = new ThreadStateManager();
    const agent = new AgentLoop(
      {
        workspaceRoot: process.cwd(),
        sandbox: { level: 'workspace_write', workspaceRoot: process.cwd() },
        model: new CollabCommandModel('resume_agent', { threadId: child.threadId }) as never,
        store,
      },
      stateManager,
    );

    await agent.runTurn(parent.threadId, { type: 'text', text: '恢复子 agent' });

    expect(stateManager.get(child.threadId).lastCheckpoint).toMatchObject(checkpoint);
    expect(store.items.get(parent.threadId)?.find((item) => item.type === 'collab_tool_call')).toMatchObject({
      tool: 'resume_agent',
      status: 'completed',
      receiverThreadId: child.threadId,
      agentStatus: 'running',
      result: expect.objectContaining({
        childThreadId: child.threadId,
        status: 'running',
        resumable: true,
      }),
    });
  });
});
