import type { RunTraceCategory, RunTraceSummary } from '@nexus/protocol';
import type { ThreadChildInfo, ThreadItem } from '../../shared/types.js';

export type AgentNodeStatus = 'idle' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted';

export interface AgentWorkbenchNode {
  threadId: string;
  parentThreadId?: string;
  depth: number;
  role: string;
  status: AgentNodeStatus;
  currentItem?: { type: string; label: string };
  startedAt?: string;
  updatedAt: string;
  elapsedMs?: number;
  toolCalls: number;
  tokens: number;
  error?: string;
  children: AgentWorkbenchNode[];
}

export interface CurrentPhase {
  kind: 'model' | 'tool' | 'approval' | 'file' | 'checkpoint' | 'idle' | 'error';
  label: string;
  detail?: string;
  elapsedMs?: number;
}

export interface RecentTraceEvent {
  itemId: string;
  runId: string;
  category: RunTraceCategory;
  name: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  summary: string;
  occurredAt: string;
  agent: {
    threadId: string;
    label: string;
    depth: number;
  };
  resource?: {
    kind: ResourceUsageEntry['kind'];
    label: string;
  };
}

export interface ResourceUsageEntry {
  kind: 'MCP' | 'Skill' | 'Tool' | 'Shell' | 'File' | 'Document' | 'Agent';
  label: string;
  count: number;
  lastItemId: string;
}

const OPERATIONAL_ITEM_TYPES = new Set([
  'tool_call',
  'collab_tool_call',
  'mcp_tool_call',
  'command_execution',
  'file_change',
  'context_compaction',
  'web_search',
  'todo_list',
]);

const WAITING_ITEM_TYPES = new Set([
  'approval_required',
]);

const FILE_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'project_checkpoint',
]);

function formatItemLabel(item: ThreadItem): string {
  switch (item.type) {
    case 'tool_call':
      return item.toolName || 'Tool call';
    case 'mcp_tool_call':
      return `${item.server || 'mcp'}:${item.tool || 'tool'}`;
    case 'collab_tool_call':
      return item.tool || 'Collab tool';
    case 'command_execution':
      return item.command ? (item.command.length > 40 ? item.command.slice(0, 40) + '…' : item.command) : 'Command';
    case 'file_change': {
      const changes = item.changes ?? [];
      const firstPath = changes[0]?.path;
      const count = changes.length;
      if (firstPath) return count > 1 ? `${firstPath.split(/[/\\]/).pop()} +${count - 1}` : firstPath.split(/[/\\]/).pop() || firstPath;
      return 'File change';
    }
    case 'context_compaction':
      return 'Compaction';
    case 'web_search':
      return 'Web search';
    case 'todo_list':
      return 'Task list';
    default:
      return item.type;
  }
}

function resourceUsageFromItem(item: ThreadItem): Omit<ResourceUsageEntry, 'count' | 'lastItemId'> | null {
  if (item.type === 'mcp_tool_call') {
    return {
      kind: 'MCP',
      label: [item.server || 'mcp', item.tool || item.toolName || 'tool'].join(' / '),
    };
  }
  if (item.type === 'tool_call') {
    if (item.toolName === 'read_document') {
      return {
        kind: 'Document',
        label: documentResourceLabel(item) || item.toolName,
      };
    }
    if (isSkillToolName(item.toolName)) {
      return {
        kind: 'Skill',
        label: readSkillLabel(item) || item.toolName || 'skill',
      };
    }
    return {
      kind: 'Tool',
      label: item.toolName || 'tool',
    };
  }
  if (item.type === 'collab_tool_call') {
    return {
      kind: 'Agent',
      label: item.tool || 'collab_tool',
    };
  }
  if (item.type === 'command_execution') {
    return {
      kind: 'Shell',
      label: truncateText(item.command, 54) || 'shell',
    };
  }
  if (item.type === 'file_change') {
    return {
      kind: 'File',
      label: formatItemLabel(item),
    };
  }
  return null;
}

function isSkillToolName(toolName: string | undefined): boolean {
  return Boolean(toolName && /^(skill|skills)(?:_|$)/i.test(toolName));
}

function readSkillLabel(item: ThreadItem): string {
  const fromArgs = readStringDeep(item.arguments, ['skillName', 'skill', 'name']);
  if (fromArgs) return fromArgs;
  const fromResult = readStringDeep(item.result, ['skillName', 'skill', 'name']);
  if (fromResult) return fromResult;
  const installed = readFirstInstalledSkillName(item.result);
  return installed;
}

function readFirstInstalledSkillName(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const installed = (value as { installed?: unknown }).installed;
  if (!Array.isArray(installed)) return '';
  for (const entry of installed) {
    const name = readStringDeep(entry, ['name', 'skillName']);
    if (name) return name;
  }
  return '';
}

function readStringDeep(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const next = record[key];
    if (typeof next === 'string' && next.trim()) return next.trim();
  }
  return '';
}

function documentResourceLabel(item: ThreadItem): string {
  const result = readRecord(item.result);
  const source = readRecord(result.source);
  const args = readRecord(item.arguments);
  const filePath = readStringDeep(source, ['path', 'relativePath'])
    || readStringDeep(args, ['filePath', 'path']);
  return baseFileName(filePath);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function baseFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function resolveChildStatus(child: ThreadChildInfo, busy: boolean): AgentNodeStatus {
  const stateStatus = child.state.status;
  const edgeStatus = child.edge.status;
  const turnStatus = child.latestTurn?.status;

  if (stateStatus === 'running') return 'running';
  if (stateStatus === 'failed') return 'failed';
  if (stateStatus === 'interrupted') return 'interrupted';
  if (turnStatus === 'running') return 'running';
  if (turnStatus === 'failed') return 'failed';
  if (turnStatus === 'interrupted') return 'interrupted';
  if (edgeStatus === 'closed') return 'completed';
  if (stateStatus === 'completed') return 'completed';
  if (turnStatus === 'completed') return 'completed';
  if (stateStatus === 'stale') return 'interrupted';
  if (busy) return 'queued';
  return 'idle';
}

function childUpdatedAt(child: ThreadChildInfo): string {
  return child.latestTurn?.completedAt
    ?? child.latestTurn?.startedAt
    ?? child.latestCollabItem?.timestamp
    ?? child.edge.updatedAt
    ?? child.thread.updatedAt
    ?? '';
}

function childStartedAt(child: ThreadChildInfo): string | undefined {
  return child.latestTurn?.startedAt ?? child.edge.createdAt;
}

function itemHasError(item: ThreadItem): boolean {
  return item.type === 'error'
    || item.status === 'failed'
    || item.status === 'error'
    || item.exitCode != null && item.exitCode !== 0
    || Boolean(item.error);
}

function latestOperationalItem(items: ThreadItem[]): ThreadItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (OPERATIONAL_ITEM_TYPES.has(item.type) || item.type === 'error' || item.status === 'failed') {
      return item;
    }
  }
  return undefined;
}

function countToolCalls(items: ThreadItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'tool_call' || item.type === 'mcp_tool_call' || item.type === 'collab_tool_call') {
      count++;
    }
  }
  return count;
}

function estimateTokens(items: ThreadItem[]): number {
  let tokens = 0;
  for (const item of items) {
    if (typeof item.tokensBefore === 'number' && typeof item.tokensAfter === 'number') {
      tokens += Math.abs(item.tokensAfter - item.tokensBefore);
    }
  }
  return tokens;
}

function elapsedSince(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, now - t);
}

function buildChildNode(
  child: ThreadChildInfo,
  depth: number,
  childrenByParent: Map<string, ThreadChildInfo[]>,
  threadItemsMap: Map<string, ThreadItem[]>,
  now: number,
): AgentWorkbenchNode {
  const childItems = threadItemsMap.get(child.thread.threadId) ?? child.items ?? [];
  const latest = latestOperationalItem(childItems);
  const hasError = childItems.some(itemHasError) || child.state.status === 'failed';
  const nodeStatus = resolveChildStatus(child, false);
  const updatedAt = childUpdatedAt(child);
  const startedAt = childStartedAt(child);

  const node: AgentWorkbenchNode = {
    threadId: child.thread.threadId,
    parentThreadId: child.edge.parentThreadId || child.thread.parentThreadId || undefined,
    depth,
    role: child.thread.agentRole || child.thread.agentNickname || child.thread.title || 'Sub-agent',
    status: nodeStatus,
    currentItem: latest ? { type: latest.type, label: formatItemLabel(latest) } : undefined,
    startedAt,
    updatedAt,
    elapsedMs: elapsedSince(startedAt, now),
    toolCalls: countToolCalls(childItems),
    tokens: estimateTokens(childItems),
    error: hasError ? (child.latestTurn?.status === 'failed' ? 'Task failed' : undefined) : undefined,
    children: [],
  };

  const nestedChildren = childrenByParent.get(child.thread.threadId) ?? [];
  node.children = nestedChildren.map(nested => buildChildNode(nested, depth + 1, childrenByParent, threadItemsMap, now));
  return node;
}

function deriveCurrentPhase(
  traceSummary: RunTraceSummary | null | undefined,
  runtimeItems: ThreadItem[],
  busy: boolean,
  zh: boolean,
): CurrentPhase {
  if (traceSummary?.lastError) {
    return {
      kind: 'error',
      label: zh ? '错误' : 'Error',
      detail: traceSummary.lastError.message,
    };
  }

  if (traceSummary?.currentSpan) {
    const span = traceSummary.currentSpan;
    if (span.category === 'model') {
      return {
        kind: 'model',
        label: zh ? '模型思考中' : 'Thinking',
        detail: span.name,
      };
    }
    if (span.category === 'tool') {
      return {
        kind: 'tool',
        label: zh ? '调用工具' : 'Using tool',
        detail: span.name,
      };
    }
  }

  for (let i = runtimeItems.length - 1; i >= 0; i--) {
    const item = runtimeItems[i];
    if (WAITING_ITEM_TYPES.has(item.type) || item.status === 'awaiting_approval') {
      return {
        kind: 'approval',
        label: zh ? '等待审批' : 'Awaiting approval',
        detail: item.toolName || item.message || item.type,
      };
    }
    if (FILE_ITEM_TYPES.has(item.type) && item.status !== 'completed' && item.status !== 'failed') {
      return {
        kind: 'file',
        label: zh ? '文件操作' : 'File operation',
        detail: formatItemLabel(item),
      };
    }
    if (item.type === 'project_checkpoint' || item.type === 'workflow_checkpoint') {
      return {
        kind: 'checkpoint',
        label: zh ? '检查点' : 'Checkpoint',
        detail: typeof item.turnCount === 'number' ? (zh ? `回合 ${item.turnCount}` : `Turn ${item.turnCount}`) : undefined,
      };
    }
    if (item.type === 'tool_call' || item.type === 'mcp_tool_call' || item.type === 'collab_tool_call') {
      if (item.status !== 'completed' && item.status !== 'failed') {
        return {
          kind: 'tool',
          label: zh ? '调用工具' : 'Using tool',
          detail: formatItemLabel(item),
        };
      }
    }
    if (item.type === 'error' || item.status === 'failed') {
      return {
        kind: 'error',
        label: zh ? '错误' : 'Error',
        detail: item.error?.message || item.message || formatItemLabel(item),
      };
    }
  }

  if (traceSummary?.lastCheckpointId) {
    return {
      kind: 'checkpoint',
      label: zh ? '已保存检查点' : 'Checkpoint saved',
      detail: traceSummary.lastCheckpointId.slice(0, 12),
    };
  }

  if (busy) {
    return {
      kind: 'idle',
      label: zh ? '准备中…' : 'Preparing…',
    };
  }

  const lastItem = runtimeItems[runtimeItems.length - 1];
  if (lastItem) {
    return phaseFromLastCompletedItem(lastItem, zh);
  }

  return {
    kind: 'idle',
    label: zh ? '空闲' : 'Idle',
  };
}

function phaseFromLastCompletedItem(item: ThreadItem, zh: boolean): CurrentPhase {
  if (item.type === 'error' || item.status === 'failed') {
    return {
      kind: 'error',
      label: zh ? '上次错误' : 'Last error',
      detail: item.error?.message || item.message || formatItemLabel(item),
    };
  }
  if (item.type === 'project_checkpoint' || item.type === 'workflow_checkpoint') {
    return {
      kind: 'checkpoint',
      label: zh ? '上次检查点' : 'Last checkpoint',
      detail: typeof item.turnCount === 'number' ? (zh ? `回合 ${item.turnCount}` : `Turn ${item.turnCount}`) : undefined,
    };
  }
  if (item.type === 'tool_call' || item.type === 'mcp_tool_call' || item.type === 'collab_tool_call' || item.type === 'command_execution' || item.type === 'web_search') {
    return {
      kind: 'tool',
      label: zh ? '上次工具' : 'Last tool',
      detail: formatItemLabel(item),
    };
  }
  if (FILE_ITEM_TYPES.has(item.type)) {
    return {
      kind: 'file',
      label: zh ? '上次文件操作' : 'Last file operation',
      detail: formatItemLabel(item),
    };
  }
  if (item.type === 'agent_message') {
    return {
      kind: 'model',
      label: zh ? '上轮已完成' : 'Last turn completed',
      detail: truncateText(item.text, 80),
    };
  }
  return {
    kind: 'idle',
    label: zh ? '上次状态' : 'Last state',
    detail: formatItemLabel(item),
  };
}

function truncateText(text: string | undefined, limit: number): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

function deriveRecentEvents(
  mainThreadId: string,
  threadChildren: ThreadChildInfo[],
  runtimeItems: ThreadItem[],
  currentRunId: string | undefined,
  zh: boolean,
): RecentTraceEvent[] {
  const events: RecentTraceEvent[] = [];
  const excludedTypes = new Set(['user_message', 'agent_message', 'thinking']);
  const mainAgent = {
    threadId: mainThreadId,
    label: zh ? 'Nexus 主控 Agent' : 'Nexus Primary Agent',
    depth: 0,
  };
  const pushItemEvent = (item: ThreadItem, agent: RecentTraceEvent['agent']) => {
    if (excludedTypes.has(item.type)) return;

    let category: RunTraceCategory = 'item';
    let level: 'debug' | 'info' | 'warning' | 'error' = 'info';

    if (item.type === 'error' || itemHasError(item)) {
      category = 'error';
      level = 'error';
    } else if (item.type === 'tool_call' || item.type === 'mcp_tool_call' || item.type === 'collab_tool_call') {
      category = 'tool';
    } else if (item.type === 'file_change') {
      category = 'file';
    } else if (item.type === 'project_checkpoint' || item.type === 'workflow_checkpoint') {
      category = 'checkpoint';
    } else if (item.type === 'command_execution') {
      category = 'tool';
    } else if (item.type === 'web_search') {
      category = 'tool';
    }
    const resource = resourceUsageFromItem(item);

    events.push({
      itemId: item.id,
      runId: (item as { runId?: string }).runId || currentRunId || '',
      category,
      name: formatRecentEventName(item),
      level,
      summary: formatItemLabel(item),
      occurredAt: item.timestamp || new Date().toISOString(),
      agent,
      resource: resource ? { kind: resource.kind, label: resource.label } : undefined,
    });
  };

  for (const item of runtimeItems) {
    pushItemEvent(item, mainAgent);
  }

  const childDepths = new Map<string, number>();
  for (const child of threadChildren) {
    const parentId = child.edge.parentThreadId || child.thread.parentThreadId || '';
    const parentDepth = parentId === mainThreadId ? 0 : (childDepths.get(parentId) ?? 0);
    childDepths.set(child.thread.threadId, parentDepth + 1);
    for (const item of child.items ?? []) {
      pushItemEvent(item, {
        threadId: child.thread.threadId,
        label: child.thread.agentRole || child.thread.title || (zh ? '子 Agent' : 'Subagent'),
        depth: parentDepth + 1,
      });
    }
  }

  return events
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-10);
}

function formatRecentEventName(item: ThreadItem): string {
  const resource = resourceUsageFromItem(item);
  if (!resource) return formatItemLabel(item);
  return `${resource.kind} · ${resource.label}`;
}

function deriveResourceUsage(runtimeItems: ThreadItem[]): ResourceUsageEntry[] {
  const entries = new Map<string, ResourceUsageEntry>();
  for (const item of runtimeItems) {
    const resource = resourceUsageFromItem(item);
    if (!resource) continue;
    const key = `${resource.kind}\u0000${resource.label}`;
    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastItemId = item.id;
    } else {
      entries.set(key, { ...resource, count: 1, lastItemId: item.id });
    }
  }
  return [...entries.values()];
}

export function buildAgentWorkbench(input: {
  mainThreadId: string;
  threadChildren: ThreadChildInfo[];
  traceSummary?: RunTraceSummary | null;
  runtimeItems: ThreadItem[];
  busy: boolean;
  now?: number;
  zh?: boolean;
  currentRunId?: string;
}): {
  nodes: AgentWorkbenchNode[];
  rootNode: AgentWorkbenchNode | null;
  currentPhase: CurrentPhase;
  recentEvents: RecentTraceEvent[];
  resourceUsage: ResourceUsageEntry[];
} {
  const now = input.now ?? Date.now();
  const zh = input.zh ?? true;
  const { mainThreadId, threadChildren, traceSummary, runtimeItems, busy, currentRunId } = input;

  const childrenByParent = new Map<string, ThreadChildInfo[]>();
  const threadItemsMap = new Map<string, ThreadItem[]>();
  const childIds = new Set(threadChildren.map(c => c.thread.threadId));

  for (const child of threadChildren) {
    const parentId = child.edge.parentThreadId || child.thread.parentThreadId || '';
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(child);
    childrenByParent.set(parentId, siblings);
    if (child.items && child.items.length > 0) {
      threadItemsMap.set(child.thread.threadId, child.items);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => childUpdatedAt(b).localeCompare(childUpdatedAt(a)));
  }

  const mainStatus: AgentNodeStatus = busy
    ? (traceSummary?.status === 'running' ? 'running' : 'running')
    : (traceSummary?.status === 'failed' ? 'failed'
      : traceSummary?.status === 'interrupted' ? 'interrupted'
      : traceSummary?.status === 'completed' ? 'completed'
      : 'idle');

  const latestItem = latestOperationalItem(runtimeItems);
  const mainElapsed = traceSummary?.durationMs
    ?? elapsedSince(traceSummary?.startedAt, now)
    ?? (busy ? elapsedSince(runtimeItems[0]?.timestamp, now) : undefined);

  const rootNode: AgentWorkbenchNode = {
    threadId: mainThreadId,
    depth: 0,
    role: zh ? 'Nexus 主控 Agent' : 'Nexus Primary Agent',
    status: mainStatus,
    currentItem: latestItem ? { type: latestItem.type, label: formatItemLabel(latestItem) } : undefined,
    startedAt: traceSummary?.startedAt ?? runtimeItems[0]?.timestamp,
    updatedAt: runtimeItems[runtimeItems.length - 1]?.timestamp ?? new Date(now).toISOString(),
    elapsedMs: mainElapsed,
    toolCalls: traceSummary?.tools.calls ?? countToolCalls(runtimeItems),
    tokens: (traceSummary?.model.inputTokens ?? 0) + (traceSummary?.model.outputTokens ?? 0) || estimateTokens(runtimeItems),
    error: traceSummary?.lastError?.message,
    children: (childrenByParent.get(mainThreadId) ?? [])
      .filter(c => childIds.has(c.thread.threadId))
      .map(c => buildChildNode(c, 1, childrenByParent, threadItemsMap, now)),
  };

  const nodes = [rootNode];
  const collectNodes = (node: AgentWorkbenchNode) => {
    for (const child of node.children) {
      nodes.push(child);
      collectNodes(child);
    }
  };
  collectNodes(rootNode);

  for (const child of threadChildren) {
    if (!nodes.some(n => n.threadId === child.thread.threadId)) {
      const orphan = buildChildNode(child, 1, childrenByParent, threadItemsMap, now);
      orphan.parentThreadId = mainThreadId;
      rootNode.children.push(orphan);
      nodes.push(orphan);
    }
  }

  const currentPhase = deriveCurrentPhase(traceSummary, runtimeItems, busy, zh);
  const recentEvents = deriveRecentEvents(mainThreadId, threadChildren, runtimeItems, currentRunId, zh);
  const resourceUsage = deriveResourceUsage(runtimeItems);

  return { nodes, rootNode, currentPhase, recentEvents, resourceUsage };
}
