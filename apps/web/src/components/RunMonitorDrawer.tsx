// 运行监控抽屉：显示运行列表、运行统计、事件详情
// Run monitor drawer: displays run list, run stats, event details

import type { Locale } from '../config/config.js';
import type { RunEvent, RunRecord } from '../shared/types.js';

export function RunMonitorDrawer({
  locale,
  open,
  adminMode,
  runs,
  events,
  selectedRunId,
  adminToken,
  loading,
  onClose,
  onRefresh,
  onSelectRun,
  onControlRun,
  onAdminTokenChange,
}: {
  locale: Locale;
  open: boolean;
  adminMode: boolean;
  runs: RunRecord[];
  events: RunEvent[];
  selectedRunId: string;
  adminToken?: string;
  loading: boolean;
  onClose(): void;
  onRefresh(): void;
  onSelectRun(runId: string): void;
  onControlRun(action: 'interrupt' | 'resume' | 'rollback', run: RunRecord): void;
  onAdminTokenChange?(value: string): void;
}) {
  if (!open) return null;
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null;
  const visibleEvents = selectedRun ? events.filter((event) => event.runId === selectedRun.runId) : events;
  const episodeEvents = visibleEvents.filter((event) => event.category === 'memory' && event.type.startsWith('episode.'));
  const totalTokens = runs.reduce((sum, run) => sum + run.inputTokens + run.outputTokens + run.reasoningOutputTokens, 0);
  const runningCount = runs.filter((run) => run.status === 'running').length;
  const failedCount = runs.filter((run) => run.status === 'failed' || run.status === 'blocked').length;
  const zh = locale === 'zh';

  return (
    <aside className="runMonitorDrawer" role="dialog" aria-label={zh ? '运行监控' : 'Run monitor'}>
      <header className="runMonitorHeader">
        <div>
          <strong>{zh ? '运行监控' : 'Run Monitor'}</strong>
          <span>{adminMode ? (zh ? '管理员全局视图 · 跨租户' : 'Admin global view · cross-tenant') : (zh ? '当前租户视图' : 'Tenant view')}</span>
        </div>
        <div className="runMonitorHeaderActions">
          <button type="button" onClick={onRefresh} disabled={loading}>{loading ? (zh ? '刷新中' : 'Refreshing') : (zh ? '刷新' : 'Refresh')}</button>
          <button type="button" onClick={onClose} aria-label={zh ? '关闭运行监控' : 'Close run monitor'}>×</button>
        </div>
      </header>
      {/* 运行统计：正在运行 / 阻塞或失败 / Token 总数
         Run stats: running / blocked or failed / total tokens */}

      <section className="runMonitorStats" aria-label={zh ? '运行统计' : 'Run stats'}>
        <Metric label={zh ? '运行中' : 'Running'} value={runningCount} />
        <Metric label={zh ? '阻塞/失败' : 'Blocked/failed'} value={failedCount} />
        <Metric label="Tokens" value={totalTokens} />
      </section>
      <label className="runMonitorAdminToken">
        <span>{zh ? '管理员 Token' : 'Admin token'}</span>
        <input value={adminToken ?? ''} onChange={(event) => onAdminTokenChange?.(event.target.value)} placeholder={zh ? '留空为当前租户视图' : 'Empty for tenant view'} />
      </label>

      <section className="runMonitorBody">
        <div className="runMonitorRunList" aria-label={zh ? '运行列表' : 'Run list'}>
          {runs.length === 0 ? (
            <p className="runMonitorEmpty">{zh ? '暂无运行记录' : 'No runs yet'}</p>
          ) : runs.map((run) => (
            <button
              className={run.runId === selectedRun?.runId ? 'active' : ''}
              key={run.runId}
              type="button"
              onClick={() => onSelectRun(run.runId)}
            >
              <span>{run.title || run.threadId}</span>
              <small>{run.tenantId} · {run.status} · {run.workflowNodeId ?? run.activeStep ?? run.kind}</small>
            </button>
          ))}
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
                  <article className={`runMonitorEvent ${event.level}`} key={event.eventId}>
                    <div>
                      <strong>{event.type}</strong>
                      <span>{event.category}{event.workflowNodeId ? ` · ${event.workflowNodeId}` : ''}{event.toolName ? ` · ${event.toolName}` : ''}</span>
                    </div>
                    <p>{event.message}</p>
                    <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                  </article>
                ))}
              </div>
              {episodeEvents.length > 0 ? (
                <section className="runMonitorEpisodeEvents" aria-label={zh ? '情景记忆事件' : 'Episode events'}>
                  <h4>{zh ? '情景记忆事件' : 'Episode events'}</h4>
                  {episodeEvents.map((event) => (
                    <article className={`runMonitorEvent ${event.level}`} key={`episode-${event.eventId}`}>
                      <div>
                        <strong>{event.type}</strong>
                        <span>{event.category}</span>
                      </div>
                      <p>{event.message}</p>
                      <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                    </article>
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
