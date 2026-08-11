import { useCallback, useState } from 'react';
import type { Locale } from '../config/config.js';
import type { ThreadChildInfo, ThreadItem, ThreadMeta } from '../shared/types.js';
import type { TaskRuntimeMonitorState } from '../features/monitor/taskRuntimeMonitor.js';
import type { RunControlCapabilities, RunTraceEnvelope, RunTraceSummary } from '@nexus/protocol';
import type { ExternalPreviewRequest } from './WorkspaceFilesPanel.js';
import { WorkspaceWorkbench } from './workbench/WorkspaceWorkbench.js';
import type { UtilityWorkbenchTab, WorkbenchTab } from './workbench/WorkbenchTabs.js';

export type RightPaneTab = WorkbenchTab;

export function RightPane({
  activeTab: initialActiveTab,
  activeThreadId,
  activeThreadTitle,
  activeThread,
  busy,
  threadChildren,
  locale,
  workspaceRoot,
  onTabChange,
  onToggleMemoryExcluded,
  externalPreviewRequest,
  taskRuntimeState,
  runtimeItems = [],
  onJumpToMonitor,
  traceSummary,
  currentRunId,
  controlCapabilities,
  recentTraces,
  onInterrupt,
  onResume,
  onRollback,
  responsiveMode,
  onCloseRequest,
}: {
  activeTab?: RightPaneTab;
  activeThreadId: string;
  activeThreadTitle: string;
  activeThread?: ThreadMeta | null;
  busy: boolean;
  threadChildren: ThreadChildInfo[];
  locale: Locale;
  workspaceRoot: string;
  onTabChange?(tab: RightPaneTab): void;
  onToggleMemoryExcluded?(excluded: boolean): void;
  externalPreviewRequest?: ExternalPreviewRequest | null;
  taskRuntimeState?: TaskRuntimeMonitorState;
  runtimeItems?: ThreadItem[];
  onJumpToMonitor?(opts: { runId?: string; eventId?: string; itemId?: string; threadId?: string }): void;
  traceSummary?: RunTraceSummary | null;
  currentRunId?: string;
  controlCapabilities?: RunControlCapabilities;
  recentTraces?: RunTraceEnvelope[];
  onInterrupt?(): void;
  onResume?(): void;
  onRollback?(checkpointId?: string): void;
  responsiveMode?: 'side' | 'overlay' | 'sheet';
  onCloseRequest?(): void;
}) {
  void activeThreadTitle;
  void taskRuntimeState;
  const [activeTab, setActiveTab] = useState<RightPaneTab>(() => initialActiveTab ?? readStoredRightPaneTab());
  const [openUtilityTabs, setOpenUtilityTabs] = useState<UtilityWorkbenchTab[]>(() => {
    return initialActiveTab === 'browser' || initialActiveTab === 'files' ? [initialActiveTab] : [];
  });

  const handleTabChange = useCallback((tab: RightPaneTab) => {
    if (isUtilityWorkbenchTab(tab)) {
      setOpenUtilityTabs((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]);
    }
    setActiveTab(tab);
    try {
      if (isUtilityWorkbenchTab(tab)) {
        localStorage.removeItem('nexus.rightPane.tab');
      } else {
        localStorage.setItem('nexus.rightPane.tab', tab);
      }
    } catch { /* best-effort local UI preference */ }
    onTabChange?.(tab);
  }, [onTabChange]);

  const handleOpenUtilityTab = useCallback((tab: UtilityWorkbenchTab) => {
    handleTabChange(tab);
  }, [handleTabChange]);

  const handleCloseUtilityTab = useCallback((tab: UtilityWorkbenchTab) => {
    setOpenUtilityTabs((tabs) => tabs.filter((item) => item !== tab));
    if (activeTab !== tab) return;
    setActiveTab('activity');
    try {
      localStorage.setItem('nexus.rightPane.tab', 'activity');
    } catch { /* best-effort local UI preference */ }
    onTabChange?.('activity');
  }, [activeTab, onTabChange]);

  return (
    <WorkspaceWorkbench
      activeThread={activeThread}
      activeThreadId={activeThreadId}
      busy={busy}
      threadChildren={threadChildren}
      runtimeItems={runtimeItems}
      recentTraces={recentTraces}
      traceSummary={traceSummary}
      currentRunId={currentRunId}
      controlCapabilities={controlCapabilities}
      locale={locale}
      workspaceRoot={workspaceRoot}
      externalPreviewRequest={externalPreviewRequest}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      openUtilityTabs={openUtilityTabs}
      onOpenUtilityTab={handleOpenUtilityTab}
      onCloseUtilityTab={handleCloseUtilityTab}
      onJumpToMonitor={onJumpToMonitor}
      onInterrupt={onInterrupt}
      onResume={onResume}
      onRollback={onRollback}
      onToggleMemoryExcluded={onToggleMemoryExcluded}
      responsiveMode={responsiveMode}
      onCloseRequest={onCloseRequest}
    />
  );
}

function readStoredRightPaneTab(): RightPaneTab {
  try {
    const stored = localStorage.getItem('nexus.rightPane.tab');
    if (stored === 'agents' || stored === 'activity') return stored;
    if (stored === 'files' || stored === 'browser') localStorage.removeItem('nexus.rightPane.tab');
    if (stored === 'status') return 'activity';
  } catch { /* best-effort local UI preference */ }
  return 'activity';
}

function isUtilityWorkbenchTab(tab: WorkbenchTab): tab is UtilityWorkbenchTab {
  return tab === 'files' || tab === 'browser';
}
