import type { RunTraceCategory, RunTraceEnvelope } from '@nexus/protocol';
import type { RunControlCapabilities, RunRecord } from '../../shared/types.js';
import { TraceFilters } from './TraceFilters.js';
import {
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
  runStatusColor,
  runStatusLabel,
  traceCategoryLabel,
  traceIcon,
  traceLifecycleDot,
  traceSummary,
} from '../../features/monitor/traceFormatters.js';

interface TraceTimelineProps {
  traces: RunTraceEnvelope[];
  visibleCount: number;
  totalCount: number;
  categoryFilter: RunTraceCategory[];
  errorsOnly: boolean;
  allCategories: RunTraceCategory[];
  selectedEventId: string;
  selectedRun: RunRecord | null;
  hasMoreBefore: boolean;
  loading: boolean;
  zh: boolean;
  onSelectEvent(eventId: string): void;
  onToggleCategory(category: RunTraceCategory): void;
  onSetErrorsOnly(value: boolean): void;
  onLoadOlder(): void;
  controlCapabilities?: RunControlCapabilities;
  onControlRun(action: 'interrupt' | 'resume' | 'rollback', opts?: { checkpointId?: string }): void;
}

export function TraceTimeline({
  traces,
  visibleCount,
  totalCount,
  categoryFilter,
  errorsOnly,
  allCategories,
  selectedEventId,
  selectedRun,
  hasMoreBefore,
  loading,
  zh,
  onSelectEvent,
  onToggleCategory,
  onSetErrorsOnly,
  onLoadOlder,
  controlCapabilities,
  onControlRun,
}: TraceTimelineProps) {
  return (
    <div className="traceTimeline">
      <div className="traceTimeline__header">
        {selectedRun ? (
          <div className="traceTimeline__runInfo">
            <span className="traceTimeline__runStatus" style={{ backgroundColor: runStatusColor(selectedRun.status) }} />
            <span className="traceTimeline__runTitle">{selectedRun.title || selectedRun.runId.slice(0, 12)}</span>
            <span className="traceTimeline__runStatusLabel">{runStatusLabel(selectedRun.status, zh)}</span>
            <span className="traceTimeline__runTime">{formatRelativeTime(selectedRun.updatedAt || selectedRun.startedAt, zh)}</span>
          </div>
        ) : (
          <div className="traceTimeline__runInfo">
            <span className="traceTimeline__runTitle">{zh ? '选择一个运行' : 'Select a run'}</span>
          </div>
        )}
        {selectedRun && controlCapabilities && (
          <div className="traceTimeline__controls">
            <button
              type="button"
              className="traceControlBtn"
              disabled={!controlCapabilities.interrupt.enabled}
              title={controlCapabilities.interrupt.reason || (zh ? '中断' : 'Interrupt')}
              onClick={() => onControlRun('interrupt')}
            >
              {zh ? '中断' : 'Interrupt'}
            </button>
            <button
              type="button"
              className="traceControlBtn"
              disabled={!controlCapabilities.resume.enabled}
              title={controlCapabilities.resume.reason || (zh ? '恢复' : 'Resume')}
              onClick={() => onControlRun('resume')}
            >
              {zh ? '恢复' : 'Resume'}
            </button>
          </div>
        )}
      </div>
      <TraceFilters
        categories={allCategories}
        selectedCategories={categoryFilter}
        errorsOnly={errorsOnly}
        zh={zh}
        onToggleCategory={onToggleCategory}
        onToggleErrorsOnly={() => onSetErrorsOnly(!errorsOnly)}
      />
      <div className="traceTimeline__body">
        {hasMoreBefore && (
          <button
            type="button"
            className="traceLoadMore"
            onClick={onLoadOlder}
            disabled={loading}
          >
            {loading ? (zh ? '加载中…' : 'Loading…') : (zh ? '加载更早' : 'Load older')}
          </button>
        )}
        {traces.length === 0 ? (
          <div className="traceTimeline__empty">
            {zh ? '暂无 trace 数据' : 'No trace data'}
          </div>
        ) : (
          <div className="traceList">
            {traces.map((trace) => (
              <TraceRow
                key={trace.eventId}
                trace={trace}
                selected={trace.eventId === selectedEventId}
                zh={zh}
                onSelect={() => onSelectEvent(trace.eventId)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="traceTimeline__footer">
        {zh ? `显示 ${visibleCount} 条 / 共 ${totalCount} 条` : `Showing ${visibleCount} / ${totalCount}`}
      </div>
    </div>
  );
}

function TraceRow({
  trace,
  selected,
  zh,
  onSelect,
}: {
  trace: RunTraceEnvelope;
  selected: boolean;
  zh: boolean;
  onSelect(): void;
}) {
  const dot = traceLifecycleDot(trace.lifecycle);
  return (
    <button
      type="button"
      className={`traceRow ${selected ? 'traceRow--selected' : ''}`}
      onClick={onSelect}
      aria-selected={selected}
    >
      <span className="traceRow__icon">{traceIcon(trace.category)}</span>
      <span className="traceRow__category">{traceCategoryLabel(trace.category, zh)}</span>
      <span className="traceRow__lifecycle" style={{ color: dot.color }} title={trace.lifecycle}>{dot.label}</span>
      <div className="traceRow__content">
        <div className="traceRow__name">{trace.name}</div>
        <div className="traceRow__summary">{traceSummary(trace, zh)}</div>
      </div>
      <div className="traceRow__meta">
        {trace.durationMs != null && (
          <span className="traceRow__duration">{formatDuration(trace.durationMs)}</span>
        )}
        <span className="traceRow__time">{formatAbsoluteTime(trace.occurredAt)}</span>
      </div>
    </button>
  );
}
