import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunMonitorDrawer } from './RunMonitorDrawer.js';
import type { TaskRuntimeMonitorState } from '../features/monitor/taskRuntimeMonitor.js';
import type { RunEvent, RunRecord, ThreadWithRuns } from '../shared/types.js';

const run: RunRecord = {
  runId: 'run-1',
  tenantId: 'tenantA',
  threadId: 'thread-1',
  turnId: 'turn-1',
  kind: 'turn',
  status: 'running',
  caller: 'lead_agent',
  activeStep: 'tool',
  inputTokens: 10,
  cachedInputTokens: 2,
  outputTokens: 5,
  reasoningOutputTokens: 0,
  toolCallCount: 1,
  modelCallCount: 1,
  subagentCount: 0,
  middlewareEventCount: 2,
  startedAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:01.000Z',
};

const events: RunEvent[] = [{
  eventId: 'event-1',
  runId: 'run-1',
  tenantId: 'tenantA',
  threadId: 'thread-1',
  turnId: 'turn-1',
  sequence: 1,
  category: 'tool',
  type: 'tool.completed',
  level: 'info',
  message: 'current_time completed',
  toolName: 'current_time',
  metadata: { status: 'completed' },
  createdAt: '2026-06-16T00:00:01.000Z',
}];

const threads: ThreadWithRuns[] = [{
  threadId: 'thread-1',
  title: 'Test Thread',
  tenantId: 'tenantA',
  status: 'active',
  runCount: 1,
  lastActiveAt: '2026-06-16T00:00:01.000Z',
}];

const taskRuntimeState: TaskRuntimeMonitorState = {
  runtime: {
    type: 'task.runtime.updated',
    threadId: 'thread-1',
    turnId: 'turn-1',
    phase: 'tool',
    status: 'running',
    runProfile: 'runtime_os',
    timestamp: '2026-06-16T00:00:00.000Z',
  },
  cognition: null,
  context: null,
  loop: null,
  events: [],
};

describe('RunMonitorDrawer', () => {
  it('includes the current task list and operational thread items in the monitor drawer', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, {
      locale: 'zh',
      open: true,
      adminMode: false,
      runs: [run],
      events,
      selectedRunId: 'run-1',
      threads,
      expandedThreadId: 'thread-1',
      expandedEventId: '',
      autoRefresh: false,
      autoRefreshInterval: 5000,
      loading: false,
      onClose: vi.fn(),
      onRefresh: vi.fn(),
      onSelectRun: vi.fn(),
      onControlRun: vi.fn(),
      onToggleThread: vi.fn(),
      onToggleEvent: vi.fn(),
      onAutoRefreshChange: vi.fn(),
      onAutoRefreshIntervalChange: vi.fn(),
      checkpoints: [],
      currentTurnCount: 0,
      runtimeItems: [
        {
          id: 'user-1',
          type: 'user_message',
          text: '普通用户消息',
          status: 'completed',
          timestamp: '2026-06-16T00:00:00.000Z',
        },
        {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: '确认监控入口', completed: true },
            { text: '展示运行态 item', completed: false },
          ],
          status: 'completed',
          timestamp: '2026-06-16T00:00:00.000Z',
        },
        {
          id: 'tool-1',
          type: 'tool_call',
          toolName: 'read_file',
          status: 'completed',
          timestamp: '2026-06-16T00:00:01.000Z',
        },
        {
          id: 'file-1',
          type: 'file_change',
          status: 'completed',
          changes: [{ path: 'apps/web/src/main.tsx', kind: 'update', addedLines: 2, removedLines: 1, hunks: [] }],
          timestamp: '2026-06-16T00:00:02.000Z',
        },
      ],
      taskRuntimeState,
      onRollbackCheckpoint: vi.fn(),
    }));

    expect(html).toContain('任务列表');
    expect(html).toContain('确认监控入口');
    expect(html).toContain('展示运行态 item');
    expect(html).toContain('执行项');
    expect(html).toContain('read_file · completed');
    expect(html).toContain('apps/web/src/main.tsx');
    expect(html).not.toContain('普通用户消息');
    expect(html).not.toContain('任务运行态');
  });
});
