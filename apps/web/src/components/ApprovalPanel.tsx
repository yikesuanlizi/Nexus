import React, { useState } from 'react';
import type { TemporaryAccessScope } from '@nexus/protocol';
import type { Locale } from '../config/config.js';
import type { ApprovalRequest } from '../shared/types.js';
import { ApprovalDiffPreview } from './ApprovalDiffPreview.js';

export interface ApprovalPanelProps {
  locale: Locale;
  approvals: ApprovalRequest[];
  onDecision: (requestId: string, approved: boolean, temporaryScope: TemporaryAccessScope) => void;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function defaultScope(approval: ApprovalRequest): TemporaryAccessScope {
  return approval.temporaryGrantOptions?.[0]?.scope ?? 'tool_call';
}

export function ApprovalPanel({ locale, approvals, onDecision }: ApprovalPanelProps) {
  const [selectedScopes, setSelectedScopes] = useState<Record<string, TemporaryAccessScope>>({});
  if (approvals.length === 0) return null;

  return (
    <section className="approvalPanel approvalPanelFloating" aria-label={text(locale, '需要临时授权', 'Temporary approval required')}>
      {approvals.map((approval) => {
        const options = approval.temporaryGrantOptions?.length
          ? approval.temporaryGrantOptions
          : [{ scope: 'tool_call' as const, label: text(locale, '仅本次工具调用', 'This tool call only') }];
        const selectedScope = selectedScopes[approval.requestId] ?? defaultScope(approval);

        return (
          <article className="approvalItem approvalItemPanel" key={approval.requestId}>
            <header className="approvalPanelHeader">
              <strong>{text(locale, '临时授权', 'Temporary approval')}</strong>
              <span>{approval.description}</span>
            </header>
            <p className="approvalScopeHint">
              {text(locale, '本面板只影响当前运行；持久允许或禁止请到“设置 → 权限与工作区”。', 'This panel only affects the current run. Persistent allow/deny rules live in Settings → Access & workspace.')}
            </p>
            <label className="approvalScopeSelect">
              <span>{text(locale, '生效范围', 'Scope')}</span>
              <select
                value={selectedScope}
                onChange={(event) => setSelectedScopes((current) => ({
                  ...current,
                  [approval.requestId]: event.target.value as TemporaryAccessScope,
                }))}
              >
                {options.map((option) => (
                  <option key={option.scope} value={option.scope}>{option.label}</option>
                ))}
              </select>
            </label>
            {approval.kind === 'file_write' ? (
              <div className="approvalItemDiff">
                <ApprovalDiffPreview payload={approval.payload} locale={locale} />
              </div>
            ) : null}
            <footer className="approvalPanelFooter">
              <button className="whiteButton" type="button" onClick={() => onDecision(approval.requestId, false, selectedScope)}>
                {text(locale, '拒绝', 'Deny')}
              </button>
              <button className="solidButton" type="button" onClick={() => onDecision(approval.requestId, true, selectedScope)}>
                {text(locale, '允许', 'Allow')}
              </button>
            </footer>
          </article>
        );
      })}
    </section>
  );
}
