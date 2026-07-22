import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { RunTraceCategory, RunTraceEnvelope } from '@nexus/protocol';
import type { Locale } from '../../config/config.js';
import type { RunRecord, ThreadWithRuns } from '../../shared/types.js';
import type { EventDraft } from '../chat/threadView.js';
import { initialRunMonitorState, runMonitorReducer, selectSelectedTrace, type TracePageInfo } from './runMonitorState.js';

const AUTO_REFRESH_KEY = 'nexus.runMonitor.autoRefresh';
const AUTO_REFRESH_INTERVAL_KEY = 'nexus.runMonitor.autoRefreshInterval';
const DEFAULT_REFRESH_INTERVAL = 3000;
const TRACE_FETCH_LIMIT = 200;

const ALL_CATEGORIES: RunTraceCategory[] = [
  'model', 'tool', 'item', 'file', 'error', 'agent', 'checkpoint', 'control',
  'turn', 'iteration', 'context', 'memory', 'middleware', 'evidence',
];

function buildTraceUrl(
  runId: string,
  params: { limit?: number; before?: number; after?: number; categories?: RunTraceCategory[]; errorsOnly?: boolean; adminMode?: boolean },
): string {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.before != null) search.set('before', String(params.before));
  if (params.after != null) search.set('after', String(params.after));
  if (params.categories && params.categories.length > 0) {
    for (const c of params.categories) search.append('category', c);
  }
  if (params.errorsOnly) search.set('errorsOnly', '1');
  const qs = search.toString();
  const basePath = params.adminMode ? '/api/admin/runs' : '/api/runs';
  return `${basePath}/${encodeURIComponent(runId)}/trace${qs ? `?${qs}` : ''}`;
}

interface TraceFetchResult {
  traces: RunTraceEnvelope[];
  page: TracePageInfo;
}

async function fetchTraces(
  runId: string,
  params: { limit?: number; before?: number; after?: number; categories?: RunTraceCategory[]; errorsOnly?: boolean; adminMode?: boolean; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<TraceFetchResult> {
  const url = buildTraceUrl(runId, params);
  const response = await fetch(url, { headers: params.headers, signal: params.signal });
  if (!response.ok) return { traces: [], page: { hasMoreBefore: false, hasMoreAfter: false } };
  const data = (await response.json()) as { page?: { events?: RunTraceEnvelope[]; hasMoreBefore?: boolean; hasMoreAfter?: boolean; nextBefore?: number; nextAfter?: number } };
  const page = data.page;
  return {
    traces: page?.events ?? [],
    page: {
      hasMoreBefore: page?.hasMoreBefore ?? false,
      hasMoreAfter: page?.hasMoreAfter ?? false,
      nextBefore: page?.nextBefore,
      nextAfter: page?.nextAfter,
    },
  };
}

export function useRunMonitor(options: {
  threadId: string;
  locale: Locale;
  addEvent(event: EventDraft): void;
}) {
  const { addEvent, locale, threadId } = options;
  const zh = locale === 'zh';
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(runMonitorReducer, initialRunMonitorState);
  const [autoRefresh, setAutoRefreshState] = useState(() => {
    try { return localStorage.getItem(AUTO_REFRESH_KEY) === '1'; } catch { return false; }
  });
  const [autoRefreshInterval, setAutoRefreshIntervalState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(AUTO_REFRESH_INTERVAL_KEY));
      return v > 0 ? v : DEFAULT_REFRESH_INTERVAL;
    } catch { return DEFAULT_REFRESH_INTERVAL; }
  });
  const [adminToken, setAdminTokenState] = useState(() => localStorage.getItem('nexus.adminMonitorToken') ?? '');
  const adminMode = Boolean(adminToken.trim());
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const filtersRef = useRef({ categoryFilter: state.categoryFilter, errorsOnly: state.errorsOnly });
  filtersRef.current = { categoryFilter: state.categoryFilter, errorsOnly: state.errorsOnly };

  const setAdminToken = useCallback((value: string) => {
    setAdminTokenState(value);
    if (value.trim()) localStorage.setItem('nexus.adminMonitorToken', value.trim());
    else localStorage.removeItem('nexus.adminMonitorToken');
  }, []);

  const setAutoRefresh = useCallback((value: boolean) => {
    setAutoRefreshState(value);
    try {
      if (value) localStorage.setItem(AUTO_REFRESH_KEY, '1');
      else localStorage.removeItem(AUTO_REFRESH_KEY);
    } catch { /* ignore */ }
  }, []);

  const setAutoRefreshInterval = useCallback((ms: number) => {
    const v = Math.max(1000, ms);
    setAutoRefreshIntervalState(v);
    try { localStorage.setItem(AUTO_REFRESH_INTERVAL_KEY, String(v)); } catch { /* ignore */ }
  }, []);

  const toggleThread = useCallback((threadIdToToggle: string) => {
    dispatch({ type: 'toggle-thread', threadId: threadIdToToggle });
  }, []);

  const selectRun = useCallback((runId: string) => {
    dispatch({ type: 'select-run', runId });
  }, []);

  const selectEvent = useCallback((eventId: string) => {
    dispatch({ type: 'select-trace', eventId });
  }, []);

  const selectByItemId = useCallback((itemId: string) => {
    dispatch({ type: 'select-by-itemId', itemId });
  }, []);

  const toggleCategory = useCallback((category: RunTraceCategory) => {
    const current = stateRef.current.categoryFilter;
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    dispatch({ type: 'set-category-filter', categories: next });
  }, []);

  const setCategoryFilter = useCallback((categories: RunTraceCategory[]) => {
    dispatch({ type: 'set-category-filter', categories });
  }, []);

  const setErrorsOnly = useCallback((value: boolean) => {
    dispatch({ type: 'toggle-errors-only', value });
  }, []);

  const fetchRunsData = useCallback(async (requestId: number, controller: AbortController): Promise<RunRecord[]> => {
    const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
    try {
      const threadsUrl = adminMode ? '/api/admin/runs/threads' : '/api/runs/threads';
      const threadsResponse = await fetch(threadsUrl, { headers, signal: controller.signal });
      let nextThreads: ThreadWithRuns[] = [];
      if (threadsResponse.ok && !controller.signal.aborted) {
        const threadsData = (await threadsResponse.json()) as { threads?: ThreadWithRuns[] };
        nextThreads = threadsData.threads ?? [];
      }
      dispatch({ type: 'threads.loaded', requestId, threads: nextThreads });
      if (controller.signal.aborted) return [];

      const validThreadIds = new Set(nextThreads.map((t) => t.threadId));
      const runsUrl = adminMode
        ? '/api/admin/runs?limit=200'
        : threadId
          ? `/api/runs?threadId=${encodeURIComponent(threadId)}&limit=80`
          : '/api/runs?limit=20';
      const runsResponse = await fetch(runsUrl, { headers, signal: controller.signal });
      if (!runsResponse.ok || controller.signal.aborted) return [];
      const runsData = (await runsResponse.json()) as { runs?: RunRecord[] };
      const allRuns = runsData.runs ?? [];
      const nextRuns = (adminMode || !threadId) ? allRuns.filter((run) => validThreadIds.has(run.threadId)) : allRuns;
      dispatch({ type: 'runs.loaded', requestId, runs: nextRuns });
      return nextRuns;
    } catch {
      if (controller.signal.aborted) return [];
      return [];
    }
  }, [adminMode, adminToken, threadId]);

  const loadTraceInitial = useCallback(async (runId: string, requestId: number, controller: AbortController) => {
    const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
    const { categoryFilter, errorsOnly } = filtersRef.current;
    const result = await fetchTraces(runId, {
      limit: TRACE_FETCH_LIMIT,
      categories: categoryFilter.length > 0 ? categoryFilter : undefined,
      errorsOnly: errorsOnly || undefined,
      adminMode,
      headers,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    dispatch({ type: 'traces.loaded', requestId, runId, traces: result.traces, page: result.page });
  }, [adminMode, adminToken]);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (!current.selectedRunId || !current.tracePage?.hasMoreBefore || current.loading) return;
    const firstSeq = current.traces[0]?.sequence;
    if (firstSeq == null) return;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'refresh.begin', requestId });
    try {
      const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
      const { categoryFilter, errorsOnly } = filtersRef.current;
      const result = await fetchTraces(current.selectedRunId, {
        limit: TRACE_FETCH_LIMIT,
        before: firstSeq,
        categories: categoryFilter.length > 0 ? categoryFilter : undefined,
        errorsOnly: errorsOnly || undefined,
        adminMode,
        headers,
        signal: controller.signal,
      });
      dispatch({ type: 'traces.prepend', requestId, runId: current.selectedRunId, traces: result.traces, page: result.page });
    } catch {
      // ignore
    } finally {
      dispatch({ type: 'refresh.done', requestId });
    }
  }, [adminMode, adminToken]);

  const refresh = useCallback(async (runId?: string, opts?: { autoExpandThread?: boolean }) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;
    dispatch({ type: 'refresh.begin', requestId: currentRequestId });

    try {
      const nextRuns = await fetchRunsData(currentRequestId, controller);
      if (controller.signal.aborted) return;

      const prevSelectedId = runId || stateRef.current.selectedRunId;
      const runIds = new Set(nextRuns.map((r) => r.runId));
      const selectedAfterRuns = runIds.has(prevSelectedId)
        ? prevSelectedId
        : (nextRuns[0]?.runId ?? '');

      if (opts?.autoExpandThread && selectedAfterRuns) {
        const selectedRun = nextRuns.find((r) => r.runId === selectedAfterRuns);
        if (selectedRun && !stateRef.current.expandedThreadId) {
          dispatch({ type: 'toggle-thread', threadId: selectedRun.threadId });
        }
      }

      if (!selectedAfterRuns) {
        dispatch({ type: 'refresh.done', requestId: currentRequestId });
        return;
      }

      if (runId && runId !== stateRef.current.selectedRunId) {
        dispatch({ type: 'select-run', runId });
      }

      await loadTraceInitial(selectedAfterRuns, currentRequestId, controller);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    } finally {
      dispatch({ type: 'refresh.done', requestId: currentRequestId });
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [fetchRunsData, loadTraceInitial]);

  const refreshIncremental = useCallback(async () => {
    const current = stateRef.current;
    if (!current.selectedRunId || current.loading) return;
    const lastSeq = current.traces[current.traces.length - 1]?.sequence;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'refresh.begin-silent', requestId });
    try {
      const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
      const { categoryFilter, errorsOnly } = filtersRef.current;
      if (lastSeq == null) {
        const result = await fetchTraces(current.selectedRunId, {
          limit: TRACE_FETCH_LIMIT,
          categories: categoryFilter.length > 0 ? categoryFilter : undefined,
          errorsOnly: errorsOnly || undefined,
          adminMode,
          headers,
          signal: controller.signal,
        });
        if (result.traces.length > 0 && !controller.signal.aborted) {
          dispatch({ type: 'traces.loaded', requestId, runId: current.selectedRunId, traces: result.traces, page: result.page });
        }
      } else {
        const result = await fetchTraces(current.selectedRunId, {
          limit: TRACE_FETCH_LIMIT,
          after: lastSeq,
          categories: categoryFilter.length > 0 ? categoryFilter : undefined,
          errorsOnly: errorsOnly || undefined,
          adminMode,
          headers,
          signal: controller.signal,
        });
        if (result.traces.length > 0 && !controller.signal.aborted) {
          dispatch({ type: 'traces.append', requestId, runId: current.selectedRunId, traces: result.traces, page: result.page });
        }
      }
      await fetchRunsData(requestId, controller);
    } catch {
      // ignore
    }
  }, [adminMode, adminToken, fetchRunsData]);

  const openDrawer = useCallback(() => {
    setOpen(true);
    void refresh(undefined, { autoExpandThread: true });
  }, [refresh]);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const controlRun = useCallback(async (
    action: 'interrupt' | 'resume' | 'rollback',
    run: RunRecord,
    opts?: { checkpointId?: string },
  ) => {
    const body: Record<string, unknown> = { action };
    if (opts?.checkpointId) body.checkpointId = opts.checkpointId;
    const basePath = adminMode ? '/api/admin/runs' : '/api/runs';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminMode) headers['x-nexus-admin-token'] = adminToken.trim();
    const response = await fetch(`${basePath}/${encodeURIComponent(run.runId)}/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      addEvent({ kind: 'monitor', title: zh ? '控制动作失败' : 'Control failed', detail: data.error ?? action, tone: 'danger' });
      return;
    }
    addEvent({ kind: 'monitor', title: zh ? '控制动作已记录' : 'Control recorded', detail: action, tone: 'success' });
    await refresh(run.runId);
  }, [addEvent, zh, refresh, adminMode, adminToken]);

  useEffect(() => {
    if (open) {
      void refresh(undefined, { autoExpandThread: true });
    } else {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [open, refresh, threadId]);

  useEffect(() => {
    if (!open) return;
    void refresh(stateRef.current.selectedRunId || undefined);
  }, [open, state.categoryFilter, state.errorsOnly, refresh]);

  useEffect(() => {
    if (!open || !autoRefresh) {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
      return;
    }
    autoRefreshTimerRef.current = setInterval(() => {
      void refreshIncremental();
    }, autoRefreshInterval);
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [open, autoRefresh, autoRefreshInterval, refreshIncremental]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const selectedRun = state.runs.find((r) => r.runId === state.selectedRunId) ?? null;
  const selectedTrace = selectSelectedTrace(state);

  const visibleTraces = state.traces.filter((t) => {
    if (state.errorsOnly && t.level !== 'error' && t.category !== 'error' && t.lifecycle !== 'failed') return false;
    if (state.categoryFilter.length === 0) return true;
    return state.categoryFilter.includes(t.category);
  });

  return {
    open,
    loading: state.loading,
    runs: state.runs,
    events: state.events,
    traces: state.traces,
    visibleTraces,
    threads: state.threads,
    selectedRunId: state.selectedRunId,
    selectedRun,
    selectedEventId: state.selectedEventId,
    selectedTrace,
    categoryFilter: state.categoryFilter,
    errorsOnly: state.errorsOnly,
    tracePage: state.tracePage,
    expandedThreadId: state.expandedThreadId,
    adminMode,
    adminToken,
    autoRefresh,
    autoRefreshInterval,
    allCategories: ALL_CATEGORIES,
    zh,
    setAdminToken,
    setAutoRefresh,
    setAutoRefreshInterval,
    setOpen,
    openDrawer,
    closeDrawer,
    refresh,
    controlRun,
    toggleThread,
    selectRun,
    selectEvent,
    selectByItemId,
    toggleCategory,
    setCategoryFilter,
    setErrorsOnly,
    loadOlder,
  };
}
