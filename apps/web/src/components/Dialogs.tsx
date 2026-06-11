import React, { useEffect, useRef, useState } from 'react';
import type { Locale } from '../config.js';
import { t } from '../i18n.js';
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
