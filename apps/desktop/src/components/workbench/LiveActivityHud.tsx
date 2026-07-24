import { useState } from 'react';
import type { Locale } from '../../config/config.js';
import { formatDuration, formatRelativeTime, runStatusColor, runStatusLabel, traceIcon } from '../../features/monitor/traceFormatters.js';
import type { CurrentPhase, RecentTraceEvent } from '../../features/agents/agentWorkbenchModel.js';
import type { RunControlCapabilities, RunTraceSummary } from '@nexus/protocol';

const PHASE_ICONS: Record<string, string> = {
  model: '🧠',
  tool: '🔧',
  approval: '⚠️',
  file: '📁',
  checkpoint: '📍',
  idle: '💤',
  error: '❌',
};

export function LiveActivityHud({
  traceSummary,
  currentPhase,
  recentEvents,
  controlCapabilities,
  busy,
  onInterrupt,
  onResume,
  onRollback,
  onJumpToTrace,
  locale,
}: {
  traceSummary?: RunTraceSummary | null;
  currentPhase: CurrentPhase;
  recentEvents: RecentTraceEvent[];
  controlCapabilities?: RunControlCapabilities;
  busy: boolean;
  onInterrupt?(): void;
  onResume?(): void;
  onRollback?(checkpointId?: string): void;
  onJumpToTrace?(opts: { itemId: string; runId: string }): void;
  locale: Locale;
}) {
  const zh = locale === 'zh';
  const [errorExpanded, setErrorExpanded] = useState(false);

  const runStatus = traceSummary?.status ?? (busy ? 'running' : 'idle');
  const statusColor = runStatusColor(runStatus);
  const statusLabel = runStatusLabel(runStatus, zh);
  const duration = traceSummary?.durationMs;
  const startedAt = traceSummary?.startedAt;

  const model = traceSummary?.model;
  const tools = traceSummary?.tools;

  const interruptCap = controlCapabilities?.interrupt;
  const resumeCap = controlCapabilities?.resume;
  const rollbackCap = controlCapabilities?.rollback;

  const isColdIdle = !busy
    && runStatus === 'idle'
    && !traceSummary
    && recentEvents.length === 0
    && currentPhase.kind === 'idle'
    && !currentPhase.detail;

  return (
    <div className="liveActivityHud">
      <div className="liveActivityHeader">
        <div className="liveActivityStatus">
          <span className="liveActivityStatusDot" style={{ backgroundColor: statusColor }} />
          <strong>{statusLabel}</strong>
        </div>
        <div className="liveActivityMeta">
          {duration != null ? <span>{formatDuration(duration)}</span> : null}
          {startedAt ? <span>{formatRelativeTime(startedAt, zh)}</span> : null}
        </div>
      </div>

      {isColdIdle ? (
        <div className="liveActivityIdle">
          <p>{zh ? '等待开始…' : 'Waiting to start…'}</p>
          <span>{zh ? '发送消息后，活动将显示在这里' : 'Activity will appear here after you send a message'}</span>
        </div>
      ) : (
        <>
          <div className={`liveActivityPhase phase-${currentPhase.kind}`}>
            <span className="liveActivityPhaseIcon">{PHASE_ICONS[currentPhase.kind] ?? '•'}</span>
            <div className="liveActivityPhaseText">
              <strong>{currentPhase.label}</strong>
              {currentPhase.detail ? <span>{currentPhase.detail}</span> : null}
            </div>
          </div>

          {traceSummary?.lastError ? (
            <div className="liveActivityError">
              <button
                type="button"
                className="liveActivityErrorToggle"
                onClick={() => setErrorExpanded(v => !v)}
                aria-expanded={errorExpanded}
              >
                <span>❌ {traceSummary.lastError.code}</span>
                <span className="liveActivityErrorExpand">{errorExpanded ? '▾' : '▸'}</span>
              </button>
              {errorExpanded ? (
                <div className="liveActivityErrorDetail">
                  {traceSummary.lastError.message}
                </div>
              ) : null}
            </div>
          ) : null}

          {traceSummary?.lastCheckpointId ? (
            <div className="liveActivityCheckpoint">
              <span>📍 {zh ? '检查点' : 'Checkpoint'}</span>
              <code>{traceSummary.lastCheckpointId.slice(0, 16)}</code>
            </div>
          ) : null}

          <div className="liveActivityMetrics">
            {model && model.calls > 0 ? (
              <div className="liveActivityMetricGroup">
                <h4>{zh ? '模型' : 'Model'}</h4>
                <div className="liveActivityMetricGrid">
                  <MetricCell label={zh ? '调用' : 'Calls'} value={model.calls} />
                  <MetricCell label={zh ? '输入' : 'Input'} value={formatCompactNum(model.inputTokens)} />
                  <MetricCell label={zh ? '输出' : 'Output'} value={formatCompactNum(model.outputTokens)} />
                  {model.cacheReadTokens > 0 ? <MetricCell label={zh ? '缓存' : 'Cache'} value={formatCompactNum(model.cacheReadTokens)} /> : null}
                  {model.maxTtftMs != null ? <MetricCell label="TTFT" value={formatDuration(model.maxTtftMs)} /> : null}
                </div>
              </div>
            ) : null}

            {tools && tools.calls > 0 ? (
              <div className="liveActivityMetricGroup">
                <h4>{zh ? '工具' : 'Tools'}</h4>
                <div className="liveActivityMetricGrid">
                  <MetricCell label={zh ? '调用' : 'Calls'} value={tools.calls} />
                  {tools.failed > 0 ? <MetricCell label={zh ? '失败' : 'Failed'} value={tools.failed} danger /> : null}
                  {tools.denied > 0 ? <MetricCell label={zh ? '拒绝' : 'Denied'} value={tools.denied} warning /> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="liveActivityControls">
            {interruptCap ? (
              <button
                type="button"
                className="controlButton controlButtonDanger"
                disabled={!interruptCap.enabled}
                title={interruptCap.reason}
                onClick={onInterrupt}
              >
                {zh ? '中断' : 'Interrupt'}
              </button>
            ) : null}
            {resumeCap ? (
              <button
                type="button"
                className="controlButton"
                disabled={!resumeCap.enabled}
                title={resumeCap.reason}
                onClick={onResume}
              >
                {zh ? '恢复' : 'Resume'}
              </button>
            ) : null}
            {rollbackCap ? (
              <button
                type="button"
                className="controlButton controlButtonWarning"
                disabled={!rollbackCap.enabled}
                title={rollbackCap.reason}
                onClick={() => onRollback?.(rollbackCap.checkpointIds?.[rollbackCap.checkpointIds.length - 1])}
              >
                {zh ? '回滚' : 'Rollback'}
              </button>
            ) : null}
          </div>

          {recentEvents.length > 0 ? (
            <div className="liveActivityRecent">
              <h4>{zh ? '最近事件' : 'Recent events'}</h4>
              <div className="liveActivityEventList">
                {recentEvents.slice(-8).reverse().map(event => (
                  <button
                    key={event.itemId}
                    type="button"
                    className={`liveActivityEvent level-${event.level}`}
                    onClick={() => onJumpToTrace?.({ itemId: event.itemId, runId: event.runId })}
                  >
                    <span className="liveActivityEventIcon">{traceIcon(event.category)}</span>
                    <span className="liveActivityEventText">
                      <span className="liveActivityEventName">
                        <span className="liveActivityEventAgent" title={event.agent.label}>{event.agent.label}</span>
                        {event.resource ? (
                          <span className={`liveActivityEventResource resource-${event.resource.kind.toLowerCase()}`}>
                            <span className="liveActivityEventResourceKind">{event.resource.kind}</span>
                            <span className="liveActivityEventResourceLabel" title={event.resource.label}>{event.resource.label}</span>
                          </span>
                        ) : (
                          <span>{event.name}</span>
                        )}
                      </span>
                      <span className="liveActivityEventTime">{formatRelativeTime(event.occurredAt, zh)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function MetricCell({ label, value, danger, warning }: { label: string; value: string | number; danger?: boolean; warning?: boolean }) {
  return (
    <div className="liveActivityMetric">
      <span className="liveActivityMetricLabel">{label}</span>
      <strong className={danger ? 'liveActivityMetricDanger' : warning ? 'liveActivityMetricWarning' : ''}>{value}</strong>
    </div>
  );
}

function formatCompactNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
