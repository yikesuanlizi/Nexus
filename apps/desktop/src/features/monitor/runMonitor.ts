import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../../config/config.js';
import type { RunEvent, RunRecord, ThreadWithRuns } from '../../shared/types.js';
import type { EventDraft } from '../chat/threadView.js';

const AUTO_REFRESH_KEY = 'nexus.runMonitor.autoRefresh';
const AUTO_REFRESH_INTERVAL_KEY = 'nexus.runMonitor.autoRefreshInterval';
const DEFAULT_REFRESH_INTERVAL = 3000;

export function useRunMonitor(options: {
  threadId: string;
  locale: Locale;
  addEvent(event: EventDraft): void;
}) {
  const { addEvent, locale, threadId } = options;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [threads, setThreads] = useState<ThreadWithRuns[]>([]);
  const [expandedThreadId, setExpandedThreadId] = useState('');
  const [expandedEventId, setExpandedEventId] = useState('');
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
    setExpandedThreadId((prev) => (prev === threadIdToToggle ? '' : threadIdToToggle));
  }, []);

  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? '' : eventId));
  }, []);

  const refresh = useCallback(async (runId?: string, opts?: { autoExpandThread?: boolean }) => {
    if (!threadId && !adminMode) {
      setRuns([]);
      setThreads([]);
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
      
      const threadsUrl = adminMode
        ? '/api/admin/runs/threads'
        : '/api/runs/threads';
      const threadsResponse = await fetch(threadsUrl, { headers });
      let nextThreads: ThreadWithRuns[] = [];
      if (threadsResponse.ok) {
        const threadsData = (await threadsResponse.json()) as { threads?: ThreadWithRuns[] };
        nextThreads = threadsData.threads ?? [];
      }
      setThreads(nextThreads);
      
      const validThreadIds = new Set(nextThreads.map((t) => t.threadId));
      
      const runsUrl = adminMode
        ? '/api/admin/runs?limit=200'
        : `/api/runs?threadId=${encodeURIComponent(threadId)}&limit=80`;
      const runsResponse = await fetch(runsUrl, { headers });
      if (!runsResponse.ok) return;
      const runsData = (await runsResponse.json()) as { runs?: RunRecord[] };
      const allRuns = runsData.runs ?? [];
      const nextRuns = adminMode ? allRuns.filter((run) => validThreadIds.has(run.threadId)) : allRuns;
      setRuns(nextRuns);
      
      const nextSelected = runId || nextRuns[0]?.runId || '';
      setSelectedRunId(nextSelected);
      
      if (opts?.autoExpandThread && nextSelected && nextRuns.length > 0) {
        const selectedRun = nextRuns.find((r) => r.runId === nextSelected);
        if (selectedRun) {
          setExpandedThreadId((prev) => prev || selectedRun.threadId);
        }
      }
      
      if (!nextSelected) {
        setEvents([]);
        return;
      }
      const eventsResponse = await fetch(`/api/runs/${encodeURIComponent(nextSelected)}/events?limit=500`);
      if (eventsResponse.ok) {
        const eventsData = (await eventsResponse.json()) as { events?: RunEvent[] };
        setEvents(eventsData.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [adminMode, adminToken, threadId]);

  const openDrawer = useCallback(() => {
    setOpen(true);
    void refresh(undefined, { autoExpandThread: true });
  }, [refresh]);

  const controlRun = useCallback(async (action: 'interrupt' | 'resume' | 'rollback', run: RunRecord) => {
    const response = await fetch(`/api/runs/${encodeURIComponent(run.runId)}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, threadId: run.threadId }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      addEvent({ kind: 'monitor', title: locale === 'zh' ? '控制动作失败' : 'Control failed', detail: data.error ?? action, tone: 'danger' });
      return;
    }
    addEvent({ kind: 'monitor', title: locale === 'zh' ? '控制动作已记录' : 'Control recorded', detail: action, tone: 'success' });
    await refresh(run.runId);
  }, [addEvent, locale, refresh]);

  useEffect(() => {
    setSelectedRunId('');
    setEvents([]);
    if (open) void refresh('', { autoExpandThread: true });
  }, [open, refresh, threadId]);

  useEffect(() => {
    if (!open || !autoRefresh) {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
      return;
    }
    autoRefreshTimerRef.current = setInterval(() => {
      void refresh(selectedRunId || undefined);
    }, autoRefreshInterval);
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [open, autoRefresh, autoRefreshInterval, refresh, selectedRunId]);

  return {
    open,
    loading,
    runs,
    events,
    selectedRunId,
    threads,
    expandedThreadId,
    expandedEventId,
    adminMode,
    adminToken,
    autoRefresh,
    autoRefreshInterval,
    setAdminToken,
    setAutoRefresh,
    setAutoRefreshInterval,
    setOpen,
    refresh,
    openDrawer,
    controlRun,
    toggleThread,
    toggleEvent,
  };
}
