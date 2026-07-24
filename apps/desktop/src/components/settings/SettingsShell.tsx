// 设置面板 modal 外壳：管理 open/close、Esc 关闭、tab 导航
// P2.4 a11y：role=dialog/aria-modal、焦点进入/回收、Tab 焦点陷阱、aria-live 状态广播
// P3：saveLabel 动态按钮文案、unsavedDot 未保存指示器
import React, { useEffect, useRef } from 'react';
import type { Locale } from '../../config/config.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';

export type SettingsScope = 'global' | 'currentThread' | 'newThread';

export interface SettingsScopeInfo {
  value: SettingsScope;
  onChange: (scope: SettingsScope) => void;
  currentThreadAvailable: boolean;
}

export interface SettingsSaveState {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedToastAt: number | null;
}

export interface SettingsShellProps {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  settingsTabs: Array<{ id: string; label: string }>;
  activeSection: string;
  setActiveSection: (id: string) => void;
  saveState: SettingsSaveState;
  onSave: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
  pluginMode?: boolean;
  busyLayer?: boolean;
  saveLabel?: string;
}

export function SettingsShell({
  locale,
  open,
  settingsTabs,
  activeSection,
  setActiveSection,
  saveState,
  onCancel,
  children,
  pluginMode = false,
  busyLayer = true,
}: SettingsShellProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  function handleCancel() {
    if (saveState.saving) return;
    onCancel();
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (saveState.saving) return;
      handleCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saveState.saving, onCancel]);

  useEffect(() => {
    if (!open) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const rafId = requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      const firstFocusable = drawer.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        drawer.focus();
      }
    });
    return () => {
      cancelAnimationFrame(rafId);
      const trigger = previousActiveElementRef.current;
      previousActiveElementRef.current = null;
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    };
  }, [open]);

  const showSavedToast = saveState.savedToastAt !== null && Date.now() - saveState.savedToastAt < 2000;

  if (!open) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = drawer.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const ariaLiveMessage = saveState.saving
    ? t(locale, 'saving')
    : saveState.error
      ? `${t(locale, 'failedToSave')}: ${saveState.error}`
      : showSavedToast
        ? t(locale, 'saved')
        : '';

  return (
    <div className="settingsLayer" role="presentation">
      <button className="scrim" aria-label={t(locale, 'cancel')} onClick={handleCancel} type="button" />
      <aside
        className="settingsDrawer"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'settings')}
        tabIndex={-1}
        ref={drawerRef}
        onKeyDown={handleKeyDown}
      >
        <header className="settingsHeader">
          <div className="settingsHeaderTitle">
            <h2>{t(locale, 'settings')}</h2>
            {saveState.dirty ? (
              <span
                className="unsavedDot"
                title={t(locale, 'unsavedChangesHint')}
                aria-label={t(locale, 'hasUnsavedChanges')}
                role="status"
              />
            ) : null}
          </div>
          <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={handleCancel} type="button">
            <Icon name="x" />
          </button>
        </header>

        <div className="settingsBody">
          <nav className="settingsNav" aria-label={t(locale, 'settings')}>
            {settingsTabs.map((tab) => (
              <button
                className={activeSection === tab.id ? 'active' : ''}
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className={`settingsContent ${pluginMode ? 'pluginContentMode' : ''}`}>
            <fieldset className="settingsFieldset" disabled={saveState.saving && busyLayer}>
              {children}
            </fieldset>
          </div>
        </div>

      </aside>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {ariaLiveMessage}
      </div>

      {showSavedToast ? (
        <div className="settingsSaveToast" role="status" aria-live="polite">
          {t(locale, 'saved')}
        </div>
      ) : null}
    </div>
  );
}
