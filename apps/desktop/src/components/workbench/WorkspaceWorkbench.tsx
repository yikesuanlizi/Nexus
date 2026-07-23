import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../config/config.js';
import type { ThreadChildInfo, ThreadItem, ThreadMeta } from '../../shared/types.js';
import type { RunControlCapabilities, RunTraceSummary } from '@nexus/protocol';
import type { ExternalPreviewRequest } from '../WorkspaceFilesPanel.js';
import { WorkspaceFilesPanel } from '../WorkspaceFilesPanel.js';
import { Icon } from '../Icon.js';
import { buildAgentWorkbench } from '../../features/agents/agentWorkbenchModel.js';
import { buildAgentStageRows, buildSubagentStatusRows } from '../../features/agents/subagents.js';
import { WorkbenchTabs, type WorkbenchTab } from './WorkbenchTabs.js';
import { LiveActivityHud } from './LiveActivityHud.js';
import { AgentInspector } from './AgentInspector.js';
import { AgentStagePanel } from '../AgentStagePanel.js';

export function WorkspaceWorkbench({
  activeThread,
  activeThreadId,
  busy,
  threadChildren,
  runtimeItems = [],
  traceSummary,
  currentRunId,
  controlCapabilities,
  locale,
  workspaceRoot,
  externalPreviewRequest,
  activeTab,
  onTabChange,
  onJumpToMonitor,
  onInterrupt,
  onResume,
  onRollback,
  onToggleMemoryExcluded,
  responsiveMode,
  onCloseRequest,
}: {
  activeThread?: ThreadMeta | null;
  activeThreadId: string;
  busy: boolean;
  threadChildren: ThreadChildInfo[];
  runtimeItems?: ThreadItem[];
  traceSummary?: RunTraceSummary | null;
  currentRunId?: string;
  controlCapabilities?: RunControlCapabilities;
  locale: Locale;
  workspaceRoot: string;
  externalPreviewRequest?: ExternalPreviewRequest | null;
  activeTab: WorkbenchTab;
  onTabChange(tab: WorkbenchTab): void;
  onJumpToMonitor?(opts: { runId?: string; eventId?: string; itemId?: string; threadId?: string }): void;
  onInterrupt?(): void;
  onResume?(): void;
  onRollback?(checkpointId?: string): void;
  onToggleMemoryExcluded?(excluded: boolean): void;
  responsiveMode?: 'side' | 'overlay' | 'sheet';
  onCloseRequest?(): void;
}) {
  const zh = locale === 'zh';
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [filesPanelMounted, setFilesPanelMounted] = useState(false);
  const handledPreviewRequestKeyRef = useRef('');
  const mainAgentThreadId = activeThreadId || 'main';

  useEffect(() => {
    setSelectedAgentId(null);
  }, [activeThreadId]);

  useEffect(() => {
    if (!externalPreviewRequest?.path) return;
    const previewRequestKey = `${externalPreviewRequest.path}\u0000${externalPreviewRequest.nonce ?? ''}\u0000${externalPreviewRequest.pin ? '1' : '0'}`;
    if (handledPreviewRequestKeyRef.current === previewRequestKey) return;
    handledPreviewRequestKeyRef.current = previewRequestKey;
    if (activeTab !== 'files') {
      onTabChange('files');
    }
  }, [externalPreviewRequest?.nonce, externalPreviewRequest?.path, externalPreviewRequest?.pin, activeTab, onTabChange]);

  useEffect(() => {
    if (activeTab === 'files' || externalPreviewRequest?.path) {
      setFilesPanelMounted(true);
    }
  }, [activeTab, externalPreviewRequest?.path]);

  const workbench = useMemo(() => buildAgentWorkbench({
    mainThreadId: mainAgentThreadId,
    threadChildren,
    traceSummary,
    runtimeItems,
    busy,
    zh,
    currentRunId,
  }), [mainAgentThreadId, threadChildren, traceSummary, runtimeItems, busy, zh, currentRunId]);

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
  const shouldRenderFilesPanel = filesPanelMounted || activeTab === 'files' || Boolean(externalPreviewRequest?.path);

  const handleTabChange = (tab: WorkbenchTab) => {
    onTabChange(tab);
  };

  const handleSelectAgent = (threadId: string) => {
    setSelectedAgentId((current) => current === threadId ? null : threadId);
  };

  const handleJumpToAgentMonitor = (threadId: string) => {
    onJumpToMonitor?.({ threadId });
  };

  const handleJumpToTrace = (opts: { itemId: string; runId: string }) => {
    onJumpToMonitor?.({ itemId: opts.itemId, runId: opts.runId, threadId: activeThreadId });
  };

  return (
    <aside className={`eventPane workbenchPane workbench-${responsiveMode ?? 'side'}`}>
      <WorkbenchTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
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
        {activeTab === 'activity' ? (
          <div className={workbenchPanelClassName('activity', activeTab)}>
            <LiveActivityHud
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
            />
          </div>
        ) : null}

        {activeTab === 'agents' ? (
          <div className={workbenchPanelClassName('agents', activeTab)}>
            <div className="workbenchAgentTreeWrap">
              <AgentStagePanel
                locale={locale}
                rows={agentStageRows}
                selectedThreadId={selectedAgentId}
                onSelectAgent={handleSelectAgent}
              />
            </div>
            {selectedNode ? (
              <div className="workbenchAgentInspectorWrap">
                <AgentInspector
                  node={selectedNode}
                  onJumpToMonitor={handleJumpToAgentMonitor}
                  locale={locale}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {shouldRenderFilesPanel ? (
          <div className={workbenchPanelClassName('files', activeTab)} aria-hidden={activeTab !== 'files'}>
            <WorkspaceFilesPanel
              locale={locale}
              workspaceRoot={workspaceRoot}
              externalPreviewRequest={externalPreviewRequest}
            />
          </div>
        ) : null}
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
  const base = tab === 'activity' ? 'workbenchActivity' : tab === 'agents' ? 'workbenchAgents' : 'workbenchFiles';
  return `${base} workbenchPanel${tab === activeTab ? ' active' : ' inactive'}`;
}
