import type { CSSProperties } from 'react';
import type { Locale } from '../config.js';
import { formatTimestamp } from '../i18n.js';
import type { AgentStageRow } from '../types.js';

export function AgentStagePanel({
  locale,
  rows,
}: {
  locale: Locale;
  rows: AgentStageRow[];
}) {
  if (rows.length === 0) return null;
  const mainRow = rows.find((row) => row.kind === 'main') ?? rows[0];
  const childRows = rows.filter((row) => row.kind === 'child');
  const statRows = childRows.length > 0 ? childRows : rows;
  const runningCount = statRows.filter((row) => row.tone === 'running').length;
  const doneCount = statRows.filter((row) => row.tone === 'success').length;
  const issueCount = statRows.filter((row) => row.tone === 'warning' || row.tone === 'danger').length;
  const gridRows = childRows.length > 0 ? childRows : [mainRow];
  return (
    <section className="agentStage" aria-label={locale === 'zh' ? 'Agent 舞台' : 'Agent stage'}>
      <div className="agentStageHeader">
        <div>
          <h2>{locale === 'zh' ? '智能体状态' : 'Agent Status'}</h2>
          <p>{childRows.length > 0
            ? (locale === 'zh' ? '子 Agent 协作状态' : 'Child agent collaboration')
            : (locale === 'zh' ? '当前主 Agent 状态' : 'Current main agent state')}</p>
        </div>
        <span>{childRows.length > 0 ? childRows.length : 1}</span>
      </div>
      {childRows.length > 0 ? (
        <div className="agentStageStats" aria-hidden="true">
          <span>{locale === 'zh' ? '运行' : 'Run'} <strong>{runningCount}</strong></span>
          <span>{locale === 'zh' ? '完成' : 'Done'} <strong>{doneCount}</strong></span>
          <span>{locale === 'zh' ? '注意' : 'Watch'} <strong>{issueCount}</strong></span>
        </div>
      ) : null}
      <div className="agentStageGrid">
        {gridRows.map((row) => (
          <article
            className={['agentStageCard', row.kind, row.tone, childRows.length === 0 ? 'solo' : ''].join(' ')}
            key={row.threadId}
            style={{ '--agent-depth': row.depth } as CSSProperties}
          >
            <div className="agentCardTop">
              <div className="agentAvatar" aria-hidden="true">
                <span />
                <i />
                <b />
              </div>
              <span className={['agentStageBadge', row.tone].join(' ')}>
                {row.statusLabel}
              </span>
            </div>
            <div className="agentStageMain">
              <div className="agentStageTitleLine">
                <strong>{row.title}</strong>
              </div>
              <span className="agentStageRole">{row.role}</span>
              <p>{row.latestAction}</p>
            </div>
            <time>{formatTimestamp(row.updatedAt, locale)}</time>
          </article>
        ))}
      </div>
      {childRows.length === 0 ? (
        <p className="agentStageHint">
          {locale === 'zh' ? '复杂任务触发多 Agent 后，会在这里显示子 Agent 状态。' : 'Child agent status appears here when a task spawns collaborators.'}
        </p>
      ) : null}
    </section>
  );
}
