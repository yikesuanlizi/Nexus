import type { RunRecord, ThreadWithRuns } from '../../shared/types.js';
import { formatRelativeTime, runStatusColor, runStatusLabel } from '../../features/monitor/traceFormatters.js';

interface RunExplorerProps {
  threads: ThreadWithRuns[];
  runs: RunRecord[];
  selectedRunId: string;
  expandedThreadId: string;
  loading: boolean;
  threadId: string;
  zh: boolean;
  onSelectRun(runId: string): void;
  onToggleThread(threadId: string): void;
  onRefresh(): void;
}

export function RunExplorer({
  threads,
  runs,
  selectedRunId,
  expandedThreadId,
  loading,
  threadId,
  zh,
  onSelectRun,
  onToggleThread,
  onRefresh,
}: RunExplorerProps) {
  const runsByThread = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const arr = runsByThread.get(run.threadId) ?? [];
    arr.push(run);
    runsByThread.set(run.threadId, arr);
  }

  const groupedByThread = threadId ? threads.length > 0 : true;
  const showEmpty = runs.length === 0 && threads.length === 0;

  return (
    <div className="runExplorer">
      <div className="runExplorer__header">
        <h3 className="runExplorer__title">{zh ? '最近运行' : 'Recent Runs'}</h3>
        <button
          type="button"
          className="runExplorer__refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label={zh ? '刷新' : 'Refresh'}
          title={zh ? '刷新' : 'Refresh'}
        >
          {loading ? '⟳' : '↻'}
        </button>
      </div>
      <div className="runExplorer__body">
        {showEmpty ? (
          <div className="runExplorer__empty">
            <p>{zh ? '暂无运行记录' : 'No runs yet'}</p>
            <p className="runExplorer__emptyHint">
              {zh ? '启动一次对话后会在这里显示' : 'Start a conversation to see runs here'}
            </p>
          </div>
        ) : groupedByThread ? (
          <div className="runExplorer__threads">
            {threads.map((thread) => {
              const threadRuns = runsByThread.get(thread.threadId) ?? [];
              const isExpanded = expandedThreadId === thread.threadId;
              return (
                <div key={thread.threadId} className="runThreadGroup">
                  <button
                    type="button"
                    className="runThreadGroup__header"
                    onClick={() => onToggleThread(thread.threadId)}
                    aria-expanded={isExpanded}
                  >
                    <span className="runThreadGroup__caret">{isExpanded ? '▼' : '▶'}</span>
                    <span className="runThreadGroup__title" title={thread.title}>
                      {thread.title || (zh ? '未命名对话' : 'Untitled')}
                    </span>
                    <span className="runThreadGroup__count">{threadRuns.length}</span>
                  </button>
                  {isExpanded && threadRuns.length > 0 && (
                    <div className="runThreadGroup__runs">
                      {threadRuns.map((run) => (
                        <RunEntry
                          key={run.runId}
                          run={run}
                          selected={run.runId === selectedRunId}
                          zh={zh}
                          onSelect={() => onSelectRun(run.runId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="runExplorer__flat">
            {runs.map((run) => (
              <RunEntry
                key={run.runId}
                run={run}
                selected={run.runId === selectedRunId}
                zh={zh}
                onSelect={() => onSelectRun(run.runId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunEntry({
  run,
  selected,
  zh,
  onSelect,
}: {
  run: RunRecord;
  selected: boolean;
  zh: boolean;
  onSelect(): void;
}) {
  const statusColor = runStatusColor(run.status);
  return (
    <button
      type="button"
      className={`runEntry ${selected ? 'runEntry--selected' : ''}`}
      onClick={onSelect}
      aria-selected={selected}
    >
      <span className="runEntry__status" style={{ backgroundColor: statusColor }} title={runStatusLabel(run.status, zh)} />
      <div className="runEntry__content">
        <div className="runEntry__title">{run.title || run.runId.slice(0, 12)}</div>
        <div className="runEntry__meta">
          <span className="runEntry__kind">{run.kind}</span>
          {run.activeStep && <span className="runEntry__step">{run.activeStep}</span>}
        </div>
        <div className="runEntry__time">{formatRelativeTime(run.updatedAt || run.startedAt, zh)}</div>
      </div>
    </button>
  );
}
