import React from 'react';
import type { Locale } from '../../config/config.js';
import { t } from '../../shared/i18n.js';

export interface ConfirmPanelProps {
  locale: Locale;
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPanel({
  locale,
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  if (!open) return null;

  return (
    <div className="settingsConfirmLayer" role="presentation">
      <button className="settingsConfirmScrim" aria-label={cancelLabel ?? t(locale, 'cancel')} onClick={onCancel} type="button" />
      <section
        aria-modal="true"
        aria-labelledby="settings-confirm-title"
        className={`settingsConfirmPanel ${tone === 'danger' ? 'danger' : ''}`}
        role="dialog"
      >
        <h3 id="settings-confirm-title">{title}</h3>
        {description ? <p>{description}</p> : null}
        <div className="settingsConfirmActions">
          <button className="textButton" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t(locale, 'cancel')}
          </button>
          <button className={tone === 'danger' ? 'dangerButton' : 'solidButton'} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? t(locale, 'saving') : (confirmLabel ?? t(locale, 'save'))}
          </button>
        </div>
      </section>
    </div>
  );
}
