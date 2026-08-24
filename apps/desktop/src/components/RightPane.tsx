import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../config/config.js';
import type { ThreadChildInfo, ThreadItem, ThreadMeta } from '../shared/types.js';
import type { TaskRuntimeMonitorState } from '../features/monitor/taskRuntimeMonitor.js';
import type { RunControlCapabilities, RunTraceEnvelope, RunTraceSummary } from '@nexus/protocol';
import type { ExternalPreviewRequest } from './WorkspaceFilesPanel.js';
import { WorkspaceWorkbench } from './workbench/WorkspaceWorkbench.js';
import {
  createTerminalUtilityWorkbenchTab,
  isUtilityWorkbenchTab,
  type UtilityWorkbenchTab,
  type UtilityWorkbenchTabKind,
  type WorkbenchTab,
} from './workbench/WorkbenchTabs.js';
import { readStoredWorkbenchState, writeStoredWorkbenchState } from './workbench/workbenchState.js';
import { showItemInSystemFolder } from '../api/desktopBridge.js';
import type { OpsTaskSession } from '@nexus/protocol';
import type { OpsTaskTimelineEvent } from './workbench/OpsTaskInspector.js';
import type { KnowledgeScopeSelection } from '../api/knowledgeClient.js';

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
  terminalWorkspaceRoot,
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
  onAddFileToConversation,
  browserRequestVersion = 0,
  suspendBrowser = false,
  showOps = false,
  opsTask = null,
  opsTaskEvents = [],
  opsTaskBusy = false,
  opsKnowledgeScope = null,
  onOpsKnowledgeScopeChange,
  onOpsTaskAction,
  onOpsRunTest,
  onOpsSaveIncident,
}: {
  activeTab?: RightPaneTab;
  activeThreadId: string;
  activeThreadTitle: string;
  activeThread?: ThreadMeta | null;
  busy: boolean;
  threadChildren: ThreadChildInfo[];
  locale: Locale;
  workspaceRoot: string;
  terminalWorkspaceRoot?: string;
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
  onAddFileToConversation?(path: string): void;
  browserRequestVersion?: number;
  suspendBrowser?: boolean;
  showOps?: boolean;
  opsTask?: OpsTaskSession | null;
  opsTaskEvents?: OpsTaskTimelineEvent[];
  opsTaskBusy?: boolean;
  opsKnowledgeScope?: KnowledgeScopeSelection | null;
  onOpsKnowledgeScopeChange?(selection: KnowledgeScopeSelection | null): void;
  onOpsTaskAction?(action: 'pause' | 'resume' | 'cancel' | 'confirm' | 'reject_continue' | 'propose_patch' | 'approve_patch' | 'reject_patch'): void;
  onOpsRunTest?(testId: string): void;
  onOpsSaveIncident?(): void;
}) {
  void activeThreadTitle;
  void taskRuntimeState;
  const hasActiveThread = Boolean(activeThreadId && activeThread);
  const [activeTab, setActiveTab] = useState<RightPaneTab>(() => (
    hasActiveThread ? (initialActiveTab ?? readStoredRightPaneTab()) : 'activity'
  ));
  const [openUtilityTabs, setOpenUtilityTabs] = useState<UtilityWorkbenchTab[]>(() => {
    if (!hasActiveThread) return [];
    const stored = readStoredWorkbenchState();
    const initialUtility = initialActiveTab && isUtilityWorkbenchTab(initialActiveTab) ? [initialActiveTab] : [];
    return [...new Set([...stored.openUtilityTabs, ...initialUtility])];
  });
  const handledBrowserRequestVersion = useRef(0);
  const opsVisible = hasActiveThread && (showOps || activeThread?.mode === 'ops' || Boolean(opsTask));

  useEffect(() => {
    if (hasActiveThread) return;
    setActiveTab('activity');
    setOpenUtilityTabs([]);
    writeStoredWorkbenchState({ activeTab: 'activity', openUtilityTabs: [] });
    try {
      localStorage.setItem('nexus.rightPane.tab', 'activity');
    } catch { /* best-effort local UI preference */ }
  }, [hasActiveThread]);

  useEffect(() => {
    if (opsVisible || activeTab !== 'ops') return;
    setActiveTab('activity');
    const stored = readStoredWorkbenchState();
    writeStoredWorkbenchState({ ...stored, activeTab: 'activity' });
    try { localStorage.setItem('nexus.rightPane.tab', 'activity'); } catch { /* best-effort local UI preference */ }
    onTabChange?.('activity');
  }, [activeTab, onTabChange, opsVisible]);

  const handleTabChange = useCallback((tab: RightPaneTab) => {
    if (!hasActiveThread && isUtilityWorkbenchTab(tab)) return;
    if (isUtilityWorkbenchTab(tab)) {
      setOpenUtilityTabs((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]);
    }
    setActiveTab(tab);
    const stored = readStoredWorkbenchState();
    writeStoredWorkbenchState({
      activeTab: tab,
      openUtilityTabs: isUtilityWorkbenchTab(tab) ? [...new Set([...stored.openUtilityTabs, tab])] : stored.openUtilityTabs,
    });
    try {
      if (isUtilityWorkbenchTab(tab)) {
        localStorage.removeItem('nexus.rightPane.tab');
      } else {
        localStorage.setItem('nexus.rightPane.tab', tab);
      }
    } catch { /* best-effort local UI preference */ }
    onTabChange?.(tab);
  }, [hasActiveThread, onTabChange]);

  useEffect(() => {
    if (browserRequestVersion === 0 || browserRequestVersion === handledBrowserRequestVersion.current) return;
    handledBrowserRequestVersion.current = browserRequestVersion;
    handleTabChange('browser');
  }, [browserRequestVersion, handleTabChange]);

  const handleOpenUtilityTab = useCallback((kind: UtilityWorkbenchTabKind): UtilityWorkbenchTab => {
    const tab = kind === 'terminal' ? createTerminalUtilityWorkbenchTab() : kind;
    if (!hasActiveThread) return tab;
    setOpenUtilityTabs((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]);
    setActiveTab(tab);
    const stored = readStoredWorkbenchState();
    writeStoredWorkbenchState({
      activeTab: tab,
      openUtilityTabs: [...new Set([...stored.openUtilityTabs, tab])],
    });
    try {
      localStorage.removeItem('nexus.rightPane.tab');
    } catch { /* best-effort local UI preference */ }
    onTabChange?.(tab);
    return tab;
  }, [hasActiveThread, onTabChange]);

  const handleCloseUtilityTab = useCallback((tab: UtilityWorkbenchTab) => {
    const tabIndex = openUtilityTabs.indexOf(tab);
    const remainingUtilityTabs = openUtilityTabs.filter((item) => item !== tab);
    const nextActiveTab: RightPaneTab = activeTab === tab
      ? remainingUtilityTabs[tabIndex] ?? remainingUtilityTabs[tabIndex - 1] ?? 'activity'
      : activeTab;

    setOpenUtilityTabs(remainingUtilityTabs);
    writeStoredWorkbenchState({
      activeTab: nextActiveTab,
      openUtilityTabs: remainingUtilityTabs,
    });
    if (activeTab !== tab) return;
    setActiveTab(nextActiveTab);
    try {
      if (isUtilityWorkbenchTab(nextActiveTab)) {
        localStorage.removeItem('nexus.rightPane.tab');
      } else {
        localStorage.setItem('nexus.rightPane.tab', nextActiveTab);
      }
    } catch { /* best-effort local UI preference */ }
    onTabChange?.(nextActiveTab);
  }, [activeTab, onTabChange, openUtilityTabs]);

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
      workspaceRoot={hasActiveThread ? workspaceRoot : ''}
      terminalWorkspaceRoot={hasActiveThread ? terminalWorkspaceRoot : undefined}
      externalPreviewRequest={externalPreviewRequest}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      openUtilityTabs={hasActiveThread ? openUtilityTabs : []}
      onOpenUtilityTab={handleOpenUtilityTab}
      onCloseUtilityTab={handleCloseUtilityTab}
      onOpenSystemLocation={(path) => { void showItemInSystemFolder(path); }}
      onAddFileToConversation={onAddFileToConversation}
      onJumpToMonitor={onJumpToMonitor}
      onInterrupt={onInterrupt}
      onResume={onResume}
      onRollback={onRollback}
      onToggleMemoryExcluded={onToggleMemoryExcluded}
      responsiveMode={responsiveMode}
      onCloseRequest={onCloseRequest}
      suspendBrowser={suspendBrowser}
      showOps={opsVisible}
      opsTask={opsTask}
      opsTaskEvents={opsTaskEvents}
      opsTaskBusy={opsTaskBusy}
      opsKnowledgeScope={opsKnowledgeScope}
      onOpsKnowledgeScopeChange={onOpsKnowledgeScopeChange}
      onOpsTaskAction={onOpsTaskAction}
      onOpsRunTest={onOpsRunTest}
      onOpsSaveIncident={onOpsSaveIncident}
    />
  );
}

function readStoredRightPaneTab(): RightPaneTab {
  const stored = readStoredWorkbenchState();
  return stored.activeTab;
}
