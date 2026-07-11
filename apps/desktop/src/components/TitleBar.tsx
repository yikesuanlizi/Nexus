import React, { useEffect, useState } from 'react';
import { Icon } from './Icon.js';

export function TitleBar({ title, locale }: { title: string; locale: 'zh' | 'en' }) {
  const [maximized, setMaximized] = useState(false);

  const getAppWindow = () => {
    const tauri = window.__TAURI__ as typeof window.__TAURI__ & {
      window?: {
        getCurrentWindow?: () => {
          minimize(): Promise<void>;
          toggleMaximize(): Promise<void>;
          close(): Promise<void>;
          isMaximized(): Promise<boolean>;
          startDragging(): Promise<void>;
          onResized?(handler: () => void): Promise<() => void>;
        };
      };
    };
    const factory = tauri?.window?.getCurrentWindow;
    if (!factory) return undefined;
    try {
      return factory();
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    const appWindow = getAppWindow();
    if (!appWindow) return;
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    if (appWindow.onResized) {
      appWindow.onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      }).then((u) => { unlisten = u; }).catch(() => {});
    }
    return () => { unlisten?.(); };
  }, []);

  const minimize = () => { getAppWindow()?.minimize().catch(() => {}); };
  const toggleMaximize = () => { getAppWindow()?.toggleMaximize().catch(() => {}); };
  const close = () => { getAppWindow()?.close().catch(() => {}); };
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    getAppWindow()?.startDragging().catch(() => {});
  };

  const minimizeLabel = locale === 'zh' ? '最小化' : 'Minimize';
  const maximizeLabel = maximized ? (locale === 'zh' ? '还原' : 'Restore') : (locale === 'zh' ? '最大化' : 'Maximize');
  const closeLabel = locale === 'zh' ? '关闭' : 'Close';

  return (
    <div className="h-10 flex items-center justify-between select-none border-b border-[var(--nx-border,#e2e8f0)] bg-[var(--nx-panel,#ffffff)] text-[var(--nx-text,#0f172a)]">
      <div className="flex-1 flex items-center px-4 h-full" data-tauri-drag-region onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
        <span className="w-5 h-5 mr-2.5 flex items-center justify-center text-[var(--nx-blue,#2563eb)]"><Icon name="layers" /></span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="flex items-center h-full gap-1 pr-2">
        <button type="button" className="w-8 h-8 flex items-center justify-center bg-transparent border-0 p-0 text-[var(--nx-text,#0f172a)] opacity-70 hover:opacity-100 transition-opacity shadow-none" title={minimizeLabel} aria-label={minimizeLabel} onClick={minimize}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="w-8 h-8 flex items-center justify-center bg-transparent border-0 p-0 text-[var(--nx-text,#0f172a)] opacity-70 hover:opacity-100 transition-opacity shadow-none" title={maximizeLabel} aria-label={maximizeLabel} onClick={toggleMaximize}>
          {maximized ? (
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect x="2.5" y="4" width="5.5" height="5.5" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
              <rect x="4" y="2.5" width="5.5" height="5.5" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button type="button" className="w-8 h-8 flex items-center justify-center bg-transparent border-0 p-0 text-[var(--nx-text,#0f172a)] opacity-70 hover:opacity-100 hover:text-red-500 transition-opacity shadow-none" title={closeLabel} aria-label={closeLabel} onClick={close}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
