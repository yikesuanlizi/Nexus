import type {
  CompactedRange,
  CompactionStrategy,
  CompactionSummary,
  ContextCompactionItem,
  ThreadId,
  ThreadItem,
  TurnMeta,
  ThreadMeta,
} from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import type { ModelGateway } from '@nexus/model-gateway';

// ─── Compaction ─────────────────────────────────────────────────────────────
export interface CompactOptions {
  /** Maximum tokens before triggering compaction. */
  maxTokens: number;
  /** Approximate tokens per character (conservative estimate). */
  tokensPerChar: number;
  /** Minimum number of turns to keep uncompacted at the tail. */
  keepRecentTurns: number;
  /** Whether the compaction was user-triggered or automatic. */
  trigger: 'manual' | 'auto';
  /** Active turn that owns the context_compaction item. */
  compactionTurnId?: string;
  /** Summary strategy: LLM summary or deterministic local trimming. */
  strategy: CompactionStrategy;
  /** Ratio at which the runtime should surface pressure but avoid compaction. */
  softCompactRatio: number;
  /** Ratio at which automatic compaction is allowed to reset the cache prefix. */
  hardCompactRatio: number;
}

const DEFAULT_COMPACT_OPTIONS: CompactOptions = {
  maxTokens: 40_000,
  tokensPerChar: 0.25,
  keepRecentTurns: 3,
  trigger: 'manual',
  strategy: 'llm',
  softCompactRatio: 0.5,
  hardCompactRatio: 0.8,
};

/**
 * Check whether a thread's items exceed the token budget.
 * Uses a rough character-count heuristic.
 */
export function shouldCompact(
  items: ThreadItem[],
  opts: Partial<CompactOptions> = {},
): boolean {
  return getCompactionPressure(items, opts).status === 'hard';
}

export function getCompactionPressure(
  items: ThreadItem[],
  opts: Partial<CompactOptions> = {},
): {
  estimatedTokens: number;
  maxTokens: number;
  softThreshold: number;
  hardThreshold: number;
  ratio: number;
  status: 'ok' | 'soft' | 'hard';
} {
  const resolved = { ...DEFAULT_COMPACT_OPTIONS, ...opts };
  const totalChars = items.reduce((sum, item) => {
    const text = extractItemText(item);
    return sum + text.length;
  }, 0);
  const estimatedTokens = totalChars * resolved.tokensPerChar;
  const softThreshold = resolved.maxTokens * resolved.softCompactRatio;
  const hardThreshold = resolved.maxTokens * resolved.hardCompactRatio;
  return {
    estimatedTokens,
    maxTokens: resolved.maxTokens,
    softThreshold,
    hardThreshold,
    ratio: resolved.maxTokens > 0 ? estimatedTokens / resolved.maxTokens : 1,
    status: estimatedTokens >= hardThreshold ? 'hard' : estimatedTokens >= softThreshold ? 'soft' : 'ok',
  };
}

/** Extract all text from a thread item for token estimation. */
function extractItemText(item: ThreadItem): string {
  switch (item.type) {
    case 'agent_message':
      return item.text;
    case 'reasoning':
      return item.text;
    case 'command_execution':
      return item.command + '\n' + item.aggregatedOutput;
    case 'tool_call':
      return JSON.stringify(item.arguments) + '\n' + JSON.stringify(item.result ?? '');
    case 'mcp_tool_call':
      return JSON.stringify(item.arguments);
    case 'file_change':
      return item.changes.map((c) => `${c.kind}: ${c.path}`).join('\n');
    case 'context_compaction':
      return item.summary?.raw ?? '';
    case 'web_search':
      return item.query;
    case 'todo_list':
      return item.items.map((t) => `[${t.completed ? 'x' : ' '}] ${t.text}`).join('\n');
    case 'error':
      return item.message;
    default:
      return '';
  }
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Compact thread history: summarize old turns and return a compacted context.
 * The model-gateway is used to generate a structured summary of the early turns.
 */
export async function compactThread(
  threadId: ThreadId,
  store: ThreadStore,
  model: ModelGateway,
  opts: Partial<CompactOptions> = {},
): Promise<{
  compactedTurns: number;
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  item?: ContextCompactionItem;
}> {
  const resolved = { ...DEFAULT_COMPACT_OPTIONS, ...opts };
  const items = await store.getRecentItems(threadId, 200);

  const totalChars = items.reduce((sum, i) => sum + extractItemText(i).length, 0);
  const tokensBefore = totalChars * resolved.tokensPerChar;

  if (tokensBefore <= resolved.maxTokens) {
    return { compactedTurns: 0, summary: '', tokensBefore, tokensAfter: tokensBefore };
  }

  // Build a summary prompt
  const turns = await store.getTurns(threadId);
  const compactableTurns = turns
    .filter((turn) => turn.status !== 'running')
    .slice(0, -resolved.keepRecentTurns);
  if (compactableTurns.length === 0) {
    return { compactedTurns: 0, summary: '', tokensBefore, tokensAfter: tokensBefore };
  }
  const compactedTurnIds = compactableTurns.map((turn) => turn.turnId);
  const retainedTurnIds = turns
    .filter((turn) => !compactedTurnIds.includes(turn.turnId))
    .map((turn) => turn.turnId);

  const allItems = await store.getItems(threadId);
  const conversationText = compactableTurns
    .map((turn) => {
      const turnItems = allItems
        .filter((item) => item.turnId === turn.turnId)
        .map((item) => `${item.type}: ${extractItemText(item)}`)
        .join('\n');
      return `Turn ${turn.index}: ${JSON.stringify(turn.userInput)}\n${turnItems}`;
    })
    .join('\n');

  const summary = resolved.strategy === 'local'
    ? buildLocalCompactionSummary(compactableTurns, allItems)
    : messageContentToText((await model.chat({
        messages: [
          {
            role: 'system',
            content:
              'Summarize the following conversation turns concisely. Output a single paragraph covering: what the user asked for, what was done, key decisions, and current state.',
          },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 1000,
      })).choices[0]?.message?.content);
  const structuredSummary = parseCompactionSummary(summary);
  const tokensAfter = Math.ceil(summary.length * resolved.tokensPerChar);
  const now = new Date().toISOString();
  const item: ContextCompactionItem = {
    id: `compact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'context_compaction',
    turnId: resolved.compactionTurnId ?? compactedTurnIds.at(-1) ?? turns.at(-1)?.turnId ?? `compact_${Date.now()}`,
    status: 'completed',
    trigger: resolved.trigger,
    compactedTurnIds,
    retainedTurnIds,
    summary: structuredSummary,
    tokensBefore: Math.ceil(tokensBefore),
    tokensAfter,
    timestamp: now,
  };

  // Update metadata without dropping per-thread runConfig stored in tags.
  const thread = await store.getThread(threadId);
  const previousRanges = parseCompactedRanges(thread?.tags?.compactedRanges);
  const nextRange: CompactedRange = {
    compactedTurnIds,
    retainedTurnIds,
    compactionItemId: item.id,
    summary,
    tokensBefore: Math.ceil(tokensBefore),
    tokensAfter,
    createdAt: now,
    trigger: resolved.trigger,
    strategy: resolved.strategy,
  };
  await store.updateThreadMetadata(threadId, {
    status: 'compacted',
    tags: {
      ...(thread?.tags ?? {}),
      compactedSummary: summary,
      compactedRanges: JSON.stringify([...previousRanges, nextRange]),
    },
  });
  await store.appendItems(threadId, [item]);

  return {
    compactedTurns: compactableTurns.length,
    summary,
    tokensBefore: Math.ceil(tokensBefore),
    tokensAfter,
    item,
  };
}

function buildLocalCompactionSummary(turns: TurnMeta[], allItems: ThreadItem[]): string {
  const lines = turns.map((turn) => {
    const text = allItems
      .filter((item) => item.turnId === turn.turnId)
      .map(extractItemText)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const excerpt = text.length > 180 ? `${text.slice(0, 180)}...` : text;
    const user = turn.userInput.type === 'text' ? turn.userInput.text : '[multimodal]';
    return `Turn ${turn.index}: ${user}${excerpt ? ` -> ${excerpt}` : ''}`;
  });
  return [
    '用户目标：继续早期对话中已经提出的任务。',
    `已完成变更：本地压缩了 ${turns.length} 轮历史。`,
    '关键约束：保留最近对话和当前运行状态。',
    `工具结果：${lines.join(' | ')}`,
    '未完成事项：继续当前用户请求。',
  ].join('\n');
}

function parseCompactedRanges(raw: string | undefined): CompactedRange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as CompactedRange[] : [];
  } catch {
    return [];
  }
}

function parseCompactionSummary(raw: string): CompactionSummary {
  const normalized = raw.trim();
  return {
    userGoal: section(normalized, ['用户目标', 'User goal']) || normalized,
    completedWork: section(normalized, ['已完成变更', 'Completed work']) || '',
    keyConstraints: section(normalized, ['关键约束', 'Key constraints']) || '',
    filesAndArtifacts: section(normalized, ['文件', 'Files', 'Artifacts']) || '',
    toolResults: section(normalized, ['工具结果', 'Tool results']) || '',
    subagentResults: section(normalized, ['子 agent 结论', 'Subagent results']) || '',
    openTasks: section(normalized, ['未完成事项', 'Open tasks']) || '',
    risks: section(normalized, ['风险', 'Risks']) || '',
    raw: normalized,
  };
}

function section(raw: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = raw.match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n]+)`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

// ─── Resume ─────────────────────────────────────────────────────────────────
export interface ResumeResult {
  thread: ThreadMeta;
  turns: TurnMeta[];
  recentItems: ThreadItem[];
}

/** Resume a thread from storage with full context. */
export async function resumeThread(
  threadId: ThreadId,
  store: ThreadStore,
): Promise<ResumeResult | null> {
  const thread = await store.getThread(threadId);
  if (!thread) return null;
  const turns = await store.getTurns(threadId);
  const recentItems = await store.getRecentItems(threadId, 200);
  return { thread, turns, recentItems };
}

// ─── Fork ───────────────────────────────────────────────────────────────────
/** Create a new thread as a copy of an existing one. */
export async function forkThread(
  sourceThreadId: ThreadId,
  store: ThreadStore,
  workspaceRoot: string,
): Promise<ThreadMeta> {
  const source = await store.getThread(sourceThreadId);
  if (!source) throw new Error(`Source thread ${sourceThreadId} not found`);

  const newId = generateId();
  const now = new Date().toISOString();
  const meta: ThreadMeta = {
    ...source,
    threadId: newId,
    title: `${source.title} (fork)`,
    turnCount: source.turnCount,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    tags: { ...source.tags, forkedFrom: sourceThreadId },
  };

  await store.createThread(meta);

  // Copy items
  const items = await store.getItems(sourceThreadId);
  if (items.length > 0) {
    await store.appendItems(newId, items);
  }

  // Copy turns
  const turns = await store.getTurns(sourceThreadId);
  for (const turn of turns) {
    await store.saveTurn({ ...turn, threadId: newId });
  }

  return meta;
}

// ─── Rollback ───────────────────────────────────────────────────────────────
/** Roll back the last N turns of a thread. Does NOT mutate JSONL — only updates metadata. */
export async function rollbackTurns(
  threadId: ThreadId,
  store: ThreadStore,
  count: number = 1,
): Promise<{ removedTurns: number }> {
  const turns = await store.getTurns(threadId);
  const toRemove = Math.min(count, turns.length);
  const newCount = turns.length - toRemove;

  await store.updateThreadMetadata(threadId, {
    turnCount: newCount,
    updatedAt: new Date().toISOString(),
  });

  return { removedTurns: toRemove };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function generateId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
