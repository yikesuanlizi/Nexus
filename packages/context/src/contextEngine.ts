import type {
  AgentContext,
  ContextChunk,
  ContextEngineConfig,
  AssembledContext,
  ProviderContext,
  ContextPhase,
  ProviderOutput,
  ContextProviderResult,
} from './types.js';

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function isProviderOutput(result: ContextProviderResult): result is ProviderOutput {
  return !Array.isArray(result) && 'chunks' in result;
}

function deduplicateChunks(chunks: ContextChunk[]): ContextChunk[] {
  const seen = new Set<string>();
  const result: ContextChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    result.push(chunk);
  }
  return result;
}

function applyContextPatch(base: AgentContext, patch: ProviderOutput['contextPatch']): AgentContext {
  if (!patch) return base;
  return {
    ...base,
    cognition: patch.cognition
      ? { task: { ...base.cognition.task, ...patch.cognition } }
      : base.cognition,
    world: {
      environment: patch.world?.environment
        ? { ...base.world.environment, ...patch.world.environment }
        : base.world.environment,
      project: patch.world?.project !== undefined
        ? patch.world.project
        : base.world.project,
    },
    memory: patch.memory
      ? { ...(base.memory ?? { retrievedExperiences: [] }), ...patch.memory }
      : base.memory,
    updatedAt: Date.now(),
  };
}

function truncateChunk(chunk: ContextChunk, maxTokens: number): ContextChunk {
  if (chunk.tokens <= maxTokens) return chunk;
  const trailer = '\n...[truncated]';
  const trailerTokens = estimateTokens(trailer);
  const availableTokens = Math.max(50, maxTokens - trailerTokens);
  const ratio = availableTokens / chunk.tokens;
  const truncateAt = Math.floor(chunk.content.length * ratio);
  const truncated = chunk.content.slice(0, Math.max(0, truncateAt)) + trailer;
  return {
    ...chunk,
    content: truncated,
    tokens: estimateTokens(truncated),
    metadata: { ...chunk.metadata, truncated: true },
  };
}

export interface ContextEngine {
  assembleBeforeTurn(
    ctx: ProviderContext,
    signal?: AbortSignal
  ): Promise<AssembledContext>;

  assemblePhase(
    phase: ContextPhase,
    ctx: ProviderContext,
    signal?: AbortSignal
  ): Promise<AssembledContext>;
}

export function createContextEngine(config: ContextEngineConfig): ContextEngine {
  const { totalBudget, providers } = config;

  async function assemblePhase(
    phase: ContextPhase,
    baseCtx: ProviderContext,
    signal?: AbortSignal
  ): Promise<AssembledContext> {
    const phaseProviders = providers.filter((p) => p.phase === phase);
    let currentContext = baseCtx.agentContext;
    const allChunks: ContextChunk[] = [];
    const budget = baseCtx.contextBudget || totalBudget;

    for (const provider of phaseProviders) {
      if (signal?.aborted) break;
      try {
        const ctxForProvider: ProviderContext = {
          ...baseCtx,
          agentContext: currentContext,
        };
        const rawResult = await provider.provide(ctxForProvider, signal);
        const output: ProviderOutput = isProviderOutput(rawResult)
          ? rawResult
          : { chunks: rawResult };

        if (output.contextPatch) {
          currentContext = applyContextPatch(currentContext, output.contextPatch);
        }

        for (const chunk of output.chunks) {
          allChunks.push({
            ...chunk,
            source: chunk.source || provider.name,
            priority: chunk.priority ?? provider.priority,
            tokens: chunk.tokens || estimateTokens(chunk.content),
          });
        }
      } catch (err) {
        console.warn(`[context-engine] Provider "${provider.name}" failed:`, err instanceof Error ? err.message : err);
      }
    }

    const deduped = deduplicateChunks(allChunks);
    const sorted = [...deduped].sort((a, b) => a.priority - b.priority);

    const selected: ContextChunk[] = [];
    let usedTokens = 0;
    let remaining = budget;

    for (const chunk of sorted) {
      if (remaining <= 0) break;
      if (chunk.tokens <= remaining) {
        selected.push(chunk);
        remaining -= chunk.tokens;
        usedTokens += chunk.tokens;
      } else if (remaining > 100) {
        const truncated = truncateChunk(chunk, remaining);
        selected.push(truncated);
        usedTokens += truncated.tokens;
        remaining = 0;
      }
    }

    return {
      chunks: selected,
      updatedAgentContext: currentContext,
      usedTokens,
      remainingTokens: remaining,
    };
  }

  return {
    assembleBeforeTurn(ctx, signal) {
      return assemblePhase('before_turn', ctx, signal);
    },
    assemblePhase,
  };
}
