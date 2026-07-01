import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunMonitorDrawer } from './RunMonitorDrawer.js';
import type { RunEvent, RunRecord } from '../shared/types.js';

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

describe('RunMonitorDrawer', () => {
  it('renders a control-oriented monitor drawer without replacing chat or workflow layout', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, {
      locale: 'zh',
      open: true,
      adminMode: false,
      runs: [run],
      events,
      selectedRunId: 'run-1',
      loading: false,
      onClose: vi.fn(),
      onRefresh: vi.fn(),
      onSelectRun: vi.fn(),
      onControlRun: vi.fn(),
    }));

    expect(html).toContain('运行监控');
    expect(html).toContain('tenantA');
    expect(html).toContain('tool.completed');
    expect(html).toContain('current_time');
    expect(html).toContain('中断');
    expect(html).toContain('恢复');
    expect(html).toContain('回退到 checkpoint');
    expect(html).toContain('runMonitorDrawer');
  });

  it('makes admin scope explicit when the drawer is in admin mode', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, {
      locale: 'zh',
      open: true,
      adminMode: true,
      runs: [run],
      events: [],
      selectedRunId: '',
      loading: false,
      onClose: vi.fn(),
      onRefresh: vi.fn(),
      onSelectRun: vi.fn(),
      onControlRun: vi.fn(),
    }));

    expect(html).toContain('管理员全局视图');
    expect(html).toContain('跨租户');
  });
});
