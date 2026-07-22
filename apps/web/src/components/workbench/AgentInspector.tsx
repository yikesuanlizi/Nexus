import type { Locale } from '../../config/config.js';
import { formatDuration, formatRelativeTime } from '../../features/monitor/traceFormatters.js';
import type { AgentWorkbenchNode } from '../../features/agents/agentWorkbenchModel.js';

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

export function AgentInspector({
  node,
  onJumpToMonitor,
  locale,
}: {
  node: AgentWorkbenchNode | null;
  onJumpToMonitor?(threadId: string): void;
  locale: Locale;
}) {
  const zh = locale === 'zh';

  if (!node) {
    return (
      <div className="agentInspector agentInspectorEmpty">
        <p>{zh ? '选择一个 agent 查看详情' : 'Select an agent to view details'}</p>
      </div>
    );
  }

  const statusLabel = STATUS_LABELS[node.status]?.[zh ? 'zh' : 'en'] ?? node.status;
  const statusColor = STATUS_COLORS[node.status] ?? STATUS_COLORS.idle;

  return (
    <div className="agentInspector">
      <div className="agentInspectorHeader">
        <div className="agentInspectorTitle">
          <span className="agentStatusDot" style={{ backgroundColor: statusColor }} aria-hidden="true" />
          <strong>{node.role}</strong>
        </div>
        <span className="agentInspectorStatus" style={{ color: statusColor }}>{statusLabel}</span>
      </div>

      <div className="agentInspectorBody">
        <div className="agentInspectorField">
          <span className="agentInspectorLabel">{zh ? '深度' : 'Depth'}</span>
          <span className="agentInspectorValue">{node.depth}</span>
        </div>
        {node.parentThreadId ? (
          <div className="agentInspectorField">
            <span className="agentInspectorLabel">{zh ? '父线程' : 'Parent'}</span>
            <span className="agentInspectorValue agentInspectorMono">{node.parentThreadId.slice(0, 8)}</span>
          </div>
        ) : null}
        <div className="agentInspectorField">
          <span className="agentInspectorLabel">{zh ? '子 Agent' : 'Children'}</span>
          <span className="agentInspectorValue">{node.children.length}</span>
        </div>
        {node.startedAt ? (
          <div className="agentInspectorField">
            <span className="agentInspectorLabel">{zh ? '开始时间' : 'Started'}</span>
            <span className="agentInspectorValue">{formatRelativeTime(node.startedAt, zh)}</span>
          </div>
        ) : null}
        <div className="agentInspectorField">
          <span className="agentInspectorLabel">{zh ? '更新时间' : 'Updated'}</span>
          <span className="agentInspectorValue">{formatRelativeTime(node.updatedAt, zh)}</span>
        </div>
        {node.elapsedMs != null ? (
          <div className="agentInspectorField">
            <span className="agentInspectorLabel">{zh ? '运行时长' : 'Elapsed'}</span>
            <span className="agentInspectorValue">{formatDuration(node.elapsedMs)}</span>
          </div>
        ) : null}
        <div className="agentInspectorField">
          <span className="agentInspectorLabel">{zh ? '工具调用' : 'Tool calls'}</span>
          <span className="agentInspectorValue">{node.toolCalls}</span>
        </div>
        {node.tokens > 0 ? (
          <div className="agentInspectorField">
            <span className="agentInspectorLabel">{zh ? 'Token' : 'Tokens'}</span>
            <span className="agentInspectorValue">{node.tokens.toLocaleString()}</span>
          </div>
        ) : null}
        {node.currentItem ? (
          <div className="agentInspectorField">
            <span className="agentInspectorLabel">{zh ? '当前操作' : 'Current'}</span>
            <span className="agentInspectorValue">{node.currentItem.label}</span>
          </div>
        ) : null}
        {node.error ? (
          <div className="agentInspectorField agentInspectorError">
            <span className="agentInspectorLabel">{zh ? '错误' : 'Error'}</span>
            <span className="agentInspectorValue">{node.error}</span>
          </div>
        ) : null}
      </div>

      {onJumpToMonitor ? (
        <button
          type="button"
          className="agentInspectorJumpBtn"
          onClick={() => onJumpToMonitor(node.threadId)}
        >
          {zh ? '在监控中查看' : 'View in monitor'}
        </button>
      ) : null}
    </div>
  );
}
