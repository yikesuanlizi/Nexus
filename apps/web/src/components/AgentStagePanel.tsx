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
  const runningCount = rows.filter((row) => row.tone === 'running').length;
  const doneCount = rows.filter((row) => row.tone === 'success').length;
  const issueCount = rows.filter((row) => row.tone === 'warning' || row.tone === 'danger').length;
  return (
    <section className="agentStage" aria-label={locale === 'zh' ? 'Agent 舞台' : 'Agent stage'}>
      <div className="agentStageHeader">
        <div>
          <h2>{locale === 'zh' ? '智能体状态' : 'Agent Status'}</h2>
          <p>{locale === 'zh' ? '当前任务协作态势' : 'Live collaboration state'}</p>
        </div>
        <span>{rows.length}</span>
      </div>
      <div className="agentStageStats" aria-hidden="true">
        <span>{locale === 'zh' ? '运行' : 'Run'} <strong>{runningCount}</strong></span>
        <span>{locale === 'zh' ? '完成' : 'Done'} <strong>{doneCount}</strong></span>
        <span>{locale === 'zh' ? '注意' : 'Watch'} <strong>{issueCount}</strong></span>
      </div>
      <div className="agentStageGrid">
        {rows.map((row) => (
          <article
            className={['agentStageCard', row.kind, row.tone].join(' ')}
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
    </section>
  );
}
