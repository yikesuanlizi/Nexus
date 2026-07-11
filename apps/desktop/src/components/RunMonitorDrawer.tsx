// 运行监控抽屉：显示运行列表、运行统计、事件详情，以及历史快照回退
// Run monitor drawer: displays run list, run stats, event details, and history snapshots

import { useState } from 'react';
import type { Locale } from '../config/config.js';
import { CheckpointPanel } from './CheckpointPanel.js';
import type { RunEvent, RunRecord, ThreadItem, ThreadWithRuns } from '../shared/types.js';

export function RunMonitorDrawer({
  locale,
  open,
  adminMode,
  runs,
  events,
  selectedRunId,
  threads,
  expandedThreadId,
  expandedEventId,
  adminToken,
  loading,
  autoRefresh,
  autoRefreshInterval,
  checkpoints,
  currentTurnCount,
  onClose,
  onRefresh,
  onSelectRun,
  onControlRun,
  onAdminTokenChange,
  onToggleThread,
  onToggleEvent,
  onAutoRefreshChange,
  onAutoRefreshIntervalChange,
  onRollbackCheckpoint,
}: {
  locale: Locale;
  open: boolean;
  adminMode: boolean;
  runs: RunRecord[];
  events: RunEvent[];
  selectedRunId: string;
  threads: ThreadWithRuns[];
  expandedThreadId: string;
  expandedEventId: string;
  adminToken?: string;
  loading: boolean;
  autoRefresh: boolean;
  autoRefreshInterval: number;
  /** 工程级检查点条目（project_checkpoint 类型） */
  checkpoints: ThreadItem[];
  /** 当前回合数，用于判断最新快照 */
  currentTurnCount: number;
  onClose(): void;
  onRefresh(): void;
  onSelectRun(runId: string): void;
  onControlRun(action: 'interrupt' | 'resume' | 'rollback', run: RunRecord): void;
  onAdminTokenChange?(value: string): void;
  onToggleThread(threadId: string): void;
  onToggleEvent(eventId: string): void;
  onAutoRefreshChange(enabled: boolean): void;
  onAutoRefreshIntervalChange(ms: number): void;
  /** 回退到指定 turnCount 的快照 */
  onRollbackCheckpoint(turnCount: number): void;
}) {
  const [activeTab, setActiveTab] = useState<'monitor' | 'checkpoints'>('monitor');
  if (!open) return null;
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null;
  const visibleEvents = selectedRun ? events.filter((event) => event.runId === selectedRun.runId) : events;
  const episodeEvents = visibleEvents.filter((event) => event.category === 'memory' && event.type.startsWith('episode.'));
  const totalTokens = runs.reduce((sum, run) => sum + run.inputTokens + run.outputTokens + run.reasoningOutputTokens, 0);
  const runningCount = runs.filter((run) => run.status === 'running').length;
  const failedCount = runs.filter((run) => run.status === 'failed' || run.status === 'blocked').length;
  const zh = locale === 'zh';

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return zh ? '刚刚' : 'just now';
      if (diffMins < 60) return `${diffMins}${zh ? '分钟前' : 'm ago'}`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}${zh ? '小时前' : 'h ago'}`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}${zh ? '天前' : 'd ago'}`;
      return d.toLocaleDateString();
    } catch {
      return iso;
    }
  }

  return (
    <aside className="runMonitorDrawer" role="dialog" aria-label={zh ? '运行监控' : 'Run monitor'}>
      <header className="runMonitorHeader">
        <div>
          <strong>{zh ? '运行监控' : 'Run Monitor'}</strong>
          <span>{adminMode ? (zh ? '管理员全局视图 · 跨租户' : 'Admin global view · cross-tenant') : (zh ? '当前租户视图' : 'Tenant view')}</span>
        </div>
        <div className="runMonitorHeaderActions">
          <label className="runMonitorAutoRefresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => onAutoRefreshChange(e.target.checked)}
            />
            <span>{zh ? '自动刷新' : 'Auto refresh'}</span>
          </label>
          {autoRefresh && (
            <select
              className="runMonitorRefreshInterval"
              value={autoRefreshInterval}
              onChange={(e) => onAutoRefreshIntervalChange(Number(e.target.value))}
              aria-label={zh ? '刷新间隔' : 'Refresh interval'}
            >
              <option value={1000}>{zh ? '1秒' : '1s'}</option>
              <option value={2000}>{zh ? '2秒' : '2s'}</option>
              <option value={3000}>{zh ? '3秒' : '3s'}</option>
              <option value={5000}>{zh ? '5秒' : '5s'}</option>
              <option value={10000}>{zh ? '10秒' : '10s'}</option>
            </select>
          )}
          <button type="button" onClick={onRefresh} disabled={loading}>{loading ? (zh ? '刷新中' : 'Refreshing') : (zh ? '刷新' : 'Refresh')}</button>
          <button type="button" onClick={onClose} aria-label={zh ? '关闭运行监控' : 'Close run monitor'}>×</button>
        </div>
      </header>
      <nav className="runMonitorTabs" aria-label={zh ? '面板切换' : 'Panel tabs'}>
        <button
          type="button"
          className={activeTab === 'monitor' ? 'runMonitorTab active' : 'runMonitorTab'}
          onClick={() => setActiveTab('monitor')}
        >
          {zh ? '运行监控' : 'Monitor'}
        </button>
        <button
          type="button"
          className={activeTab === 'checkpoints' ? 'runMonitorTab active' : 'runMonitorTab'}
          onClick={() => setActiveTab('checkpoints')}
        >
          {zh ? '历史快照' : 'Checkpoints'}
        </button>
      </nav>
      {activeTab === 'checkpoints' ? (
        <CheckpointPanel
          items={checkpoints}
          currentTurnCount={currentTurnCount}
          locale={locale}
          onRollback={onRollbackCheckpoint}
        />
      ) : (
        <>
      {/* 运行统计：正在运行 / 阻塞或失败 / Token 总数
         Run stats: running / blocked or failed / total tokens */}

      <section className="runMonitorStats" aria-label={zh ? '运行统计' : 'Run stats'}>
        <Metric label={zh ? '运行中的对话' : 'Running runs'} value={runningCount} />
        <Metric label={zh ? '失败/阻塞的对话' : 'Failed/blocked runs'} value={failedCount} />
        <Metric label="Tokens" value={totalTokens} />
      </section>
      <label className="runMonitorAdminToken">
        <span>{zh ? '管理员 Token' : 'Admin token'}</span>
        <input value={adminToken ?? ''} onChange={(event) => onAdminTokenChange?.(event.target.value)} placeholder={zh ? '留空为当前租户视图' : 'Empty for tenant view'} />
      </label>

      <section className="runMonitorBody">
        <div className="runMonitorRunList" aria-label={zh ? '对话列表' : 'Thread list'}>
          {threads.length === 0 ? (
            <p className="runMonitorEmpty">{zh ? '暂无对话记录' : 'No threads yet'}</p>
          ) : threads.map((thread) => {
            const threadRuns = runs.filter((r) => r.threadId === thread.threadId);
            const isExpanded = expandedThreadId === thread.threadId;
            return (
              <div className="runMonitorThreadGroup" key={thread.threadId}>
                <button
                  type="button"
                  className={`runMonitorThreadHeader ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => onToggleThread(thread.threadId)}
                >
                  <span className="threadCaret">{isExpanded ? '▼' : '▶'}</span>
                  <span className="threadTitle">{thread.title || thread.threadId}</span>
                  <span className="threadMeta">
                    {thread.runCount} {zh ? '次运行' : 'runs'} · {formatTime(thread.lastActiveAt)}
                  </span>
                </button>
                {isExpanded && (
                  <div className="runMonitorThreadRuns">
                    {threadRuns.length === 0 ? (
                      <p className="runMonitorEmpty">{zh ? '暂无运行' : 'No runs'}</p>
                    ) : threadRuns.map((run) => (
                      <button
                        className={`runMonitorRunItem ${run.runId === selectedRun?.runId ? 'active' : ''}`}
                        key={run.runId}
                        type="button"
                        onClick={() => onSelectRun(run.runId)}
                      >
                        <span>{run.title || run.activeStep || run.kind}</span>
                        <small>{run.status} · {formatTime(run.updatedAt)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="runMonitorDetail">
          {selectedRun ? (
            <>
              <div className="runMonitorSelected">
                <div>
                  <strong>{selectedRun.title || selectedRun.runId}</strong>
                  <span>{selectedRun.tenantId} · {selectedRun.threadId}{selectedRun.workflowId ? ` · ${selectedRun.workflowId}` : ''}</span>
                </div>
                <div className="runMonitorControlActions">
                  <button type="button" onClick={() => onControlRun('interrupt', selectedRun)}>{zh ? '中断' : 'Interrupt'}</button>
                  <button type="button" onClick={() => onControlRun('resume', selectedRun)}>{zh ? '恢复' : 'Resume'}</button>
                  <button type="button" onClick={() => onControlRun('rollback', selectedRun)}>{zh ? '回退到 checkpoint' : 'Rollback to checkpoint'}</button>
                </div>
              </div>
              <div className="runMonitorTimeline">
                {visibleEvents.length === 0 ? (
                  <p className="runMonitorEmpty">{zh ? '暂无事件' : 'No events'}</p>
                ) : visibleEvents.map((event) => (
                  <EventCard
                    key={event.eventId}
                    event={event}
                    isExpanded={expandedEventId === event.eventId}
                    onToggle={() => onToggleEvent(event.eventId)}
                    zh={zh}
                  />
                ))}
              </div>
              {episodeEvents.length > 0 ? (
                <section className="runMonitorEpisodeEvents" aria-label={zh ? '情景记忆事件' : 'Episode events'}>
                  <h4>{zh ? '情景记忆事件' : 'Episode events'}</h4>
                  {episodeEvents.map((event) => (
                    <EventCard
                      key={`episode-${event.eventId}`}
                      event={event}
                      isExpanded={expandedEventId === event.eventId}
                      onToggle={() => onToggleEvent(event.eventId)}
                      zh={zh}
                    />
                  ))}
                </section>
              ) : (
                <p className="runMonitorEmpty runMonitorEpisodeEmpty">{zh ? '无情景记忆事件' : 'No episode events'}</p>
              )}
            </>
          ) : (
            <p className="runMonitorEmpty">{zh ? '选择一次运行查看详情' : 'Select a run to inspect details'}</p>
          )}
        </div>
      </section>
        </>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EventCard({
  event,
  isExpanded,
  onToggle,
  zh,
}: {
  event: RunEvent;
  isExpanded: boolean;
  onToggle: () => void;
  zh: boolean;
}) {
  const metadataStr = event.metadata ? JSON.stringify(event.metadata, null, 2) : '';

  const typeLabels: Record<string, string> = {
    'tool.started': zh ? '工具开始调用' : 'Tool started',
    'tool.completed': zh ? '工具调用完成' : 'Tool completed',
    'tool.failed': zh ? '工具调用失败' : 'Tool failed',
    'tool.batch.failed': zh ? '批量工具失败' : 'Batch tool failed',
    'llm.started': zh ? 'LLM 开始生成' : 'LLM started',
    'llm.completed': zh ? 'LLM 生成完成' : 'LLM completed',
    'llm.failed': zh ? 'LLM 生成失败' : 'LLM failed',
    'run.started': zh ? '对话开始' : 'Run started',
    'run.completed': zh ? '对话完成' : 'Run completed',
    'run.failed': zh ? '对话失败' : 'Run failed',
    'run.interrupted': zh ? '对话被中断' : 'Run interrupted',
  };
  const displayType = typeLabels[event.type] ?? event.type;

  return (
    <article className={`runMonitorEvent ${event.level} ${isExpanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="runMonitorEventHeader"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <div>
          <strong>{displayType}</strong>
          <span>
            {event.category}
            {event.workflowNodeId ? ` · ${event.workflowNodeId}` : ''}
            {event.toolName ? ` · ${event.toolName}` : ''}
          </span>
        </div>
        <span className="eventCaret">{isExpanded ? '▼' : '▶'}</span>
      </button>
      <p className="runMonitorEventMessage">{event.message}</p>
      <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
      {isExpanded && (
        <div className="runMonitorEventDetails">
          <div className="eventDetailRow">
            <span className="eventDetailLabel">{zh ? '事件类型' : 'Type'}</span>
            <span className="eventDetailValue">{event.type}</span>
          </div>
          <div className="eventDetailRow">
            <span className="eventDetailLabel">{zh ? '事件分类' : 'Category'}</span>
            <span className="eventDetailValue">{event.category}</span>
          </div>
          <div className="eventDetailRow">
            <span className="eventDetailLabel">{zh ? '事件级别' : 'Level'}</span>
            <span className="eventDetailValue">{event.level}</span>
          </div>
          <div className="eventDetailRow">
            <span className="eventDetailLabel">{zh ? '时间戳' : 'Timestamp'}</span>
            <span className="eventDetailValue">{new Date(event.createdAt).toLocaleString()}</span>
          </div>
          <div className="eventDetailRow">
            <span className="eventDetailLabel">{zh ? '完整消息' : 'Message'}</span>
            <span className="eventDetailValue eventDetailMessage">{event.message}</span>
          </div>
          {event.durationMs != null && (
            <div className="eventDetailRow">
              <span className="eventDetailLabel">{zh ? '持续时间' : 'Duration'}</span>
              <span className="eventDetailValue">{event.durationMs}ms</span>
            </div>
          )}
          {event.toolName && (
            <div className="eventDetailRow">
              <span className="eventDetailLabel">{zh ? '工具名称' : 'Tool'}</span>
              <span className="eventDetailValue">{event.toolName}</span>
            </div>
          )}
          {event.model && (
            <div className="eventDetailRow">
              <span className="eventDetailLabel">{zh ? '模型名称' : 'Model'}</span>
              <span className="eventDetailValue">{event.model}</span>
            </div>
          )}
          {event.workflowNodeId && (
            <div className="eventDetailRow">
              <span className="eventDetailLabel">{zh ? '工作流节点' : 'Workflow Node'}</span>
              <span className="eventDetailValue">{event.workflowNodeId}</span>
            </div>
          )}
          {metadataStr && (
            <div className="eventDetailRow">
              <span className="eventDetailLabel">{zh ? '元数据' : 'Metadata'}</span>
              <pre className="eventDetailMetadata">{metadataStr}</pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
