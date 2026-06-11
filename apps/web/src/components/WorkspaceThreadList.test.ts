import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThreadActivityDot, WorkspaceThreadList } from './WorkspaceThreadList.js';
import type { ThreadMeta } from '../types.js';

function thread(threadId: string, workspaceRoot = 'E:/langchain'): ThreadMeta {
  return {
    threadId,
    title: threadId,
    workspaceRoot,
    status: 'idle',
    turnCount: 1,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  };
}

describe('ThreadActivityDot', () => {
  it('renders running and unread dots but not idle state', () => {
    expect(renderToStaticMarkup(React.createElement(ThreadActivityDot, { state: 'idle' }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(ThreadActivityDot, { state: 'running' }))).toContain('threadActivityDot running');
    expect(renderToStaticMarkup(React.createElement(ThreadActivityDot, { state: 'unread' }))).toContain('threadActivityDot unread');
  });
});

describe('WorkspaceThreadList', () => {
  it('renders workspace group actions and compact thread rows without child threads', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceThreadList, {
      activeThreadId: 'a',
      busy: false,
      currentWorkspaceRoot: 'E:/langchain',
      locale: 'zh',
      rememberedRoots: ['D:/empty'],
      runningTurnIds: new Set<string>(),
      searchQuery: '',
      sidebarCollapsed: false,
      threads: [thread('a'), { ...thread('child'), parentThreadId: 'a' }],
      onCreatePlainChat: vi.fn(),
      onCreateInWorkspace: vi.fn(),
      onDeleteThread: vi.fn(),
      onForgetWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onPickWorkspace: vi.fn(),
      onRenameThread: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onSelectThread: vi.fn(),
      onToggleSidebar: vi.fn(),
    }));

    expect(html).toContain('workspaceGroup');
    expect(html).toContain('对话');
    expect(html).toContain('langchain');
    expect(html).toContain('workspaceThreadRow active');
    expect(html).not.toContain('child');
  });
});
