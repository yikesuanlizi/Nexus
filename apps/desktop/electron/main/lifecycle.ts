// 主进程生命周期服务（迁移计划 Phase 1）：
// - 窗口状态恢复（bounds/maximized 持久化到 userData/window-state.json）
// - 退出流程编排（Phase 0 的 before-quit 回收逻辑迁入）
// — English: main-process lifecycle services (Phase 1):
//   window-state restore (bounds/maximized persisted to userData/window-state.json)
//   and shutdown orchestration (Phase 0 before-quit recycling moves here).
import { app, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface PersistedWindowState {
  bounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
}

const stateFile = (): string => join(app.getPath('userData'), 'window-state.json');

export function loadWindowState(): PersistedWindowState {
  try {
    if (!existsSync(stateFile())) {
      return { bounds: { x: 0, y: 0, width: 1280, height: 820 }, maximized: false };
    }
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as PersistedWindowState;
    if (
      typeof parsed.bounds?.x === 'number'
      && typeof parsed.bounds?.width === 'number'
      && typeof parsed.maximized === 'boolean'
    ) {
      return parsed;
    }
    return { bounds: { x: 0, y: 0, width: 1280, height: 820 }, maximized: false };
  } catch {
    return { bounds: { x: 0, y: 0, width: 1280, height: 820 }, maximized: false };
  }
}

export function persistWindowState(window: BrowserWindow): void {
  try {
    const maximized = window.isMaximized();
    const bounds = window.getNormalBounds();
    writeFileSync(
      stateFile(),
      JSON.stringify({ bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, maximized }),
      'utf8',
    );
  } catch {
    // 尽力而为：无法持久化窗口状态不影响运行
  }
}

export function applyWindowState(window: BrowserWindow, state: PersistedWindowState): void {
  const { bounds, maximized } = state;
  window.setBounds(bounds);
  if (maximized) {
    window.maximize();
  }
}

// 注册退出前清理：回收浏览器 View 与 CDP 连接（无残留进程）。
// — English: register before-quit cleanup — recycle browser views and CDP
//   connections (no residual processes).
export function registerShutdownCleanup(cleanup: () => void): void {
  app.on('before-quit', cleanup);
}
