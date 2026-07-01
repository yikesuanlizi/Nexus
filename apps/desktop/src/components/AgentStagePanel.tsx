import type { CSSProperties } from 'react';
import type { Locale } from '../config/config.js';
import { formatTimestamp } from '../shared/i18n.js';
import type { AgentStageRow } from '../shared/types.js';

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
  const gridRows = childRows;
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
      <article className={['agentStageAvatarCard', mainRow.tone].join(' ')}>
        <div className="agentStageHeroAvatar" aria-hidden="true">
          <RobotMoodIcon variant="main" />
        </div>
        <div className="agentStageAvatarInfo">
          <strong>
            {mainAgentTitle(locale)}
            <span className="agentStageVerified" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M9 12.5 11.2 15 16 9.5" /><path d="m12 2 2.2 2.1 3-.4 1.1 2.8 2.7 1.4-.9 2.9.9 2.9-2.7 1.4-1.1 2.8-3-.4L12 22l-2.2-2.1-3 .4-1.1-2.8L3 16.1l.9-2.9L3 10.3l2.7-1.4 1.1-2.8 3 .4L12 2Z" /></svg>
            </span>
          </strong>
          <span className="agentStageStatusLine"><em />{mainAgentStatusText(mainRow, locale)}</span>
          <p>{mainRow.latestAction}</p>
        </div>
      </article>
      {childRows.length > 0 ? (
        <div className="agentStageStats" aria-hidden="true">
          <span>{locale === 'zh' ? '运行' : 'Run'} <strong>{runningCount}</strong></span>
          <span>{locale === 'zh' ? '完成' : 'Done'} <strong>{doneCount}</strong></span>
          <span>{locale === 'zh' ? '注意' : 'Watch'} <strong>{issueCount}</strong></span>
        </div>
      ) : null}
      {gridRows.length > 0 ? (
        <div className="agentStageGrid childAgentTree">
          {gridRows.map((row) => (
          <article
            className={['agentStageCard', row.kind, row.tone, childRows.length === 0 ? 'solo' : ''].join(' ')}
            key={row.threadId}
            style={{ '--agent-depth': row.depth } as CSSProperties}
          >
            <div className="agentCardTop">
              <div className="agentAvatar" aria-hidden="true">
                <RobotMoodIcon variant={moodVariantForTone(row.tone)} />
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
      ) : null}
      {childRows.length === 0 ? (
        <p className="agentStageHint">
          {locale === 'zh' ? '复杂任务触发多 Agent 后，会在这里显示子 Agent 状态。' : 'Child agent status appears here when a task spawns collaborators.'}
        </p>
      ) : null}
    </section>
  );
}

export type RobotMoodVariant = 'main' | 'idle' | 'working' | 'thinking' | 'done' | 'sleep';

function moodVariantForTone(tone: AgentStageRow['tone']): RobotMoodVariant {
  if (tone === 'running') return 'working';
  if (tone === 'success') return 'done';
  if (tone === 'warning' || tone === 'danger') return 'thinking';
  if (tone === 'muted') return 'sleep';
  return 'idle';
}

function mainAgentTitle(locale: Locale): string {
  return locale === 'zh' ? 'Nexus 主控 Agent' : 'Nexus Primary Agent';
}

function mainAgentStatusText(row: AgentStageRow, locale: Locale): string {
  const status = row.statusLabel || (locale === 'zh' ? '待机中' : 'Standby');
  const action = row.latestAction || (locale === 'zh' ? '等待指令' : 'Awaiting command');
  return `${status} · ${action}`;
}

export function RobotMoodIcon({ variant }: { variant: RobotMoodVariant }) {
  if (variant === 'main') {
    return (
      <svg className="robotMoodSvg mainRobotSvg" viewBox="-10 -20 140 140" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1" opacity="0.6">
          <animate attributeName="rx" values="26; 20; 26" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6; 0.3; 0.6" dur="3s" repeatCount="indefinite" />
        </ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,2; 0,-8; 0,2" dur="3s" repeatCount="indefinite" />
          <path d="M60 35 L60 15" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
          <circle cx="60" cy="15" r="7" fill="#fbbf24" stroke="#0f172a" strokeWidth="4">
            <animate attributeName="fill" values="#fbbf24; #fef08a; #fbbf24" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <rect x="25" y="35" width="70" height="60" rx="22" fill="#ffffff" stroke="#0f172a" strokeWidth="5" />
          <rect x="35" y="48" width="50" height="32" rx="10" fill="#0f172a" />
          <ellipse cx="48" cy="64" rx="5" ry="7" fill="#38bdf8">
            <animate attributeName="ry" values="7; 1; 7; 7" keyTimes="0; 0.05; 0.1; 1" dur="4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="72" cy="64" rx="5" ry="7" fill="#38bdf8">
            <animate attributeName="ry" values="7; 1; 7; 7" keyTimes="0; 0.05; 0.1; 1" dur="4s" repeatCount="indefinite" />
          </ellipse>
          <circle cx="42" cy="72" r="3" fill="#f43f5e" opacity="0.6" />
          <circle cx="78" cy="72" r="3" fill="#f43f5e" opacity="0.6" />
          <circle cx="15" cy="65" r="8" fill="#ffffff" stroke="#0f172a" strokeWidth="4">
            <animateTransform attributeName="transform" type="translate" values="0,0; 0,-3; 0,0" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="105" cy="65" r="8" fill="#ffffff" stroke="#0f172a" strokeWidth="4">
            <animateTransform attributeName="transform" type="translate" values="0,0; 0,3; 0,0" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
    );
  }

  if (variant === 'working') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1"><animate attributeName="rx" values="26; 18; 26" dur="0.6s" repeatCount="indefinite" /></ellipse>
        <g><animateTransform attributeName="transform" type="translate" values="0,-5; 0,-15; 0,-5" dur="0.6s" repeatCount="indefinite" />
          <rect x="25" y="35" width="70" height="60" rx="20" fill="#a7f3d0" stroke="#0f172a" strokeWidth="5" />
          <line x1="60" y1="35" x2="60" y2="20" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="60" cy="20" rx="20" ry="5" fill="#34d399" stroke="#0f172a" strokeWidth="3"><animateTransform attributeName="transform" type="rotate" values="0 60 20; 360 60 20" dur="0.2s" repeatCount="indefinite" /></ellipse>
          <rect x="40" y="50" width="40" height="25" rx="8" fill="#0f172a" />
          <g><animateTransform attributeName="transform" type="translate" values="-3,0; 3,0; -3,0" dur="0.8s" repeatCount="indefinite" />
            <circle cx="50" cy="62" r="3" fill="#10b981" /><circle cx="70" cy="62" r="3" fill="#10b981" />
          </g>
        </g>
      </svg>
    );
  }

  if (variant === 'thinking') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1"><animate attributeName="rx" values="26; 18; 26" dur="3s" repeatCount="indefinite" /></ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-5; 0,-10; 0,-5" dur="3s" repeatCount="indefinite" />
          <g><animateTransform attributeName="transform" type="rotate" values="-3 60 60; 3 60 60; -3 60 60" dur="4s" repeatCount="indefinite" additive="sum" />
            <rect x="25" y="40" width="70" height="50" rx="18" fill="white" stroke="#0f172a" strokeWidth="5" />
            <path d="M40 90 L30 105" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
            <circle cx="25" cy="107" r="8" fill="white" stroke="#0f172a" strokeWidth="4" />
            <circle cx="45" cy="65" r="4" fill="#0f172a"><animate attributeName="cy" values="65; 60; 65" dur="2s" repeatCount="indefinite" /></circle>
            <circle cx="75" cy="65" r="4" fill="#0f172a"><animate attributeName="cy" values="65; 60; 65" dur="2s" repeatCount="indefinite" /></circle>
            <g transform="translate(95, 25)"><circle r="8" fill="#fbbf24" stroke="#0f172a" strokeWidth="3"><animate attributeName="r" values="8; 10; 8" dur="1s" repeatCount="indefinite" /></circle></g>
          </g>
        </g>
      </svg>
    );
  }

  if (variant === 'done') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1"><animate attributeName="rx" values="26; 18; 26" dur="1.2s" repeatCount="indefinite" /></ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-5; 0,-13; 0,-7; 0,-13; 0,-5" dur="1.2s" repeatCount="indefinite" additive="sum" />
          <rect x="25" y="35" width="70" height="60" rx="20" fill="#a7f3d0" stroke="#0f172a" strokeWidth="5" />
          <circle cx="45" cy="65" r="4" fill="#f43f5e" opacity="0.4" /><circle cx="75" cy="65" r="4" fill="#f43f5e" opacity="0.4" />
          <path d="M45 70 Q60 85 75 70" stroke="#0f172a" strokeWidth="5" fill="none" strokeLinecap="round" />
          <g transform="translate(100, 20)">
            <path d="M0 -15 L3 -5 L13 -5 L5 2 L8 12 L0 6 L-8 12 L-5 2 L-13 -5 L-3 -5 Z" fill="#fbbf24" stroke="#0f172a" strokeWidth="2">
              <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1; 0.5; 1" dur="1s" repeatCount="indefinite" />
            </path>
          </g>
        </g>
      </svg>
    );
  }

  if (variant === 'sleep') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#e2e8f0"><animate attributeName="rx" values="26; 22; 26" dur="3s" repeatCount="indefinite" /></ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-5; 0,-8; 0,-5" dur="3s" repeatCount="indefinite" />
          <rect x="25" y="45" width="70" height="50" rx="20" fill="#e2e8f0" stroke="#0f172a" strokeWidth="5" />
          <path d="M40 65 L55 65 M75 65 L90 65" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
          <path d="M60 45 L60 25" stroke="#0f172a" strokeWidth="5" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" values="0 60 45; 10 60 45; 0 60 45" dur="3s" repeatCount="indefinite" />
          </path>
          <text x="80" y="40" fontSize="20" fontWeight="bold" fill="#64748b">Z<animate attributeName="opacity" values="0; 1; 0" dur="2s" repeatCount="indefinite" /></text>
        </g>
      </svg>
    );
  }

  return (
    <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
      <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1"><animate attributeName="rx" values="26; 18; 26" dur="3s" repeatCount="indefinite" /></ellipse>
      <g><animateTransform attributeName="transform" type="translate" values="0,2; 0,-8; 0,2" dur="3s" repeatCount="indefinite" />
        <path d="M60 40 L60 18" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
        <circle cx="60" cy="18" r="7" fill="#fbbf24" stroke="#0f172a" strokeWidth="4"><animate attributeName="fill" values="#fbbf24; #fef08a; #fbbf24" dur="1.5s" repeatCount="indefinite" /></circle>
        <rect x="25" y="35" width="70" height="60" rx="24" fill="#ffffff" stroke="#0f172a" strokeWidth="5" />
        <rect x="35" y="50" width="50" height="30" rx="12" fill="#0f172a" />
        <ellipse cx="48" cy="65" rx="5" ry="7" fill="#38bdf8"><animate attributeName="ry" values="7; 1; 7; 7" dur="4s" repeatCount="indefinite" /></ellipse>
        <ellipse cx="72" cy="65" rx="5" ry="7" fill="#38bdf8"><animate attributeName="ry" values="7; 1; 7; 7" dur="4s" repeatCount="indefinite" /></ellipse>
        <circle cx="42" cy="78" r="3" fill="#f43f5e" opacity="0.5" /><circle cx="78" cy="78" r="3" fill="#f43f5e" opacity="0.5" />
      </g>
    </svg>
  );
}
