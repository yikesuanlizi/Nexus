import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../config/config.js';
import type { ThreadChildInfo, ThreadItem, ThreadMeta } from '../../shared/types.js';
import type { RunControlCapabilities, RunTraceEnvelope, RunTraceSummary } from '@nexus/protocol';
import type { ExternalPreviewRequest } from '../WorkspaceFilesPanel.js';
import { WorkspaceFilesPanel } from '../WorkspaceFilesPanel.js';
import { Icon } from '../Icon.js';
import { buildAgentWorkbench } from '../../features/agents/agentWorkbenchModel.js';
import { buildAgentStageRows, buildSubagentStatusRows } from '../../features/agents/subagents.js';
import {
  isTerminalUtilityWorkbenchTab,
  WorkbenchTabs,
  type UtilityWorkbenchTab,
  type UtilityWorkbenchTabKind,
  type WorkbenchTab,
} from './WorkbenchTabs.js';
import { LiveActivityHud } from './LiveActivityHud.js';
import { AgentInspector } from './AgentInspector.js';
import { AgentStagePanel } from '../AgentStagePanel.js';
import { BrowserWorkbench } from '../BrowserWorkbench.js';
import { TerminalPanel } from './TerminalPanel.js';

export function WorkspaceWorkbench({
  activeThread,
  activeThreadId,
  busy,
  threadChildren,
  runtimeItems = [],
  recentTraces = [],
  traceSummary,
  currentRunId,
  controlCapabilities,
  locale,
  workspaceRoot,
  terminalWorkspaceRoot,
  externalPreviewRequest,
  activeTab,
  onTabChange,
  openUtilityTabs,
  onOpenUtilityTab,
  onCloseUtilityTab,
  onJumpToMonitor,
  onInterrupt,
  onResume,
  onRollback,
  onToggleMemoryExcluded,
  onOpenSystemLocation,
  onAddFileToConversation,
  responsiveMode,
  onCloseRequest,
  suspendBrowser = false,
}: {
  activeThread?: ThreadMeta | null;
  activeThreadId: string;
  busy: boolean;
  threadChildren: ThreadChildInfo[];
  runtimeItems?: ThreadItem[];
  recentTraces?: RunTraceEnvelope[];
  traceSummary?: RunTraceSummary | null;
  currentRunId?: string;
  controlCapabilities?: RunControlCapabilities;
  locale: Locale;
  workspaceRoot: string;
  terminalWorkspaceRoot?: string;
  externalPreviewRequest?: ExternalPreviewRequest | null;
  activeTab: WorkbenchTab;
  onTabChange(tab: WorkbenchTab): void;
  openUtilityTabs: UtilityWorkbenchTab[];
  onOpenUtilityTab(tab: UtilityWorkbenchTabKind): UtilityWorkbenchTab;
  onCloseUtilityTab(tab: UtilityWorkbenchTab): void;
  onJumpToMonitor?(opts: { runId?: string; eventId?: string; itemId?: string; threadId?: string }): void;
  onInterrupt?(): void;
  onResume?(): void;
  onRollback?(checkpointId?: string): void;
  onToggleMemoryExcluded?(excluded: boolean): void;
  onOpenSystemLocation?(path: string): void;
  onAddFileToConversation?(path: string): void;
  responsiveMode?: 'side' | 'overlay' | 'sheet';
  onCloseRequest?(): void;
  suspendBrowser?: boolean;
}) {
  const zh = locale === 'zh';
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [terminalRoots, setTerminalRoots] = useState<Record<string, string>>({});
  const [browserNavigationRequest, setBrowserNavigationRequest] = useState<{ url: string; nonce: number } | null>(null);
  const browserNavigationNonceRef = useRef(0);
  const handledPreviewRequestKeyRef = useRef('');
  const hasActiveThread = Boolean(activeThreadId && activeThread);
  const mainAgentThreadId = activeThreadId || 'main';

  useEffect(() => {
    setSelectedAgentId(null);
  }, [activeThreadId]);

  useEffect(() => {
    setTerminalRoots({});
  }, [terminalWorkspaceRoot, workspaceRoot]);

  const handleOpenTerminalAt = (directory: string): void => {
    const tabId = onOpenUtilityTab('terminal');
    setTerminalRoots((current) => ({
      ...current,
      [tabId]: directory || terminalWorkspaceRoot || workspaceRoot,
    }));
  };

  const handleOpenHtmlInBrowser = (path: string): void => {
    if (!workspaceRoot || !path) return;
    const url = workspaceFileToUrl(workspaceRoot, path);
    browserNavigationNonceRef.current += 1;
    setBrowserNavigationRequest({ url, nonce: browserNavigationNonceRef.current });
    onOpenUtilityTab('browser');
  };

  useEffect(() => {
    if (!externalPreviewRequest?.path) return;
    const previewRequestKey = `${externalPreviewRequest.path}\u0000${externalPreviewRequest.nonce ?? ''}\u0000${externalPreviewRequest.pin ? '1' : '0'}`;
    if (handledPreviewRequestKeyRef.current === previewRequestKey) return;
    handledPreviewRequestKeyRef.current = previewRequestKey;
    if (activeTab !== 'files') {
      onOpenUtilityTab('files');
    }
  }, [externalPreviewRequest?.nonce, externalPreviewRequest?.path, externalPreviewRequest?.pin, activeTab, onOpenUtilityTab]);

  const workbench = useMemo(() => buildAgentWorkbench({
    mainThreadId: mainAgentThreadId,
    threadChildren,
    traceSummary,
    runtimeItems,
    recentTraces,
    busy,
    zh,
    currentRunId,
  }), [mainAgentThreadId, threadChildren, traceSummary, runtimeItems, recentTraces, busy, zh, currentRunId]);

  const agentStageRows = useMemo(() => buildAgentStageRows({
    activeThreadId: mainAgentThreadId,
    activeThreadTitle: activeThread?.title ?? '',
    locale,
    busy,
    children: buildSubagentStatusRows(threadChildren, locale),
  }), [mainAgentThreadId, activeThread?.title, locale, busy, threadChildren]);

  const runningAgentCount = useMemo(() => {
    return workbench.nodes.filter(n => n.status === 'running' || n.status === 'waiting').length;
  }, [workbench.nodes]);

  const selectedNode = useMemo(() => {
    if (!selectedAgentId) return null;
    return workbench.nodes.find(n => n.threadId === selectedAgentId) ?? null;
  }, [workbench.nodes, selectedAgentId]);

  const memoryExcluded = activeThread?.tags?.memoryExcluded === 'true';
  const shouldRenderFilesPanel = openUtilityTabs.includes('files');
  const shouldRenderBrowserWorkbench = openUtilityTabs.includes('browser');
  const terminalTabs = openUtilityTabs.filter(isTerminalUtilityWorkbenchTab);

  const handleTabChange = (tab: WorkbenchTab) => {
    onTabChange(tab);
  };

  const handleSelectAgent = (threadId: string) => {
    setSelectedAgentId((current) => current === threadId ? null : threadId);
  };

  const handleJumpToAgentMonitor = (threadId: string) => {
    onJumpToMonitor?.({ threadId });
  };

  const handleJumpToTrace = (opts: { itemId: string; runId: string; eventId?: string }) => {
    onJumpToMonitor?.({ itemId: opts.itemId, eventId: opts.eventId, runId: opts.runId, threadId: activeThreadId });
  };

  return (
    <aside className={`eventPane workbenchPane workbench-${responsiveMode ?? 'side'}`}>
      <WorkbenchTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        openUtilityTabs={openUtilityTabs}
        onOpenUtilityTab={onOpenUtilityTab}
        onCloseUtilityTab={onCloseUtilityTab}
        runningAgentCount={runningAgentCount}
        locale={locale}
      />

      {responsiveMode === 'overlay' || responsiveMode === 'sheet' ? (
        <button
          type="button"
          className="workbenchCloseBtn"
          onClick={onCloseRequest}
          aria-label={zh ? '关闭' : 'Close'}
        >
          <Icon name="x" />
        </button>
      ) : null}

      <div className="workbenchContent">
        <div
          className={workbenchPanelClassName('activity', activeTab)}
          data-state={activeTab === 'activity' ? 'active' : 'inactive'}
          aria-hidden={activeTab !== 'activity'}
          inert={activeTab !== 'activity'}
        >
          {hasActiveThread ? <LiveActivityHud
            traceSummary={traceSummary}
            currentPhase={workbench.currentPhase}
            recentEvents={workbench.recentEvents}
            controlCapabilities={controlCapabilities}
            busy={busy}
            onInterrupt={onInterrupt}
            onResume={onResume}
            onRollback={onRollback}
            onJumpToTrace={handleJumpToTrace}
            locale={locale}
          /> : null}
        </div>

        <div
          className={workbenchPanelClassName('agents', activeTab)}
          data-state={activeTab === 'agents' ? 'active' : 'inactive'}
          aria-hidden={activeTab !== 'agents'}
          inert={activeTab !== 'agents'}
        >
          {hasActiveThread ? <div className="workbenchAgentTreeWrap">
            <AgentStagePanel
              locale={locale}
              rows={agentStageRows}
              selectedThreadId={selectedAgentId}
              onSelectAgent={handleSelectAgent}
            />
          </div> : null}
          {hasActiveThread && selectedNode ? (
            <div className="workbenchAgentInspectorWrap">
              <AgentInspector
                node={selectedNode}
                onJumpToMonitor={handleJumpToAgentMonitor}
                locale={locale}
              />
            </div>
          ) : null}
        </div>

        {shouldRenderFilesPanel ? (
          <div
            className={workbenchPanelClassName('files', activeTab)}
            data-state={activeTab === 'files' ? 'active' : 'inactive'}
            aria-hidden={activeTab !== 'files'}
            inert={activeTab !== 'files'}
          >
            <WorkspaceFilesPanel
              locale={locale}
              workspaceRoot={workspaceRoot}
              externalPreviewRequest={externalPreviewRequest}
              onOpenTerminalAt={handleOpenTerminalAt}
              onOpenSystemLocation={onOpenSystemLocation}
              onOpenHtmlInBrowser={handleOpenHtmlInBrowser}
              onAddFileToConversation={onAddFileToConversation}
            />
          </div>
        ) : null}

        {shouldRenderBrowserWorkbench ? (
          <div
            className={workbenchPanelClassName('browser', activeTab)}
            data-state={activeTab === 'browser' ? 'active' : 'inactive'}
            aria-hidden={activeTab !== 'browser'}
            inert={activeTab !== 'browser'}
          >
            <BrowserWorkbench
              active={activeTab === 'browser' && !suspendBrowser}
              navigationRequest={browserNavigationRequest}
            />
          </div>
        ) : null}

        {terminalTabs.map((tabId) => (
          <div
            className={workbenchPanelClassName(tabId, activeTab)}
            data-state={activeTab === tabId ? 'active' : 'inactive'}
            aria-hidden={activeTab !== tabId}
            inert={activeTab !== tabId}
            key={tabId}
          >
            <TerminalPanel
              active={activeTab === tabId}
              locale={locale}
              workspaceRoot={terminalRoots[tabId] ?? terminalWorkspaceRoot ?? workspaceRoot}
            />
          </div>
        ))}
      </div>

      {activeThread && onToggleMemoryExcluded ? (
        <div className="workbenchFooter">
          <label className="toggle">
            <input
              checked={memoryExcluded}
              onChange={(event) => onToggleMemoryExcluded(event.target.checked)}
              type="checkbox"
            />
            <span className="settingRow">
              <span className="settingLabel">
                {zh ? '此线程不生成记忆' : 'Exclude from memory'}
                <span className="settingHelpIcon">
                  <Icon name="question" />
                </span>
              </span>
              <span className="settingTooltip">
                <strong>{zh ? '此线程不生成记忆' : 'Exclude from memory extraction'}</strong>
                {zh
                  ? '开启后，这个对话的内容不会被提取到长期记忆库里。'
                  : 'When enabled, this conversation won\'t be saved to long-term memory.'}
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </aside>
  );
}

function workbenchPanelClassName(tab: WorkbenchTab, activeTab: WorkbenchTab): string {
  const base = tab === 'activity' ? 'workbenchActivity' : tab === 'agents' ? 'workbenchAgents' : tab === 'browser' ? 'workbenchBrowser' : isTerminalUtilityWorkbenchTab(tab) ? 'workbenchTerminal' : 'workbenchFiles';
  return `${base} workbenchPanel${tab === activeTab ? ' active' : ' inactive'}`;
}

/** Build a local file URL so the Electron WebContentsView can resolve relative assets. */
function workspaceFileToUrl(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.trim().replace(/[\\/]+$/, '');
  const safeRelativePath = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');
  const absolutePath = `${root}/${safeRelativePath}`.replace(/\\/g, '/');
  const withLeadingSlash = absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`;
  const encodedPath = withLeadingSlash
    .split('/')
    .map((segment, index) => index === 0 ? '' : encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/');
  return `file://${encodedPath}`;
}
