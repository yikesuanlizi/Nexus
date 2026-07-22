import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../config/config.js';
import { formatDuration } from '../../features/monitor/traceFormatters.js';
import type { AgentWorkbenchNode } from '../../features/agents/agentWorkbenchModel.js';
import { AgentEmptyState } from './AgentEmptyState.js';

const STATUS_COLORS: Record<string, string> = {
  idle: '#94a3b8',
  queued: '#3b82f6',
  running: '#22c55e',
  waiting: '#f97316',
  completed: '#94a3b8',
  failed: '#ef4444',
  interrupted: '#f97316',
};

const STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  idle: { zh: '空闲', en: 'Idle' },
  queued: { zh: '排队中', en: 'Queued' },
  running: { zh: '运行中', en: 'Running' },
  waiting: { zh: '等待中', en: 'Waiting' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '失败', en: 'Failed' },
  interrupted: { zh: '已中断', en: 'Interrupted' },
};

function flattenNodes(
  nodes: AgentWorkbenchNode[],
  expanded: Set<string>,
): Array<{ node: AgentWorkbenchNode; visible: boolean }> {
  const result: Array<{ node: AgentWorkbenchNode; visible: boolean }> = [];
  const walk = (node: AgentWorkbenchNode, visible: boolean) => {
    result.push({ node, visible });
    if (visible && expanded.has(node.threadId)) {
      for (const child of node.children) walk(child, true);
    } else if (visible) {
      for (const child of node.children) walk(child, false);
    }
  };
  for (const node of nodes) walk(node, true);
  return result;
}

function runningPathNodeIds(rootNode: AgentWorkbenchNode | null): Set<string> {
  const set = new Set<string>();
  if (!rootNode) return set;
  const walk = (node: AgentWorkbenchNode): boolean => {
    if (node.status === 'running' || node.status === 'waiting') {
      set.add(node.threadId);
      for (const child of node.children) {
        if (walk(child)) set.add(node.threadId);
      }
      return true;
    }
    let hasRunningChild = false;
    for (const child of node.children) {
      if (walk(child)) {
        hasRunningChild = true;
        set.add(node.threadId);
      }
    }
    return hasRunningChild;
  };
  walk(rootNode);
  return set;
}

export function AgentTree({
  nodes,
  rootNode,
  selectedThreadId,
  onSelectAgent,
  onJumpToMonitor,
  locale,
}: {
  nodes: AgentWorkbenchNode[];
  rootNode: AgentWorkbenchNode | null;
  selectedThreadId?: string | null;
  onSelectAgent(threadId: string): void;
  onJumpToMonitor?(threadId: string): void;
  locale: Locale;
}) {
  const zh = locale === 'zh';
  const listRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return runningPathNodeIds(rootNode);
  });

  useEffect(() => {
    setExpanded(runningPathNodeIds(rootNode));
  }, [rootNode?.threadId, rootNode?.status]);

  const flat = useMemo(() => flattenNodes(nodes, expanded), [nodes, expanded]);

  const toggleExpand = useCallback((threadId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const visibleItems = flat.filter(f => f.visible);

  const selectedIndex = visibleItems.findIndex(f => f.node.threadId === selectedThreadId);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const currentIdx = selectedIndex >= 0 ? selectedIndex : 0;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(visibleItems.length - 1, currentIdx + 1);
      onSelectAgent(visibleItems[next].node.threadId);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(0, currentIdx - 1);
      onSelectAgent(visibleItems[prev].node.threadId);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const current = visibleItems[currentIdx];
      if (current && current.node.children.length > 0 && !expanded.has(current.node.threadId)) {
        toggleExpand(current.node.threadId);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const current = visibleItems[currentIdx];
      if (current && expanded.has(current.node.threadId)) {
        toggleExpand(current.node.threadId);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const current = visibleItems[currentIdx];
      if (current) onSelectAgent(current.node.threadId);
    }
  }, [selectedIndex, visibleItems, expanded, onSelectAgent, toggleExpand]);

  const hasAnyActivity = rootNode && (rootNode.status !== 'idle' || rootNode.children.length > 0);

  if (!hasAnyActivity) {
    return <AgentEmptyState locale={locale} />;
  }

  return (
    <div className="agentTree" ref={listRef} role="tree" aria-label={zh ? 'Agent 树' : 'Agent tree'} onKeyDown={handleKeyDown} tabIndex={0}>
      {visibleItems.map(({ node }) => {
        const isSelected = selectedThreadId === node.threadId;
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.threadId);
        const statusColor = STATUS_COLORS[node.status] ?? STATUS_COLORS.idle;
        const statusLabel = STATUS_LABELS[node.status]?.[zh ? 'zh' : 'en'] ?? node.status;

        return (
          <div
            key={node.threadId}
            className={`agentTreeNode ${isSelected ? 'selected' : ''}`}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-level={node.depth + 1}
            style={{ paddingLeft: `${12 + node.depth * 16}px` }}
            onClick={() => onSelectAgent(node.threadId)}
          >
            <button
              type="button"
              className="agentTreeExpand"
              onClick={(event) => { event.stopPropagation(); toggleExpand(node.threadId); }}
              aria-label={isExpanded ? (zh ? '折叠' : 'Collapse') : (zh ? '展开' : 'Expand')}
              tabIndex={-1}
            >
              {hasChildren ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}>
                  <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : <span className="agentTreeLeafDot" />}
            </button>
            <span className="agentStatusDot" style={{ backgroundColor: statusColor }} title={statusLabel} aria-label={statusLabel} />
            <span className="agentTreeNodeLabel">
              <span className="agentTreeNodeRole">{node.role}</span>
              {node.currentItem ? <span className="agentTreeNodeAction">{node.currentItem.label}</span> : null}
            </span>
            <span className="agentTreeNodeMeta">
              {node.toolCalls > 0 ? <span className="agentTreeNodeStat" title={zh ? '工具调用' : 'Tool calls'}>{node.toolCalls}🔧</span> : null}
              {node.error ? <span className="agentTreeErrorBadge" title={node.error}>!</span> : null}
              {node.elapsedMs != null ? <span className="agentTreeNodeTime">{formatDuration(node.elapsedMs)}</span> : null}
            </span>
            {onJumpToMonitor ? (
              <button
                type="button"
                className="agentTreeJumpBtn"
                onClick={(event) => { event.stopPropagation(); onJumpToMonitor(node.threadId); }}
                title={zh ? '在监控中查看' : 'View in monitor'}
                tabIndex={-1}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2H10V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M10 2L5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M2 4H8V10H2V4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.5" />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
