// 设置面板 modal 外壳：管理 open/close、Esc 关闭、tab 导航
// P2.4 a11y：role=dialog/aria-modal、焦点进入/回收、Tab 焦点陷阱、aria-live 状态广播
// v3 预览对齐：topbar 跨栏 + brand mark + 主题切换 + rail-label + nav 图标
import React, { useEffect, useRef } from 'react';
import type { Locale } from '../../config/config.js';
import { t } from '../../shared/i18n.js';
import { Icon, type IconName } from '../Icon.js';

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

// 设置导航 tab → 图标映射，对齐预览的 nav-icon 设计
const SETTINGS_TAB_ICONS: Record<string, IconName> = {
  agent: 'spark',
  accessPolicy: 'shield',
  appearance: 'palette',
  memory: 'database',
  performance: 'activity',
  plugins: 'layers',
  remote: 'send',
  admin: 'shield',
};

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
  visualThemeMode?: 'light' | 'dark';
  onToggleTheme?: () => void;
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
  visualThemeMode = 'light',
  onToggleTheme,
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

  const closeLabel = locale === 'zh' ? '关闭设置' : 'Close settings';
  const themeToggleLabel = visualThemeMode === 'dark'
    ? (locale === 'zh' ? '切换浅色' : 'Switch to light')
    : (locale === 'zh' ? '切换深色' : 'Switch to dark');
  const railLabel = locale === 'zh' ? '配置工作台' : 'Workbench';

  return (
    <div className={`settingsLayer theme-${visualThemeMode}`} role="presentation">
      <button className="scrim" aria-label={t(locale, 'cancel')} onClick={handleCancel} type="button" />
      <aside
        className={`settingsDrawer theme-${visualThemeMode}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'settings')}
        tabIndex={-1}
        ref={drawerRef}
        onKeyDown={handleKeyDown}
      >
        <header className="settingsHeader settingsTopbar">
          <div className="settingsBrand">
            <span className="settingsBrandMark" aria-hidden="true">N</span>
            <strong className="settingsBrandName">Nexus</strong>
            <span className="settingsBrandSub">{t(locale, 'settings')}</span>
            {saveState.dirty ? (
              <span
                className="unsavedDot"
                title={t(locale, 'unsavedChangesHint')}
                aria-label={t(locale, 'hasUnsavedChanges')}
                role="status"
              />
            ) : null}
          </div>
          <div className="settingsTopActions">
            {onToggleTheme ? (
              <button
                className="iconButton settingsThemeToggle"
                title={themeToggleLabel}
                aria-label={themeToggleLabel}
                onClick={onToggleTheme}
                type="button"
              >
                <Icon name={visualThemeMode === 'dark' ? 'sun' : 'moon'} />
              </button>
            ) : null}
            <button
              className="iconButton settingsCloseButton"
              title={closeLabel}
              aria-label={closeLabel}
              onClick={handleCancel}
              type="button"
            >
              <Icon name="x" />
            </button>
          </div>
        </header>

        <div className="settingsBody">
          <aside className="settingsRail">
            <div className="settingsRailLabel">{railLabel}</div>
            <nav className="settingsNav" aria-label={t(locale, 'settings')}>
              {settingsTabs.map((tab) => (
                <button
                  className={activeSection === tab.id ? 'active' : ''}
                  key={tab.id}
                  aria-current={activeSection === tab.id ? 'page' : undefined}
                  onClick={() => setActiveSection(tab.id)}
                  type="button"
                >
                  <span className="settingsNavIcon" aria-hidden="true">
                    <Icon name={SETTINGS_TAB_ICONS[tab.id] ?? 'gear'} />
                  </span>
                  <span className="settingsNavLabel">{tab.label}</span>
                </button>
              ))}
            </nav>
          </aside>

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
