import React, { useEffect, useState } from 'react';
import { Icon } from './Icon.js';

// 窗口控制（迁移计划 Phase 1）：从 Tauri window.getCurrentWindow 切换到
// Electron preload 的 windowControls typed API；无桌面环境时按钮保持禁用状态。
// — English: window controls (Phase 1) — switched from Tauri's
//   getCurrentWindow to the Electron preload windowControls API; the buttons stay
//   inert without a desktop environment.
interface WindowControlsApi {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  startDragging(): Promise<void>;
  onMaximizedChanged(handler: (maximized: boolean) => void): () => void;
}

function getWindowControls(): WindowControlsApi | undefined {
  const api = (window as unknown as { nexusDesktop?: { windowControls?: WindowControlsApi } }).nexusDesktop?.windowControls;
  return api ?? undefined;
}

export function TitleBar({ title, locale }: { title: string; locale: 'zh' | 'en' }) {
  const [maximized, setMaximized] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const controls = getWindowControls();
    if (!controls) return;
    setAvailable(true);
    controls.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = controls.onMaximizedChanged(setMaximized);
    return () => {
      unlisten();
    };
  }, []);

  const call = (fn: () => Promise<void>): void => {
    const controls = getWindowControls();
    if (!controls) return;
    void fn().catch(() => {});
  };

  return (
    <header className="titleBar" data-testid="titleBar">
      <span className="titleBarTitle">{title}</span>
      <div className="titleBarControls">
        <button
          type="button"
          className="titleBarButton"
          aria-label={locale === 'zh' ? '最小化' : 'Minimize'}
          disabled={!available}
          onClick={() => call(() => getWindowControls()!.minimize())}
        >
          <Icon name="minimize" />
        </button>
        <button
          type="button"
          className="titleBarButton"
          aria-label={locale === 'zh' ? (maximized ? '还原' : '最大化') : maximized ? 'Restore' : 'Maximize'}
          disabled={!available}
          onClick={() => call(() => getWindowControls()!.toggleMaximize())}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} />
        </button>
        <button
          type="button"
          className="titleBarButton titleBarButtonClose"
          aria-label={locale === 'zh' ? '关闭' : 'Close'}
          disabled={!available}
          onClick={() => call(() => getWindowControls()!.close())}
        >
          <Icon name="x" />
        </button>
      </div>
    </header>
  );
}
