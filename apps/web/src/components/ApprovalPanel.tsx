import React, { useState } from 'react';
import type { PersistentAccessScope, TemporaryAccessScope } from '@nexus/protocol';
import type { Locale } from '../config/config.js';
import type { ApprovalRequest } from '../shared/types.js';
import { ApprovalDiffPreview } from './ApprovalDiffPreview.js';

export interface ApprovalPanelProps {
  locale: Locale;
  approvals: ApprovalRequest[];
  onDecision: (requestId: string, approved: boolean, temporaryScope: TemporaryAccessScope, persistentScope?: PersistentAccessScope) => void | Promise<void>;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function defaultScope(approval: ApprovalRequest): TemporaryAccessScope {
  return approval.temporaryGrantOptions?.[0]?.scope ?? 'tool_call';
}

export function ApprovalPanel({ locale, approvals, onDecision }: ApprovalPanelProps) {
  const [selectedScopes, setSelectedScopes] = useState<Record<string, TemporaryAccessScope>>({});
  const [selectedPersistentScopes, setSelectedPersistentScopes] = useState<Record<string, PersistentAccessScope>>({});
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const handleDecision = async (requestId: string, approved: boolean, temporaryScope: TemporaryAccessScope, persistentScope?: PersistentAccessScope) => {
    if (deciding[requestId]) return;
    setDeciding((current) => ({ ...current, [requestId]: true }));
    try {
      await onDecision(requestId, approved, temporaryScope, persistentScope);
    } finally {
      setDeciding((current) => ({ ...current, [requestId]: false }));
    }
  };
  if (approvals.length === 0) return null;

  return (
    <section className="approvalPanel approvalPanelFloating" aria-label={text(locale, '需要临时授权', 'Temporary approval required')}>
      {approvals.map((approval) => {
        const options = approval.temporaryGrantOptions?.length
          ? approval.temporaryGrantOptions
          : [{ scope: 'tool_call' as const, label: text(locale, '仅本次工具调用', 'This tool call only') }];
        const selectedScope = selectedScopes[approval.requestId] ?? defaultScope(approval);
        const selectedPersistentScope = selectedPersistentScopes[approval.requestId] ?? 'thread';
        const isDeciding = deciding[approval.requestId] === true;

        return (
          <article className="approvalItem approvalItemPanel" key={approval.requestId}>
            <header className="approvalPanelHeader">
              <strong>{text(locale, '授权请求', 'Approval required')}</strong>
              <span>{approval.description}</span>
            </header>
            <p className="approvalScopeHint">
              {text(locale, '临时允许只影响当前运行；永久允许会保存同类操作规则。', 'Temporary approval affects only this run. Persistent approval saves a matching rule.')}
            </p>
            <label className="approvalScopeSelect">
              <span>{text(locale, '生效范围', 'Scope')}</span>
              <select
                value={selectedScope}
                onChange={(event) => setSelectedScopes((current) => ({
                  ...current,
                  [approval.requestId]: event.target.value as TemporaryAccessScope,
                }))}
                disabled={isDeciding}
              >
                {options.map((option) => (
                  <option key={option.scope} value={option.scope}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="approvalScopeSelect">
              <span>{text(locale, '永久允许范围', 'Persistent scope')}</span>
              <select
                value={selectedPersistentScope}
                onChange={(event) => setSelectedPersistentScopes((current) => ({
                  ...current,
                  [approval.requestId]: event.target.value as PersistentAccessScope,
                }))}
                disabled={isDeciding}
              >
                <option value="thread">{text(locale, '当前线程对话', 'This thread')}</option>
                <option value="workspace">{text(locale, '本工作目录', 'This workspace')}</option>
                <option value="global">{text(locale, '全局', 'Global')}</option>
              </select>
            </label>
            {approval.kind === 'file_write' ? (
              <div className="approvalItemDiff">
                <ApprovalDiffPreview payload={approval.payload} locale={locale} />
              </div>
            ) : null}
            <footer className="approvalPanelFooter">
              <button className="whiteButton" type="button" disabled={isDeciding} onClick={() => void handleDecision(approval.requestId, false, selectedScope)}>
                {text(locale, '拒绝', 'Deny')}
              </button>
              <button className="whiteButton" type="button" disabled={isDeciding} onClick={() => void handleDecision(approval.requestId, true, selectedScope)}>
                {text(locale, '临时允许', 'Allow temporarily')}
              </button>
              <button className="solidButton" type="button" disabled={isDeciding} onClick={() => void handleDecision(approval.requestId, true, selectedScope, selectedPersistentScope)}>
                {text(locale, '永久允许类似操作', 'Permanently allow similar')}
              </button>
            </footer>
          </article>
        );
      })}
    </section>
  );
}
