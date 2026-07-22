import type { RunTraceCategory, RunTraceEnvelope, ThreadItem, TurnMeta } from '@nexus/protocol';
import type { RunEvent, RunRecord, ThreadWithRuns } from '../../shared/types.js';

export interface TracePageInfo {
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  nextBefore?: number;
  nextAfter?: number;
}

export interface RunMonitorState {
  runs: RunRecord[];
  events: RunEvent[];
  traces: RunTraceEnvelope[];
  threads: ThreadWithRuns[];
  selectedRunId: string;
  expandedThreadId: string;
  activeRequestId: number;
  loading: boolean;
  items: ThreadItem[];
  selectedItemId: string;
  inspectorItem: ThreadItem | null;
  itemFilter: string;
  turns: TurnMeta[];
  turnFilter: string;
  selectedEventId: string;
  categoryFilter: RunTraceCategory[];
  errorsOnly: boolean;
  tracePage: TracePageInfo | null;
}

export const initialRunMonitorState: RunMonitorState = {
  runs: [],
  events: [],
  traces: [],
  threads: [],
  selectedRunId: '',
  expandedThreadId: '',
  activeRequestId: 0,
  loading: false,
  items: [],
  selectedItemId: '',
  inspectorItem: null,
  itemFilter: '',
  turns: [],
  turnFilter: '',
  selectedEventId: '',
  categoryFilter: [],
  errorsOnly: false,
  tracePage: null,
};

export type RunMonitorAction =
  | { type: 'refresh.begin'; requestId: number }
  | { type: 'refresh.begin-silent'; requestId: number }
  | { type: 'threads.loaded'; requestId: number; threads: ThreadWithRuns[] }
  | { type: 'runs.loaded'; requestId: number; runs: RunRecord[] }
  | { type: 'events.loaded'; requestId: number; runId: string; events: RunEvent[] }
  | { type: 'traces.loaded'; requestId: number; runId: string; traces: RunTraceEnvelope[]; page?: TracePageInfo }
  | { type: 'traces.append'; requestId: number; runId: string; traces: RunTraceEnvelope[]; page?: TracePageInfo }
  | { type: 'traces.prepend'; requestId: number; runId: string; traces: RunTraceEnvelope[]; page?: TracePageInfo }
  | { type: 'trace-page.loaded'; requestId: number; page: TracePageInfo }
  | { type: 'items.loaded'; requestId: number; runId: string; items: ThreadItem[]; total: number }
  | { type: 'turns.loaded'; requestId: number; runId: string; turns: TurnMeta[] }
  | { type: 'select-run'; runId: string }
  | { type: 'select-item'; itemId: string }
  | { type: 'select-trace'; eventId: string }
  | { type: 'select-by-itemId'; itemId: string }
  | { type: 'set-item-filter'; filter: string }
  | { type: 'set-turn-filter'; filter: string }
  | { type: 'set-category-filter'; categories: RunTraceCategory[] }
  | { type: 'toggle-errors-only'; value: boolean }
  | { type: 'clear-items' }
  | { type: 'toggle-thread'; threadId: string }
  | { type: 'refresh.done'; requestId: number };

function mergeTraces(existing: RunTraceEnvelope[], incoming: RunTraceEnvelope[], mode: 'append' | 'prepend' | 'replace'): RunTraceEnvelope[] {
  if (mode === 'replace') {
    return [...incoming].sort((a, b) => a.sequence - b.sequence);
  }
  const seen = new Set<string>();
  const result: RunTraceEnvelope[] = [];
  const base = mode === 'prepend' ? [...incoming, ...existing] : [...existing, ...incoming];
  for (const t of base) {
    if (!seen.has(t.eventId)) {
      seen.add(t.eventId);
      result.push(t);
    }
  }
  return result.sort((a, b) => a.sequence - b.sequence);
}

export function runMonitorReducer(state: RunMonitorState, action: RunMonitorAction): RunMonitorState {
  switch (action.type) {
    case 'refresh.begin': {
      return {
        ...state,
        activeRequestId: action.requestId,
        loading: true,
      };
    }
    case 'refresh.begin-silent': {
      return {
        ...state,
        activeRequestId: action.requestId,
      };
    }
    case 'threads.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        threads: action.threads,
      };
    }
    case 'runs.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      const runIds = new Set(action.runs.map((r) => r.runId));
      const selectedStillExists = state.selectedRunId !== '' && runIds.has(state.selectedRunId);
      const nextSelectedRunId = selectedStillExists
        ? state.selectedRunId
        : (action.runs[0]?.runId ?? '');
      const selectedChanged = state.selectedRunId !== nextSelectedRunId;
      return {
        ...state,
        runs: action.runs,
        selectedRunId: nextSelectedRunId,
        events: selectedChanged ? [] : state.events,
        traces: selectedChanged ? [] : state.traces,
        items: selectedChanged ? [] : state.items,
        selectedItemId: selectedChanged ? '' : state.selectedItemId,
        inspectorItem: selectedChanged ? null : state.inspectorItem,
        turns: selectedChanged ? [] : state.turns,
        turnFilter: selectedChanged ? '' : state.turnFilter,
        selectedEventId: selectedChanged ? '' : state.selectedEventId,
        tracePage: selectedChanged ? null : state.tracePage,
      };
    }
    case 'events.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        events: action.events,
      };
    }
    case 'traces.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        traces: mergeTraces(state.traces, action.traces, 'replace'),
        tracePage: action.page ?? null,
        selectedEventId: action.traces.some((t) => t.eventId === state.selectedEventId) ? state.selectedEventId : '',
      };
    }
    case 'traces.append': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        traces: mergeTraces(state.traces, action.traces, 'append'),
        tracePage: action.page ? { ...state.tracePage, ...action.page, hasMoreBefore: state.tracePage?.hasMoreBefore ?? false } : state.tracePage,
      };
    }
    case 'traces.prepend': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        traces: mergeTraces(state.traces, action.traces, 'prepend'),
        tracePage: action.page ? { ...state.tracePage, ...action.page, hasMoreAfter: state.tracePage?.hasMoreAfter ?? false } : state.tracePage,
      };
    }
    case 'trace-page.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        tracePage: action.page,
      };
    }
    case 'items.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      const nextItems = action.items;
      const stillSelected = state.selectedItemId !== ''
        && nextItems.some((it) => it.id === state.selectedItemId);
      return {
        ...state,
        items: nextItems,
        selectedItemId: stillSelected ? state.selectedItemId : '',
        inspectorItem: stillSelected
          ? nextItems.find((it) => it.id === state.selectedItemId) ?? null
          : null,
      };
    }
    case 'turns.loaded': {
      if (action.requestId !== state.activeRequestId) return state;
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        turns: action.turns,
      };
    }
    case 'select-run': {
      if (action.runId === state.selectedRunId) return state;
      return {
        ...state,
        selectedRunId: action.runId,
        events: [],
        traces: [],
        items: [],
        selectedItemId: '',
        inspectorItem: null,
        turns: [],
        turnFilter: '',
        selectedEventId: '',
        categoryFilter: [],
        errorsOnly: false,
        tracePage: null,
      };
    }
    case 'select-item': {
      const found = state.items.find((it) => it.id === action.itemId) ?? null;
      if (action.itemId === state.selectedItemId && found === state.inspectorItem) return state;
      return {
        ...state,
        selectedItemId: action.itemId,
        inspectorItem: found,
      };
    }
    case 'select-trace': {
      if (action.eventId === state.selectedEventId) return state;
      return {
        ...state,
        selectedEventId: action.eventId,
      };
    }
    case 'select-by-itemId': {
      const found = state.traces.find((t) => t.itemId === action.itemId);
      const nextEventId = found?.eventId ?? '';
      if (nextEventId === state.selectedEventId) return state;
      return {
        ...state,
        selectedEventId: nextEventId,
      };
    }
    case 'set-item-filter': {
      if (action.filter === state.itemFilter) return state;
      return {
        ...state,
        itemFilter: action.filter,
      };
    }
    case 'set-turn-filter': {
      if (action.filter === state.turnFilter) return state;
      return {
        ...state,
        turnFilter: action.filter,
      };
    }
    case 'set-category-filter': {
      return {
        ...state,
        categoryFilter: action.categories,
      };
    }
    case 'toggle-errors-only': {
      return {
        ...state,
        errorsOnly: action.value,
      };
    }
    case 'clear-items': {
      if (state.items.length === 0 && state.selectedItemId === '' && state.inspectorItem === null) {
        return state;
      }
      return {
        ...state,
        items: [],
        selectedItemId: '',
        inspectorItem: null,
      };
    }
    case 'toggle-thread': {
      return {
        ...state,
        expandedThreadId: state.expandedThreadId === action.threadId ? '' : action.threadId,
      };
    }
    case 'refresh.done': {
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        loading: false,
      };
    }
    default:
      return state;
  }
}

export function selectSelectedTrace(state: RunMonitorState): RunTraceEnvelope | null {
  if (!state.selectedEventId) return null;
  return state.traces.find((t) => t.eventId === state.selectedEventId) ?? null;
}
