import type { ThreadChildInfo, ThreadItem } from './types.js';

const activityTypes = new Set([
  'agent_message',
  'tool_call',
  'command_execution',
  'file_change',
  'context_compaction',
  'collab_tool_call',
  'mcp_tool_call',
  'web_search',
  'error',
]);

export function isChildActivityItem(item: ThreadItem): boolean {
  return activityTypes.has(item.type);
}

export function buildChildActivityByThread(children: ThreadChildInfo[]): Record<string, ThreadItem[]> {
  const result: Record<string, ThreadItem[]> = {};
  for (const child of children) {
    const items = (child.items ?? []).filter(isChildActivityItem);
    if (items.length > 0) result[child.thread.threadId] = items;
  }
  return result;
}

export function childActivityForCollabItem(
  item: ThreadItem,
  byThread: Record<string, ThreadItem[]>,
): ThreadItem[] {
  if (item.type !== 'collab_tool_call') return [];
  const target = item.receiverThreadId ?? item.newThreadId;
  return target ? (byThread[target] ?? []) : [];
}
