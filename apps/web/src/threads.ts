import type { ThreadMeta } from './types.js';

export interface OptimisticDeleteResult {
  threads: ThreadMeta[];
  nextThreadId: string;
}

export interface ThreadListRow {
  thread: ThreadMeta;
  depth: number;
}

export function visibleConversationThreads(threads: ThreadMeta[]): ThreadMeta[] {
  return threads.filter((thread) => !thread.parentThreadId);
}

export function filterConversationThreads(threads: ThreadMeta[], query: string): ThreadMeta[] {
  const normalized = query.trim().toLowerCase();
  const visible = visibleConversationThreads(threads);
  if (!normalized) return visible;
  return visible.filter((thread) => {
    const haystack = [
      thread.title,
      thread.threadId,
      thread.status,
      thread.agentNickname ?? '',
      thread.agentRole ?? '',
    ].join('\n').toLowerCase();
    return haystack.includes(normalized);
  });
}

export function buildThreadTreeRows(threads: ThreadMeta[]): ThreadListRow[] {
  const childrenByParent = new Map<string, ThreadMeta[]>();
  const roots: ThreadMeta[] = [];
  for (const thread of threads) {
    const parentId = thread.parentThreadId ?? '';
    if (!parentId) {
      roots.push(thread);
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(thread);
    childrenByParent.set(parentId, children);
  }
  const byUpdated = (a: ThreadMeta, b: ThreadMeta) => b.updatedAt.localeCompare(a.updatedAt);
  roots.sort(byUpdated);
  for (const children of childrenByParent.values()) {
    children.sort(byUpdated);
  }
  const rows: ThreadListRow[] = [];
  const visit = (thread: ThreadMeta, depth: number) => {
    rows.push({ thread, depth });
    for (const child of childrenByParent.get(thread.threadId) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  const attached = new Set(rows.map((row) => row.thread.threadId));
  for (const thread of threads.filter((candidate) => !attached.has(candidate.threadId)).sort(byUpdated)) {
    visit(thread, 0);
  }
  return rows;
}

export function optimisticDeleteThread(
  threads: ThreadMeta[],
  deletedThreadId: string,
  activeThreadId: string,
): OptimisticDeleteResult {
  const nextThreads = threads.filter((thread) => thread.threadId !== deletedThreadId);
  return {
    threads: nextThreads,
    nextThreadId:
      deletedThreadId === activeThreadId
        ? nextThreads[0]?.threadId ?? ''
        : activeThreadId,
  };
}
