import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThreadActivityDot, WorkspaceThreadList } from './WorkspaceThreadList.js';
import type { ThreadMeta } from '../shared/types.js';

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
  it('keeps the search launcher as a full-width sidebar row', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.workspaceThreadsHeader\s*\{[^}]*w-full/s);
    expect(css).toMatch(/\.searchLauncher\s*\{[^}]*w-full/s);
    expect(css).toMatch(/\.searchLauncher span\s*\{[^}]*flex-1/s);
  });

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
      weixinActiveThreadId: 'a',
      dingtalkActiveThreadId: 'a',
      onCreatePlainChat: vi.fn(),
      onCreateInWorkspace: vi.fn(),
      onCreateWorkflowProject: vi.fn(),
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
    expect(html).toContain('weixinThreadBadge');
    expect(html).toContain('remoteThreadBadge');
    expect(html).toContain('远程助手已绑定到此对话');
    expect(html).toContain('微信');
    expect(html).toContain('钉钉');
    expect(html).not.toContain('child');
  });

  it('separates workflow projects from plain and workspace conversations', () => {
    const workflowThread = {
      ...thread('workflow-chat'),
      title: '工作流 A',
      tags: { workflowProject: 'true' },
    };
    const projectThread = { ...thread('project-chat'), title: '项目 A' };
    const plainThread = {
      ...thread('plain-chat', ''),
      title: '普通 A',
      tags: { conversationKind: 'chat' },
    };
    const html = renderToStaticMarkup(React.createElement(WorkspaceThreadList, {
      activeThreadId: 'workflow-chat',
      busy: false,
      currentWorkspaceRoot: 'E:/langchain',
      locale: 'zh',
      rememberedRoots: [],
      runningTurnIds: new Set<string>(),
      searchQuery: '',
      sidebarCollapsed: false,
      threads: [workflowThread, projectThread, plainThread],
      weixinActiveThreadId: '',
      onCreatePlainChat: vi.fn(),
      onCreateInWorkspace: vi.fn(),
      onCreateWorkflowProject: vi.fn(),
      onDeleteThread: vi.fn(),
      onForgetWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onPickWorkspace: vi.fn(),
      onRenameThread: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onSelectThread: vi.fn(),
      onToggleSidebar: vi.fn(),
    }));

    const workflowRows = html.match(/workflowProjectRows[\s\S]*?<\/article>/)?.[0] ?? '';
    const projectIndex = html.indexOf('项目 A');
    const workflowIndex = html.indexOf('工作流 A');

    expect(html).toContain('工作流项目');
    expect(workflowRows).toContain('工作流 A');
    expect(workflowRows).not.toContain('项目 A');
    expect(projectIndex).toBeGreaterThan(-1);
    expect(workflowIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(workflowIndex);
  });
});
