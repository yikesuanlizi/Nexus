import { describe, expect, it } from 'vitest';
import { initialRunMonitorState, runMonitorReducer, type RunMonitorState } from './runMonitorState.js';
import type { RunEvent, RunRecord } from '../../shared/types.js';

function makeRun(runId: string): RunRecord {
  return {
    runId,
    tenantId: 't1',
    threadId: 'th1',
    kind: 'turn',
    status: 'completed',
    caller: 'lead_agent',
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    toolCallCount: 0,
    modelCallCount: 0,
    subagentCount: 0,
    middlewareEventCount: 0,
    startedAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function makeEvent(eventId: string, runId: string): RunEvent {
  return {
    eventId,
    runId,
    tenantId: 't1',
    threadId: 'th1',
    sequence: 0,
    category: 'turn',
    type: 'run.started',
    level: 'info',
    message: 'test',
    createdAt: '2025-01-01T00:00:00Z',
  };
}

describe('runMonitorReducer', () => {
  it('preserves an explicitly selected historical run after refresh', () => {
    let state = initialRunMonitorState;
    state = runMonitorReducer(state, { type: 'refresh.begin', requestId: 1 });
    state = runMonitorReducer(state, {
      type: 'runs.loaded',
      requestId: 1,
      runs: [makeRun('run-old')],
    });
    state = runMonitorReducer(state, { type: 'refresh.done', requestId: 1 });
    state = runMonitorReducer(state, { type: 'select-run', runId: 'run-old' });
    expect(state.selectedRunId).toBe('run-old');

    state = runMonitorReducer(state, { type: 'refresh.begin', requestId: 2 });
    state = runMonitorReducer(state, {
      type: 'runs.loaded',
      requestId: 2,
      runs: [makeRun('run-new'), makeRun('run-old')],
    });

    expect(state.selectedRunId).toBe('run-old');
  });

  it('ignores a stale events response', () => {
    let state: RunMonitorState = {
      ...initialRunMonitorState,
      selectedRunId: 'run-b',
      activeRequestId: 4,
      runs: [makeRun('run-a'), makeRun('run-b')],
    };

    state = runMonitorReducer(state, {
      type: 'events.loaded',
      requestId: 3,
      runId: 'run-a',
      events: [makeEvent('evt-stale', 'run-a')],
    });

    expect(state.events).toEqual([]);
  });

  it('selects first run when selected run no longer exists after refresh', () => {
    let state = initialRunMonitorState;
    state = runMonitorReducer(state, { type: 'refresh.begin', requestId: 1 });
    state = runMonitorReducer(state, {
      type: 'runs.loaded',
      requestId: 1,
      runs: [makeRun('run-1'), makeRun('run-2')],
    });
    state = runMonitorReducer(state, { type: 'select-run', runId: 'run-2' });
    state = runMonitorReducer(state, { type: 'refresh.done', requestId: 1 });
    expect(state.selectedRunId).toBe('run-2');

    state = runMonitorReducer(state, { type: 'refresh.begin', requestId: 2 });
    state = runMonitorReducer(state, {
      type: 'runs.loaded',
      requestId: 2,
      runs: [makeRun('run-3'), makeRun('run-4')],
    });

    expect(state.selectedRunId).toBe('run-3');
    expect(state.events).toEqual([]);
  });

  it('ignores stale runs.loaded response (wrong requestId)', () => {
    let state: RunMonitorState = { ...initialRunMonitorState, activeRequestId: 5, runs: [makeRun('existing')] };
    state = runMonitorReducer(state, {
      type: 'runs.loaded',
      requestId: 3,
      runs: [makeRun('stale')],
    });
    expect(state.runs).toEqual([makeRun('existing')]);
  });

  it('ignores events.loaded for wrong runId even with correct requestId', () => {
    let state: RunMonitorState = {
      ...initialRunMonitorState,
      selectedRunId: 'run-current',
      activeRequestId: 10,
    };
    state = runMonitorReducer(state, {
      type: 'events.loaded',
      requestId: 10,
      runId: 'run-other',
      events: [makeEvent('evt1', 'run-other')],
    });
    expect(state.events).toEqual([]);
  });

  it('applies events.loaded when both requestId and runId match', () => {
    const events = [makeEvent('evt1', 'run-current')];
    let state: RunMonitorState = {
      ...initialRunMonitorState,
      selectedRunId: 'run-current',
      activeRequestId: 10,
    };
    state = runMonitorReducer(state, {
      type: 'events.loaded',
      requestId: 10,
      runId: 'run-current',
      events,
    });
    expect(state.events).toEqual(events);
  });

  it('select-run clears events and updates selectedRunId', () => {
    let state: RunMonitorState = {
      ...initialRunMonitorState,
      selectedRunId: 'run-a',
      events: [makeEvent('evt1', 'run-a')],
    };
    state = runMonitorReducer(state, { type: 'select-run', runId: 'run-b' });
    expect(state.selectedRunId).toBe('run-b');
    expect(state.events).toEqual([]);
  });

  it('toggle-thread toggles expandedThreadId', () => {
    let state = initialRunMonitorState;
    state = runMonitorReducer(state, { type: 'toggle-thread', threadId: 'th1' });
    expect(state.expandedThreadId).toBe('th1');
    state = runMonitorReducer(state, { type: 'toggle-thread', threadId: 'th1' });
    expect(state.expandedThreadId).toBe('');
    state = runMonitorReducer(state, { type: 'toggle-thread', threadId: 'th2' });
    expect(state.expandedThreadId).toBe('th2');
  });

  it('refresh.begin increments activeRequestId and sets loading', () => {
    const state = runMonitorReducer(initialRunMonitorState, { type: 'refresh.begin', requestId: 1 });
    expect(state.activeRequestId).toBe(1);
    expect(state.loading).toBe(true);
  });

  it('refresh.done clears loading only when requestId matches', () => {
    let state = runMonitorReducer(initialRunMonitorState, { type: 'refresh.begin', requestId: 1 });
    expect(state.loading).toBe(true);
    state = runMonitorReducer(state, { type: 'refresh.done', requestId: 99 });
    expect(state.loading).toBe(true);
    state = runMonitorReducer(state, { type: 'refresh.done', requestId: 1 });
    expect(state.loading).toBe(false);
  });
});
