import type { ThreadId, ThreadUsage, Usage } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';

export function emptyUsage(threadId: ThreadId): ThreadUsage {
  return {
    threadId,
    total: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    turns: [],
    updatedAt: new Date().toISOString(),
  };
}

export function usageFromThread(thread: { threadId: ThreadId; tags?: Record<string, string> } | null): ThreadUsage {
  if (!thread) return emptyUsage('');
  const raw = thread.tags?.threadUsage;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ThreadUsage;
      if (parsed?.total && Array.isArray(parsed.turns)) return parsed;
    } catch {
      // ignore malformed usage tag
    }
  }
  return emptyUsage(thread.threadId);
}

export function aggregateThreadUsage(threadId: ThreadId, usages: ThreadUsage[]): ThreadUsage {
  const total = usages.reduce<Usage>((sum, usage) => ({
    inputTokens: sum.inputTokens + Number(usage.total.inputTokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + Number(usage.total.cachedInputTokens ?? 0),
    outputTokens: sum.outputTokens + Number(usage.total.outputTokens ?? 0),
    reasoningOutputTokens: sum.reasoningOutputTokens + Number(usage.total.reasoningOutputTokens ?? 0),
    cacheStrategy: combineCacheStrategy(sum.cacheStrategy, usage.total.cacheStrategy),
  }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  const turns = usages.flatMap((usage) => usage.turns);
  const updatedAt = usages
    .map((usage) => usage.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
    threadId,
    total,
    turns,
    updatedAt,
    includedThreadIds: usages.map((usage) => usage.threadId),
  };
}

function combineCacheStrategy(
  left: Usage['cacheStrategy'],
  right: Usage['cacheStrategy'],
): Usage['cacheStrategy'] {
  if (!left) return right;
  if (!right || left === right) return left;
  return 'mixed';
}

export async function usageForThreadTree(store: ThreadStore, threadId: ThreadId): Promise<ThreadUsage> {
  const thread = await store.getThread(threadId);
  const edges = await store.listThreadSpawnDescendants(threadId);
  const children = await Promise.all(edges.map((edge) => store.getThread(edge.childThreadId)));
  return aggregateThreadUsage(threadId, [
    usageFromThread(thread),
    ...children.filter((child): child is NonNullable<typeof child> => Boolean(child)).map(usageFromThread),
  ]);
}
