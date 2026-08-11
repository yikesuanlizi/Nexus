// 浏览器 IPC 注册（迁移计划 §7 目标目录 ipc/registerBrowserIpc.ts）。
// 所有 handler 只暴露领域方法；Renderer 永远不接触 webContents.debugger 等原始对象。
// — English: browser IPC registration (§7) — handlers expose domain methods only;
//   the renderer never touches raw objects such as webContents.debugger.
import { ipcMain } from 'electron';
import type { BrowserViewManager } from '../browser/BrowserViewManager.js';
import type { BrowserEngineAdapter } from '../browser/BrowserEngineAdapter.js';
import {
  validateClick,
  validateCreateTab,
  validateEvaluate,
  validateInsertText,
  validateNavigate,
  validateTabBounds,
  validateTabId,
  validateTabVisible,
} from './validateIpc.js';

export interface BrowserIpcDeps {
  manager: BrowserViewManager;
  adapterFor(tabId: string): BrowserEngineAdapter;
}

export function registerBrowserIpc(deps: BrowserIpcDeps): void {
  const { manager } = deps;

  ipcMain.handle('browser:createTab', (_event, input: unknown) => {
    const tab = validateCreateTab(input);
    return manager.createTab(tab);
  });

  ipcMain.handle('browser:setBounds', (_event, input: unknown) => {
    const { tabId, bounds } = validateTabBounds(input);
    manager.setBounds(tabId, bounds);
  });

  ipcMain.handle('browser:setVisible', (_event, input: unknown) => {
    const { tabId, visible } = validateTabVisible(input);
    manager.setVisible(tabId, visible);
  });

  ipcMain.handle('browser:activateTab', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.activateTab(tabId);
  });

  ipcMain.handle('browser:navigate', (_event, input: unknown) => {
    const { tabId, url } = validateNavigate(input);
    manager.navigate(tabId, url);
  });

  ipcMain.handle('browser:back', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    return manager.back(tabId);
  });

  ipcMain.handle('browser:forward', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    return manager.forward(tabId);
  });

  ipcMain.handle('browser:reload', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.reload(tabId);
  });

  ipcMain.handle('browser:stop', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.stop(tabId);
  });

  ipcMain.handle('browser:focus', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.focus(tabId);
  });

  ipcMain.handle('browser:toggleDevTools', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.toggleDevTools(tabId);
  });

  ipcMain.handle('browser:evaluate', async (_event, input: unknown) => {
    const evalInput = validateEvaluate(input);
    return deps.adapterFor(evalInput.tabId).evaluate(evalInput);
  });

  ipcMain.handle('browser:click', async (_event, input: unknown) => {
    const clickInput = validateClick(input);
    await deps.adapterFor(clickInput.tabId).click(clickInput);
  });

  ipcMain.handle('browser:insertText', async (_event, input: unknown) => {
    const { tabId, text } = validateInsertText(input);
    await deps.adapterFor(tabId).insertText(text);
  });

  ipcMain.handle('browser:closeTab', (_event, input: unknown) => {
    const { tabId } = validateTabId(input);
    manager.destroy(tabId);
  });

  ipcMain.handle('browser:closeAll', () => {
    manager.destroyAll();
  });

  ipcMain.handle('browser:listTabs', () => manager.listTabs());
}
