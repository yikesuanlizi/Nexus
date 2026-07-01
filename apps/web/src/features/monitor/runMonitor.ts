import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../../config/config.js';
import type { RunEvent, RunRecord } from '../../shared/types.js';
import type { EventDraft } from '../chat/threadView.js';

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
  const [adminToken, setAdminTokenState] = useState(() => localStorage.getItem('nexus.adminMonitorToken') ?? '');
  const adminMode = Boolean(adminToken.trim());

  const setAdminToken = useCallback((value: string) => {
    setAdminTokenState(value);
    if (value.trim()) localStorage.setItem('nexus.adminMonitorToken', value.trim());
    else localStorage.removeItem('nexus.adminMonitorToken');
  }, []);

  const refresh = useCallback(async (runId?: string) => {
    if (!threadId && !adminMode) {
      setRuns([]);
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const runsUrl = adminMode
        ? '/api/admin/runs?limit=200'
        : `/api/runs?threadId=${encodeURIComponent(threadId)}&limit=80`;
      const headers = adminMode ? { 'x-nexus-admin-token': adminToken.trim() } : undefined;
      const runsResponse = await fetch(runsUrl, { headers });
      if (!runsResponse.ok) return;
      const runsData = (await runsResponse.json()) as { runs?: RunRecord[] };
      const nextRuns = runsData.runs ?? [];
      setRuns(nextRuns);
      const nextSelected = runId || nextRuns[0]?.runId || '';
      setSelectedRunId(nextSelected);
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
    void refresh();
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
    if (open) void refresh('');
  }, [open, refresh, threadId]);

  return {
    open,
    loading,
    runs,
    events,
    selectedRunId,
    adminMode,
    adminToken,
    setAdminToken,
    setOpen,
    refresh,
    openDrawer,
    controlRun,
  };
}
