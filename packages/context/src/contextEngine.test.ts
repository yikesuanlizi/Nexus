import { describe, expect, it } from 'vitest';
import { createContextEngine } from './contextEngine.js';
import { createInitialAgentContext, type AgentContext, type ContextProvider, type ContextChunk, type ProviderContext } from './types.js';
import { TaskContextProvider } from './providers/taskContext.js';
import { EnvironmentContextProvider } from './providers/environmentContext.js';

function makeProviderCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  const env = { cwd: '/tmp/test', os: 'linux' as const, shell: '/bin/bash' };
  return {
    threadId: 'thr_test',
    turnId: 'turn_1',
    userInput: 'fix the login bug',
    agentContext: createInitialAgentContext(env),
    items: [],
    contextBudget: 2000,
    ...overrides,
  };
}

describe('ContextEngine', () => {
  it('assembles chunks from providers in priority order', async () => {
    const lowPriority: ContextProvider = {
      name: 'low',
      priority: 100,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        return [{ id: 'low-1', source: 'low', priority: 100, tokens: 100, content: 'low priority content' }];
      },
    };
    const highPriority: ContextProvider = {
      name: 'high',
      priority: 1,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        return [{ id: 'high-1', source: 'high', priority: 1, tokens: 100, content: 'high priority content' }];
      },
    };
    const engine = createContextEngine({ totalBudget: 500, providers: [lowPriority, highPriority] });
    const result = await engine.assembleBeforeTurn(makeProviderCtx());
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]!.id).toBe('high-1');
    expect(result.chunks[1]!.id).toBe('low-1');
  });

  it('applies token budget and truncates oversized chunks', async () => {
    const bigChunk: ContextProvider = {
      name: 'big',
      priority: 10,
      maxTokens: 2000,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        const content = 'A'.repeat(7000);
        return [{ id: 'big-1', source: 'big', priority: 10, tokens: 2000, content }];
      },
    };
    const engine = createContextEngine({ totalBudget: 500, providers: [bigChunk] });
    const result = await engine.assembleBeforeTurn(makeProviderCtx({ contextBudget: 500 }));
    expect(result.chunks).toHaveLength(1);
    expect(result.usedTokens).toBeLessThanOrEqual(500);
    expect(result.remainingTokens).toBe(0);
  });

  it('deduplicates chunks by id', async () => {
    const p1: ContextProvider = {
      name: 'p1',
      priority: 10,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        return [{ id: 'dup', source: 'p1', priority: 10, tokens: 50, content: 'first' }];
      },
    };
    const p2: ContextProvider = {
      name: 'p2',
      priority: 20,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        return [{ id: 'dup', source: 'p2', priority: 20, tokens: 50, content: 'second' }];
      },
    };
    const engine = createContextEngine({ totalBudget: 500, providers: [p1, p2] });
    const result = await engine.assembleBeforeTurn(makeProviderCtx());
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.source).toBe('p1');
  });

  it('applies contextPatch to agentContext', async () => {
    let capturedCtx: AgentContext | undefined;
    const p: ContextProvider = {
      name: 'patcher',
      priority: 10,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(ctx): Promise<{ chunks: ContextChunk[]; contextPatch: { cognition: { goal: string; confidence: number; constraints: string[]; assumptions: string[]; knownFacts: string[]; unknowns: string[]; risks: []; verificationCriteria: string[] } } }> {
        capturedCtx = ctx.agentContext;
        return {
          chunks: [{ id: 'p-1', source: 'patcher', priority: 10, tokens: 30, content: 'patched' }],
          contextPatch: {
            cognition: {
              goal: 'new goal',
              confidence: 0.9,
              constraints: ['c1'],
              assumptions: ['a1'],
              knownFacts: ['f1'],
              unknowns: [],
              risks: [],
              verificationCriteria: ['v1'],
            },
          },
        };
      },
    };
    const engine = createContextEngine({ totalBudget: 500, providers: [p] });
    const ctx = makeProviderCtx();
    const result = await engine.assembleBeforeTurn(ctx);
    expect(capturedCtx).toBe(ctx.agentContext);
    expect(result.updatedAgentContext.cognition.task.goal).toBe('new goal');
    expect(result.updatedAgentContext.cognition.task.constraints).toContain('c1');
  });

  it('gracefully handles provider failures', async () => {
    const failing: ContextProvider = {
      name: 'fail',
      priority: 10,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        throw new Error('boom');
      },
    };
    const ok: ContextProvider = {
      name: 'ok',
      priority: 20,
      maxTokens: 500,
      phase: 'before_turn',
      async provide(): Promise<ContextChunk[]> {
        return [{ id: 'ok-1', source: 'ok', priority: 20, tokens: 50, content: 'ok' }];
      },
    };
    const engine = createContextEngine({ totalBudget: 500, providers: [failing, ok] });
    const result = await engine.assembleBeforeTurn(makeProviderCtx());
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.id).toBe('ok-1');
  });
});

describe('TaskContextProvider', () => {
  it('initializes task cognition from user input on first call', async () => {
    const provider = new TaskContextProvider();
    const ctx = makeProviderCtx({ userInput: 'Implement JWT authentication for the API' });
    const result = await provider.provide(ctx);
    const chunks = Array.isArray(result) ? result : result.chunks;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain('JWT');
    expect(chunks[0]!.content).toContain('Goal:');
  });

  it('preserves existing cognition and does not reinitialize', async () => {
    const provider = new TaskContextProvider();
    const baseCtx = makeProviderCtx({ userInput: 'do something' });
    const first = await provider.provide(baseCtx);
    const firstChunks = Array.isArray(first) ? first : first.chunks;
    expect(firstChunks[0]!.content).toContain('Goal:');
    const afterFirst = (first as { contextPatch?: unknown }).contextPatch
      ? { ...baseCtx, agentContext: { ...baseCtx.agentContext, cognition: { task: { ...baseCtx.agentContext.cognition.task, goal: 'established goal' } } } }
      : baseCtx;
    const second = await provider.provide(afterFirst);
    const secondChunks = Array.isArray(second) ? second : second.chunks;
    expect(secondChunks[0]!.content).toContain('established goal');
  });

  it('uses initial goal from options', async () => {
    const provider = new TaskContextProvider({ initialGoal: 'Refactor auth module', initialConstraints: ['no breaking changes'] });
    const ctx = makeProviderCtx({ userInput: 'hi' });
    const result = await provider.provide(ctx);
    const chunks = Array.isArray(result) ? result : result.chunks;
    expect(chunks[0]!.content).toContain('Refactor auth module');
    expect(chunks[0]!.content).toContain('no breaking changes');
  });
});

describe('EnvironmentContextProvider', () => {
  it('returns environment info including cwd and os', async () => {
    const provider = new EnvironmentContextProvider({ cwd: '/workspace/project' });
    const ctx = makeProviderCtx();
    const result = await provider.provide(ctx);
    const chunks = Array.isArray(result) ? result : result.chunks;
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const content = chunks.map((c) => c.content).join('\n');
    expect(content).toContain('/workspace/project');
  });

  it('caches environment detection on subsequent calls', async () => {
    const provider = new EnvironmentContextProvider({ cwd: '/workspace/project' });
    const ctx = makeProviderCtx();
    const r1 = await provider.provide(ctx);
    const r2 = await provider.provide(ctx);
    const c1 = Array.isArray(r1) ? r1 : r1.chunks;
    const c2 = Array.isArray(r2) ? r2 : r2.chunks;
    expect(c1.length).toBe(c2.length);
  });
});

describe('createInitialAgentContext', () => {
  it('creates a valid initial context', () => {
    const ctx = createInitialAgentContext({ cwd: '/test', os: 'linux', shell: '/bin/sh' });
    expect(ctx.cognition.task).toBeDefined();
    expect(ctx.cognition.task.goal).toBe('');
    expect(ctx.world.environment.cwd).toBe('/test');
    expect(ctx.updatedAt).toBeGreaterThan(0);
  });
});
