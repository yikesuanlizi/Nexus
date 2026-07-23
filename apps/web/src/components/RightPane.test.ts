import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { RightPane } from './RightPane.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('RightPane', () => {
  it('renders workbench tabs (activity/agents/files)', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'activity',
      activeThreadId: 'thread_1',
      activeThreadTitle: 'Test Thread',
      busy: false,
      threadChildren: [],
      runtimeItems: [],
      activeThread: {
        threadId: 'thread_1',
        title: 'Test Thread',
        status: 'idle',
        turnCount: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      locale: 'zh',
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
      onToggleMemoryExcluded: vi.fn(),
    }));

    expect(html).toContain('活动');
    expect(html).toContain('智能体');
    expect(html).toContain('文件');
  });

  it('renders activity tab with idle state when not busy', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'activity',
      activeThreadId: 'thread_1',
      activeThreadTitle: 'Test',
      busy: false,
      threadChildren: [],
      runtimeItems: [],
      activeThread: {
        threadId: 'thread_1',
        title: 'Test',
        status: 'idle',
        turnCount: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      locale: 'zh',
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
    }));

    expect(html).toContain('等待开始');
  });

  it('renders agents tab content', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'agents',
      activeThreadId: 'thread_1',
      activeThreadTitle: 'Test',
      busy: false,
      threadChildren: [],
      runtimeItems: [],
      activeThread: {
        threadId: 'thread_1',
        title: 'Test',
        status: 'idle',
        turnCount: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      locale: 'zh',
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
    }));

    expect(html).toContain('主控 Agent');
    expect(html).toContain('查看主 Agent 详情');
    expect(html).not.toContain('在监控中查看');
    expect(html).not.toContain('深度');
  });

  it('keeps the agent info button meaningful by not rendering inspector until an agent is selected', () => {
    const workbenchSource = readFileSync(join(here, 'workbench', 'WorkspaceWorkbench.tsx'), 'utf-8');
    const agentStageSource = readFileSync(join(here, 'AgentStagePanel.tsx'), 'utf-8');

    expect(workbenchSource).toContain("const mainAgentThreadId = activeThreadId || 'main'");
    expect(workbenchSource).toContain('mainThreadId: mainAgentThreadId');
    expect(workbenchSource).toContain('if (!selectedAgentId) return null');
    expect(workbenchSource).toContain('setSelectedAgentId((current) => current === threadId ? null : threadId)');
    expect(workbenchSource).toContain('{selectedNode ? (');
    expect(agentStageSource).toContain('aria-pressed={selectedThreadId === mainRow.threadId}');
    expect(agentStageSource).toContain('收起主 Agent 详情');
  });

  it('passes item trace jumps through to monitor instead of transcript-only scrolling', () => {
    const mainSource = readFileSync(join(here, '..', 'main.tsx'), 'utf-8');
    const workbenchSource = readFileSync(join(here, 'workbench', 'WorkspaceWorkbench.tsx'), 'utf-8');

    expect(mainSource).toContain('if (itemId && !runId && !eventId && !threadId)');
    expect(workbenchSource).toContain('onJumpToMonitor?.({ itemId: opts.itemId, runId: opts.runId, threadId: activeThreadId })');
  });

  it('does not keep forcing the files tab after the same external preview request was handled', () => {
    const workbenchSource = readFileSync(join(here, 'workbench', 'WorkspaceWorkbench.tsx'), 'utf-8');

    expect(workbenchSource).toContain('handledPreviewRequestKeyRef');
    expect(workbenchSource).toContain('if (handledPreviewRequestKeyRef.current === previewRequestKey) return');
    expect(workbenchSource).not.toContain("}, [externalPreviewRequest, activeTab, onTabChange]);");
  });

  it('wraps each workbench tab body in a motion-aware panel', () => {
    const workbenchSource = readFileSync(join(here, 'workbench', 'WorkspaceWorkbench.tsx'), 'utf-8');
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');

    expect(workbenchSource).toContain('function workbenchPanelClassName');
    expect(workbenchSource).toContain("className={workbenchPanelClassName('activity', activeTab)}");
    expect(workbenchSource).toContain("className={workbenchPanelClassName('agents', activeTab)}");
    expect(workbenchSource).toContain("className={workbenchPanelClassName('files', activeTab)}");
    expect(styles).toContain('.workbenchPanel');
    expect(styles).toContain('@keyframes workbenchPanelIn');
  });
});
