import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunMonitorDrawer } from './RunMonitorDrawer.js';
import type { RunTraceCategory, RunTraceEnvelope } from '@nexus/protocol';
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

const traces: RunTraceEnvelope[] = [{
  version: 2,
  eventId: 'trace-1',
  sequence: 1,
  runId: 'run-1',
  runKind: 'turn',
  threadId: 'thread-1',
  turnId: 'turn-1',
  spanId: 'span:run-1:tool:current_time',
  category: 'tool',
  name: 'tool.completed',
  lifecycle: 'completed',
  level: 'info',
  occurredAt: '2026-06-16T00:00:01.000Z',
  payload: { toolName: 'current_time', callId: 'call-1' },
}];

const threads: ThreadWithRuns[] = [{
  threadId: 'thread-1',
  title: 'Test Thread',
  tenantId: 'tenantA',
  status: 'active',
  runCount: 1,
  lastActiveAt: '2026-06-16T00:00:01.000Z',
}];

const allCategories: RunTraceCategory[] = ['turn', 'iteration', 'context', 'memory', 'middleware', 'model', 'tool', 'item', 'agent', 'file', 'checkpoint', 'evidence', 'error', 'control'];

const baseProps = {
  zh: true,
  open: true,
  adminMode: false,
  adminToken: '',
  threadId: 'thread-1',
  runs: [run],
  events,
  traces,
  visibleTraces: traces,
  selectedRunId: 'run-1',
  selectedRun: run,
  selectedEventId: '',
  selectedTrace: null,
  categoryFilter: [] as RunTraceCategory[],
  errorsOnly: false,
  tracePage: null,
  threads,
  expandedThreadId: 'thread-1',
  autoRefresh: false,
  autoRefreshInterval: 5000,
  loading: false,
  allCategories,
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  onSelectRun: vi.fn(),
  onControlRun: vi.fn(),
  onToggleThread: vi.fn(),
  onSelectEvent: vi.fn(),
  onToggleCategory: vi.fn(),
  onSetErrorsOnly: vi.fn(),
  onAutoRefreshChange: vi.fn(),
  onAutoRefreshIntervalChange: vi.fn(),
  onAdminTokenChange: vi.fn(),
  onLoadOlder: vi.fn(),
};

describe('RunMonitorDrawer', () => {
  it('renders workbench with explorer, timeline, inspector columns', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, baseProps));
    expect(html).toContain('runMonitorWorkbench');
    expect(html).toContain('runExplorer');
    expect(html).toContain('traceTimeline');
  });

  it('returns empty string when closed', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, { ...baseProps, open: false }));
    expect(html).toBe('');
  });

  it('renders trace timeline with trace data', () => {
    const html = renderToStaticMarkup(React.createElement(RunMonitorDrawer, { ...baseProps, selectedEventId: 'trace-1', selectedTrace: traces[0] ?? null }));
    expect(html).toContain('traceRow');
    expect(html).toContain('tool.completed');
  });
});
