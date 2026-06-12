import React, { useEffect, useRef, useState } from 'react';
import type { Locale } from '../config.js';
import { t } from '../i18n.js';
import { runProfileDescription } from '../runProfiles.js';
import type { SkillDraft } from '../types.js';
import { Icon } from './Icon.js';

export type AppDialogState =
  | {
      kind: 'decision';
      title: string;
      message?: string;
      actionLabel: string;
      cancelLabel: string;
      tone?: 'danger' | 'default';
      resolve: (value: boolean) => void;
    }
  | {
      kind: 'text';
      title: string;
      message?: string;
      value: string;
      actionLabel: string;
      cancelLabel: string;
      resolve: (value: string | null) => void;
    };

export function AppDialog({ dialog, onClose }: { dialog: AppDialogState; onClose(): void }) {
  const [value, setValue] = useState(dialog.kind === 'text' ? dialog.value : '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (dialog.kind === 'text') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [dialog.kind]);

  function cancel() {
    if (dialog.kind === 'decision') {
      dialog.resolve(false);
    } else {
      dialog.resolve(null);
    }
    onClose();
  }

  function submit() {
    if (dialog.kind === 'decision') {
      dialog.resolve(true);
    } else {
      dialog.resolve(value);
    }
    onClose();
  }

  return (
    <div className="dialogLayer" role="presentation" onMouseDown={cancel}>
      <section
        className="appDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <h2 id="app-dialog-title">{dialog.title}</h2>
        </header>
        {dialog.message ? <p className="dialogMessage">{dialog.message}</p> : null}
        {dialog.kind === 'text' ? (
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
          />
        ) : null}
        <div className="dialogActions">
          <button className="textButton" onClick={cancel}>
            {dialog.cancelLabel}
          </button>
          <button className={dialog.kind === 'decision' && dialog.tone === 'danger' ? 'solidButton danger' : 'solidButton'} onClick={submit}>
            {dialog.actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function SettingsHelpDialog({ locale, onClose }: { locale: Locale; onClose(): void }) {
  const zh = locale === 'zh';
  const sections = [
    {
      title: zh ? '缓存优先' : 'Cache first',
      body: runProfileDescription('cache_first', locale),
    },
    {
      title: zh ? '长运行' : 'Long-running',
      body: runProfileDescription('runtime_os', locale),
    },
    {
      title: zh ? '思考程度' : 'Reasoning effort',
      body: zh
        ? '快速适合简单问答；均衡适合日常编码；深度适合复杂设计、排查和长链路推理，会消耗更多输出 token。'
        : 'Fast is for simple turns, Balanced is for everyday coding, and Deep is for complex design/debugging with higher token use.',
    },
    {
      title: zh ? '权限模式' : 'Permission mode',
      body: zh
        ? '只读禁止写入；默认允许工作区内读写并按策略审批；自主权限更宽，适合你明确要让 Agent 连续执行的场景。'
        : 'Read-only blocks writes, Default allows workspace changes with policy checks, and Autonomous is broader for explicit hands-off runs.',
    },
    {
      title: zh ? '联网搜索' : 'Web search',
      body: zh
        ? '自动模式只在问题明显需要最新或外部信息时提示使用搜索；开启会一直提供搜索工具；关闭会完全隐藏搜索工具。'
        : 'Auto recommends search only for current/external information, On always exposes it, and Off hides it completely.',
    },
    {
      title: zh ? '上下文压缩' : 'Context compaction',
      body: zh
        ? '压缩会把旧轮次写成可追踪摘要，释放上下文窗口。缓存优先会更晚压缩；长运行会更主动压缩以保证恢复和多 Agent 稳定。'
        : 'Compaction rewrites older turns into a traceable summary. Cache first delays it; Long-running uses it earlier for recovery and multi-agent stability.',
    },
  ];

  return (
    <div className="dialogLayer settingsHelpLayer" role="presentation" onMouseDown={onClose}>
      <section className="appDialog settingsHelpDialog" role="dialog" aria-modal="true" aria-labelledby="settings-help-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="dialogHeader">
          <h2 id="settings-help-title">{zh ? '设置说明' : 'Settings guide'}</h2>
          <button className="iconButton" onClick={onClose} title={zh ? '关闭' : 'Close'} aria-label={zh ? '关闭' : 'Close'}><Icon name="x" /></button>
        </header>
        <div className="settingsHelpGrid">
          {sections.map((section) => (
            <article key={section.title}>
              <strong>{section.title}</strong>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function SkillDraftDialog({
  draft,
  locale,
  onCancel,
  onSave,
}: {
  draft: SkillDraft;
  locale: Locale;
  onCancel(): void;
  onSave(draft: SkillDraft): Promise<void>;
}) {
  const [current, setCurrent] = useState(draft);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onSave(current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialogLayer" role="presentation" onMouseDown={onCancel}>
      <section
        className="appDialog skillDraftDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-draft-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <h2 id="skill-draft-title">{locale === 'zh' ? '确认 Skill' : 'Confirm Skill'}</h2>
          <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={onCancel}>
            <Icon name="x" />
          </button>
        </header>
        {draft.source === 'template' && draft.error ? (
          <p className="dialogMessage">
            {locale === 'zh' ? '模型草稿生成失败，已先给出模板草稿：' : 'Model drafting failed, using a template draft: '}
            {draft.error}
          </p>
        ) : null}
        <div className="mcpPanelForm">
          <label>
            {t(locale, 'name')}
            <input value={current.name} onChange={(event) => setCurrent({ ...current, name: event.target.value })} />
          </label>
          <label>
            {t(locale, 'description')}
            <input value={current.description} onChange={(event) => setCurrent({ ...current, description: event.target.value })} />
          </label>
          <label>
            SKILL.md
            <textarea value={current.body} onChange={(event) => setCurrent({ ...current, body: event.target.value })} />
          </label>
        </div>
        <div className="dialogActions">
          <button className="textButton" onClick={onCancel} disabled={saving}>{t(locale, 'cancel')}</button>
          <button className="solidButton" onClick={() => void submit()} disabled={saving || !current.name.trim() || !current.body.trim()}>
            {t(locale, 'save')}
          </button>
        </div>
      </section>
    </div>
  );
}
