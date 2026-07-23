import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RUN_CONFIG_STORAGE_KEY, mergeRunConfigDefaults, type RunConfig, type WebSearchMode } from './config/config.js';
import { Icon } from './components/Icon.js';
import { AppDialog, SettingsHelpDialog, SkillDraftDialog, type AppDialogState } from './components/Dialogs.js';
import { ComposerBar, type PaletteOption } from './components/ComposerBar.js';
import { AssistantTurnView, ItemView } from './components/ItemView.js';
import { ApprovalDiffPreview } from './components/ApprovalDiffPreview.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { WeixinConnectDialog } from './components/WeixinConnectDialog.js';
import { RightPane } from './components/RightPane.js';
import type { ExternalPreviewRequest } from './components/WorkspaceFilesPanel.js';
import { openInSystemEditor } from './api/desktopBridge.js';
import { WorkflowPanel } from './components/WorkflowPanel.js';
import { RunMonitorDrawer } from './components/RunMonitorDrawer.js';
import { WorkspaceThreadList } from './components/WorkspaceThreadList.js';
import { TitleBar } from './components/TitleBar.js';
import { useBotControls, type WeixinLoginState } from './api/botClient.js';
import { resizeTextareaToContent } from './shared/composer.js';
import { useRightPaneSizing, useToastNotice } from './shared/uiState.js';
import { defaultConfig, defaultMcps } from './config/defaults.js';
import { t } from './shared/i18n.js';
import { extractGitHubSkillInstallUrls } from './features/input/composerInput.js';
import { normalizeStoredMcps, resolveMcpDraftFromInput } from './features/settings/mcpConfig.js';
import { getSlashCommandOptions, isSlashInput, parseSlashCommand, type SlashCommand, type SlashCommandOption } from './features/slash/slashCommands.js';
import { localizedSkillDescription } from './features/settings/skillDescriptions.js';
import { readStored } from './shared/storage.js';
import { buildChildActivityByThread } from './features/agents/subagentActivity.js';
import { buildSubagentStatusRows } from './features/agents/subagents.js';
import { modeInstructionFor } from './config/taskModes.js';
import { buildTokenUsageSummary, formatCacheDiagnostics, formatCompactionPressure } from './features/chat/usageDisplay.js';
import { rollbackCountForTurn } from './features/chat/rollback.js';
import { useRunMonitor } from './features/monitor/runMonitor.js';
import { useTaskRuntimeMonitor, isTaskRuntimeEvent } from './features/monitor/taskRuntimeMonitor.js';
import { authEventSourceUrl } from './api/authClient.js';
import { useWebProviderSettings, type SettingsResponseWithWebProvider } from './api/webProviderClient.js';
import { fetchThreadConfigOverrides, patchThreadConfigOverrides, type ThreadConfigOverrides } from './api/threadConfigClient.js';
import { createLatestRequestGuard } from './features/chat/latestRequestGuard.js';
import { nextTranscriptFollowState, type TranscriptFollowState } from './features/chat/transcriptFollow.js';
import { actionDetail, actionTitle, completeLocalSkillDraftItem, createLocalSkillDraftItems, mergeIncomingItems, removeLocalThreadItems } from './features/chat/threadItems.js';
import { optimisticDeleteThread } from './features/chat/threads.js';
import { forgetWorkspaceRoot, pickWorkspaceRoot, readRememberedWorkspaceRoots, rememberWorkspaceRoots, workspacePickerNotice, workspacePickerStatus } from './features/workspaces/workspaces.js';
import { controlThreadWorkflow, createWorkflowDraftErrorItem, createWorkflowDraftReplyItem, createWorkflowDraftUserItem, createWorkflowThread, isUntitledWorkflowProjectTitle, isWorkflowProjectThread, loadThreadWorkflow, parseThreadWorkflow, parseWorkflowCheckpointItems, planWorkflowDraft, saveThreadWorkflow, workflowThreadTitleFromGoal, type WorkflowBlueprintCompileResult, type WorkflowComponentDefinition, type WorkflowPlanDraft, type WorkflowSnapshot, type WorkflowRuntimeAction } from './features/workflow/workflow.js';
import { applyAgentMessageDelta, describeEvent, groupTranscriptItems, removeThreadItem, withSyntheticUserMessages, type EventDraft } from './features/chat/threadView.js';
import type { ApiKeyState, ApprovalRequest, EventLine, McpConfig, McpServerStatus, ModelPreset, ProviderEntry, SkillDraft, SkillEntry, ThreadChildInfo, ThreadItem, ThreadMeta, ThreadUsage, TurnMeta } from './shared/types.js';
import type { ModelPresetConfig } from '@nexus/protocol';
import './styles.css';
type ComposerImage = { name: string; dataUrl: string };
function resolveThemeShortcutMode(current: RunConfig['themeMode']): 'light' | 'dark' {
  if (current === 'dark') return 'dark';
  if (current === 'light') return 'light';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function nextThemeMode(current: RunConfig['themeMode']): RunConfig['themeMode'] {
  return resolveThemeShortcutMode(current) === 'dark' ? 'light' : 'dark';
}

function formatCompactNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function hasContextPressure(pressure: { estimatedTokens?: number; maxTokens?: number } | null | undefined): boolean {
  return Boolean(pressure?.estimatedTokens && pressure?.maxTokens && pressure.maxTokens > 0);
}

function contextUsagePercent(pressure: { estimatedTokens?: number; maxTokens?: number } | null | undefined): number {
  const est = Number(pressure?.estimatedTokens ?? 0);
  const max = Number(pressure?.maxTokens ?? 0);
  if (max <= 0) return 0;
  return Math.min(100, Math.round((est / max) * 100));
}

function cacheContextPercent(
  usage: { totalCached?: number } | null | undefined,
  pressure: { maxTokens?: number } | null | undefined,
): number {
  const cached = Number(usage?.totalCached ?? 0);
  const max = Number(pressure?.maxTokens ?? 0);
  if (max <= 0) return 0;
  return Math.min(100, Math.round((cached / max) * 100));
}

function buildTokenTooltip(
  usage: { totalInput?: number; totalCached?: number; totalOutput?: number; hitRate?: number } | null | undefined,
  pressure: { estimatedTokens?: number; maxTokens?: number; softThreshold?: number; hardThreshold?: number } | null | undefined,
  locale: 'zh' | 'en',
): string {
  const parts: string[] = [];
  if (usage) {
    parts.push(locale === 'zh' ? `输入: ${usage.totalInput}` : `Input: ${usage.totalInput}`);
    parts.push(locale === 'zh' ? `缓存: ${usage.totalCached} (${usage.hitRate}%)` : `Cache: ${usage.totalCached} (${usage.hitRate}%)`);
    parts.push(locale === 'zh' ? `输出: ${usage.totalOutput}` : `Output: ${usage.totalOutput}`);
  }
  if (pressure?.maxTokens) {
    if (parts.length) parts.push('—');
    parts.push(locale === 'zh'
      ? `上下文: ${formatCompactNumber(pressure.estimatedTokens ?? 0)} / ${formatCompactNumber(pressure.maxTokens)}`
      : `Context: ${formatCompactNumber(pressure.estimatedTokens ?? 0)} / ${formatCompactNumber(pressure.maxTokens)}`);
    if (pressure.softThreshold) {
      parts.push(locale === 'zh'
        ? `软阈值: ${formatCompactNumber(pressure.softThreshold)}`
        : `Soft threshold: ${formatCompactNumber(pressure.softThreshold)}`);
    }
    if (pressure.hardThreshold) {
      parts.push(locale === 'zh'
        ? `硬阈值: ${formatCompactNumber(pressure.hardThreshold)}`
        : `Hard threshold: ${formatCompactNumber(pressure.hardThreshold)}`);
    }
  }
  return parts.join(' ');
}

function App() {
  const [hasStoredRunConfig] = useState(() => Boolean(localStorage.getItem(RUN_CONFIG_STORAGE_KEY)));
  const [config, setConfig] = useState<RunConfig>(() => ({
    ...defaultConfig,
    ...readStored<Partial<RunConfig>>(RUN_CONFIG_STORAGE_KEY, {}),
  }));
  const [configHydrated, setConfigHydrated] = useState(false);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [rememberedWorkspaceRoots, setRememberedWorkspaceRoots] = useState<string[]>(() => readRememberedWorkspaceRoots());
  const [threadId, setThreadId] = useState(''), [turns, setTurns] = useState<TurnMeta[]>([]), [items, setItems] = useState<ThreadItem[]>([]);
  const [threadUsage, setThreadUsage] = useState<ThreadUsage | null>(null);
  const [cacheDiagnostics, setCacheDiagnostics] = useState<{
    stable?: boolean;
    reasons?: string[];
    shape?: { prefixHash?: string };
  } | null>(null);
  const [compactionPressure, setCompactionPressure] = useState<{
    status?: string;
    estimatedTokens?: number;
    hardThreshold?: number;
    maxTokens?: number;
    softThreshold?: number;
    ratio?: number;
  } | null>(null);
  const [threadChildren, setThreadChildren] = useState<ThreadChildInfo[]>([]);
  const [, setEvents] = useState<EventLine[]>([]);
  const [runningTurnIds, setRunningTurnIds] = useState<Set<string>>(() => new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false), [threadFilter, setThreadFilter] = useState(''), [input, setInput] = useState('');
  // 窄屏 sidebar 抽屉开关 — Chinese: narrow-screen sidebar drawer toggle
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSlashOption, setActiveSlashOption] = useState<SlashCommandOption | null>(null);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [draggingImage, setDraggingImage] = useState(false), [busy, setBusy] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [workflowPlanning, setWorkflowPlanning] = useState(false), [workflowSaving, setWorkflowSaving] = useState(false), [workflowRuntimeBusy, setWorkflowRuntimeBusy] = useState(false), [workflowComponents, setWorkflowComponents] = useState<WorkflowComponentDefinition[]>([]), [workflowBlueprint, setWorkflowBlueprint] = useState<WorkflowBlueprintCompileResult | null>(null), [workflowPlanDraft, setWorkflowPlanDraft] = useState<WorkflowPlanDraft | null>(null), [workflowSelectedNodeIds, setWorkflowSelectedNodeIds] = useState<string[]>([]);
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'workflow'>('chat');
  const [status, setStatus] = useState('Idle');
  const [transcriptFollow, setTranscriptFollow] = useState<TranscriptFollowState>({ following: true, showReturnToBottom: false });
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsHelpOpen, setSettingsHelpOpen] = useState(false);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);
  // 中文注释：外部预览请求 — 从对话条目点击"预览"时驱动右侧文件面板加载该文件
  // — Chinese: external preview request — drives right file panel to load a file when "preview" is clicked from chat
  const [previewRequest, setPreviewRequest] = useState<ExternalPreviewRequest | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const taskRuntimeMonitor = useTaskRuntimeMonitor();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [keyStates, setKeyStates] = useState<ApiKeyState[]>([]), [modelPresets, setModelPresets] = useState<ModelPreset[]>([]), [skillsList, setSkillsList] = useState<SkillEntry[]>([]);
  const [mcps, setMcps] = useState<McpConfig[]>(() => normalizeStoredMcps(readStored('nexus.mcps', defaultMcps)));
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]), [mcpHydrated, setMcpHydrated] = useState(false), [pendingMcpDraft, setPendingMcpDraft] = useState<McpConfig | null>(null);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null), [dialog, setDialog] = useState<AppDialogState | null>(null), [weixinConnectState, setWeixinConnectState] = useState<WeixinLoginState | null>(null);
  const eventCounter = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeTurnThreadIdRef = useRef<string>('');
  const threadLoadGuardRef = useRef(createLatestRequestGuard());
  const sendMessageGuardRef = useRef(createLatestRequestGuard());
  const threadEventSourceGenerationRef = useRef(0);
  const isWorkflowView = workspaceView === 'workflow';
  const { rightPaneGridTemplateColumns, startRightPaneResize } = useRightPaneSizing(rightPaneVisible, isWorkflowView ? 'workflow' : 'standard');
  const { toast, showToast } = useToastNotice();
  const { botConfig, botStatus, bindRemoteAssistant, refreshBotStatus, saveBotConfig, connectWeixin, logoutWeixin, startDingtalkStream, stopDingtalkStream, testDingtalkMessage } = useBotControls();
  const { applyWebProviderState, clearWebProviderKey, saveWebProviderKey, webProviderState } = useWebProviderSettings();
  const activeThread = threads.find((thread) => thread.threadId === threadId);
  const activeWorkflow = useMemo(() => parseThreadWorkflow(activeThread) ?? parseWorkflowCheckpointItems(items), [activeThread, items]); const workflowTitle = isWorkflowView ? (config.locale === 'zh' ? '未命名工作流项目' : 'Untitled workflow project') : '';
  function resetWorkflowState() { setWorkflowPlanDraft(null); setWorkflowComponents([]); setWorkflowBlueprint(null); setWorkflowSelectedNodeIds([]); }
  const apiConfig = useMemo(() => {
    const patch: Partial<RunConfig> = {};
    for (const key of Object.keys(config) as Array<keyof RunConfig>) {
      const value = config[key];
      if (value !== '' && value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
    return patch;
  }, [config]);
  const threadApiConfig = useMemo(() => {
    const { themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = apiConfig;
    void themeMode;
    void userAvatarId;
    void customUserAvatarDataUrl;
    return threadConfig;
  }, [apiConfig]);
  const transcriptGroups = useMemo(() => groupTranscriptItems(items, turns), [items, turns]);
  const latestRollbackTurnId = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.type === 'user_message' && item.turnId && item.status !== 'in_progress') {
        return item.turnId;
      }
    }
    return undefined;
  }, [items]);
  const subagentRows = useMemo(() => buildSubagentStatusRows(threadChildren, config.locale), [config.locale, threadChildren]);
  void subagentRows; // 保留以维持现有 import；新工作台直接消费 threadChildren
  // Agent 工作台直接消费 threadChildren + runtimeItems + busy，不再需要 buildAgentStageRows 派生
  const activeWorkspaceRoot = activeThread?.tags?.conversationKind === 'chat' ? '' : (activeThread?.workspaceRoot || config.workspaceRoot || '');
  const childActivityByThread = useMemo(() => buildChildActivityByThread(threadChildren), [threadChildren]);
  const tokenUsage = useMemo(() => {
    return buildTokenUsageSummary(threadUsage, config.locale);
  }, [config.locale, threadUsage]);
  const cacheSummary = useMemo(() => formatCacheDiagnostics(cacheDiagnostics, config.locale), [cacheDiagnostics, config.locale]);
  const pressureSummary = useMemo(() => formatCompactionPressure(compactionPressure, config.locale), [compactionPressure, config.locale]);
  const lastItemSignature = useMemo(() => {
    const last = items[items.length - 1];
    if (!last) return '';
    return [
      last.id,
      last.type,
      last.status ?? '',
      last.text ?? '',
      last.toolName ?? '',
      JSON.stringify(last.result ?? last.error ?? ''),
    ].join('\n');
  }, [items]);
  const openRemoteAssistants = useCallback((platform: 'weixin' | 'dingtalk') => {
    const targetThreadId = threadId || undefined;
    void (async () => {
      if (platform === 'weixin') {
        await connectWeixin(targetThreadId, setWeixinConnectState);
        return;
      }
      const dingtalkConfigured = Boolean(botConfig?.dingtalk.enabled && botConfig.dingtalk.clientId && botConfig.dingtalk.clientSecret)
        || botStatus?.dingtalk?.configured === true;
      if (!dingtalkConfigured) {
        setWeixinConnectState({ dialogTitle: '绑定钉钉远程助手', polling: false, error: '请先在设置中配置钉钉机器人。' });
        return;
      }
      if (!targetThreadId) {
        setWeixinConnectState({ dialogTitle: '绑定钉钉远程助手', polling: false, error: '请先选择一个对话再绑定钉钉。' });
        return;
      }
      const bound = await bindRemoteAssistant('dingtalk', targetThreadId);
      setWeixinConnectState({
        dialogTitle: '绑定钉钉远程助手',
        polling: false,
        message: bound ? '钉钉已绑定到当前对话。' : undefined,
        error: bound ? undefined : '钉钉绑定当前对话失败。',
        successTitle: '钉钉已绑定',
      });
    })();
  }, [bindRemoteAssistant, botConfig?.dingtalk.clientId, botConfig?.dingtalk.clientSecret, botConfig?.dingtalk.enabled, botStatus?.dingtalk?.configured, connectWeixin, threadId]);
  const slashVisible = workspaceView !== 'workflow' && !activeSlashOption && isSlashInput(input) && !busy && images.length === 0;
  const slashCommandOptions = useMemo<PaletteOption[]>(() => getSlashCommandOptions(config.locale), [config.locale]);
  const filteredSlashOptions = useMemo<PaletteOption[]>(() => {
    if (!slashVisible) return [];
    const trimmed = input.trim().toLowerCase();
    if (trimmed.startsWith('/skills') && !trimmed.startsWith('/skills add')) {
      const query = trimmed.replace(/^\/skills/, '').trim();
      return skillsList
        .filter((skill) => {
          const text = [
            skill.name,
            skill.description,
            localizedSkillDescription(skill, config.locale),
          ].join('\n').toLowerCase();
          return !query || text.includes(query);
        })
        .map((skill) => ({
          id: `skill:${skill.name}`,
          command: `$${skill.name}`,
          title: skill.name,
          detail: localizedSkillDescription(skill, config.locale),
          action: 'insert_skill' as const,
          skillName: skill.name,
          hideCommand: true as const,
        }));
    }
    if (trimmed.startsWith('/mcp') && !trimmed.startsWith('/mcp add')) {
      const query = trimmed.replace(/^\/mcp/, '').trim();
      return mcps
        .filter((mcp) => {
          const text = [mcp.name, mcp.command, mcp.args].join('\n').toLowerCase();
          return !query || text.includes(query);
        })
        .map((mcp) => ({
          id: `mcp:${mcp.id}`,
          command: mcp.enabled
            ? (config.locale === 'zh' ? '已启用' : 'Enabled')
            : (config.locale === 'zh' ? '启用' : 'Enable'),
          title: mcp.name,
          detail: `${mcp.command} ${mcp.args}`.trim(),
          action: 'enable_mcp' as const,
          mcpId: mcp.id,
          hideCommand: true as const,
        }));
    }
    const query = input.slice(1).trim().toLowerCase();
    if (!query) return slashCommandOptions;
    return slashCommandOptions.filter((option) => (
      option.command.toLowerCase().includes(query)
      || option.title.toLowerCase().includes(query)
      || option.detail.toLowerCase().includes(query)
    ));
  }, [config.locale, input, mcps, skillsList, slashCommandOptions, slashVisible]);
  const addEvent = useCallback((event: EventDraft) => {
    eventCounter.current += 1;
    setEvents((current) => {
      const displayKey = [event.kind, event.title, event.detail, event.tone].join('\n');
      const next = {
        id: eventCounter.current,
        key: event.key ?? displayKey,
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        tone: event.tone,
        timestamp: new Date().toISOString(),
      };
      const existingIndex = current.findIndex((item) => {
        if (item.key === next.key) return true;
        return [item.kind, item.title, item.detail, item.tone].join('\n') === displayKey;
      });
      if (existingIndex >= 0) {
        const updated = current.map((item, index) => (index === existingIndex ? { ...item, ...next } : item));
        return [updated[existingIndex], ...updated.filter((_, index) => index !== existingIndex)].slice(0, 80);
      }
      return [next, ...current].slice(0, 80);
    });
  }, []);
  const runMonitor = useRunMonitor({ threadId, locale: config.locale, addEvent });
  const monitorButtonActive = runMonitor.open;
  const openUnifiedMonitor = useCallback(() => {
    runMonitor.openDrawer();
  }, [runMonitor]);

  const workbenchCurrentRunId = useMemo(() => {
    if (runMonitor.selectedRunId) return runMonitor.selectedRunId;
    const runningRun = runMonitor.runs.find(r => r.threadId === threadId && r.status === 'running');
    return runningRun?.runId ?? runMonitor.runs.find(r => r.threadId === threadId)?.runId;
  }, [runMonitor.selectedRunId, runMonitor.runs, threadId]);

  const workbenchSelectedRun = useMemo(() => {
    return runMonitor.runs.find(r => r.runId === workbenchCurrentRunId) ?? null;
  }, [runMonitor.runs, workbenchCurrentRunId]);

  const workbenchTraceSummary = useMemo(() => {
    if (!workbenchSelectedRun) return null;
    const traces = runMonitor.traces;
    const modelCalls = traces.filter(t => t.category === 'model' && t.lifecycle !== 'started').length;
    const toolCalls = traces.filter(t => t.category === 'tool' && t.lifecycle !== 'started').length;
    const toolFailed = traces.filter(t => t.category === 'tool' && t.lifecycle === 'failed').length;
    const toolDenied = traces.filter(t => t.category === 'tool' && (t.payload as { decision?: string }).decision === 'deny').length;
    const errorTraces = traces.filter(t => t.category === 'error' || t.level === 'error');
    const lastError = errorTraces[errorTraces.length - 1];
    const checkpointTraces = traces.filter(t => t.category === 'checkpoint' && t.lifecycle === 'completed');
    const lastCheckpoint = checkpointTraces[checkpointTraces.length - 1];
    const runningSpan = traces.filter(t => t.lifecycle === 'started' && !traces.some(t2 => t2.spanId === t.spanId && t2.lifecycle !== 'started')).pop();
    const modelTraces = traces.filter(t => t.category === 'model' && t.lifecycle !== 'started') as Array<{ payload: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; ttftMs?: number } }>;
    const totalInput = modelTraces.reduce((s, t) => s + (t.payload.inputTokens ?? 0), 0);
    const totalOutput = modelTraces.reduce((s, t) => s + (t.payload.outputTokens ?? 0), 0);
    const totalCacheRead = modelTraces.reduce((s, t) => s + (t.payload.cacheReadTokens ?? 0), 0);
    const totalCacheWrite = modelTraces.reduce((s, t) => s + (t.payload.cacheWriteTokens ?? 0), 0);
    const maxTtft = Math.max(...modelTraces.map(t => t.payload.ttftMs ?? 0), 0);
    return {
      status: workbenchSelectedRun.status === 'blocked' ? 'running' : workbenchSelectedRun.status,
      startedAt: workbenchSelectedRun.startedAt,
      completedAt: workbenchSelectedRun.completedAt ?? undefined,
      durationMs: workbenchSelectedRun.completedAt
        ? new Date(workbenchSelectedRun.completedAt).getTime() - new Date(workbenchSelectedRun.startedAt).getTime()
        : Date.now() - new Date(workbenchSelectedRun.startedAt).getTime(),
      currentSpan: runningSpan ? { spanId: runningSpan.spanId, category: runningSpan.category, name: runningSpan.name } : undefined,
      model: {
        calls: modelCalls || workbenchSelectedRun.modelCallCount,
        inputTokens: totalInput || workbenchSelectedRun.inputTokens,
        outputTokens: totalOutput || workbenchSelectedRun.outputTokens,
        cacheReadTokens: totalCacheRead || workbenchSelectedRun.cachedInputTokens,
        cacheWriteTokens: totalCacheWrite,
        maxTtftMs: maxTtft > 0 ? maxTtft : undefined,
      },
      tools: { calls: toolCalls || workbenchSelectedRun.toolCallCount, failed: toolFailed, denied: toolDenied },
      items: { started: 0, completed: 0, failed: 0, byType: {} },
      agents: { spawned: workbenchSelectedRun.subagentCount, running: 0, failed: 0 },
      files: { changed: 0, addedLines: 0, removedLines: 0 },
      lastError: lastError && lastError.category === 'error'
        ? { code: (lastError.payload as { code?: string })?.code ?? 'ERROR', message: (lastError.payload as { message?: string })?.message ?? lastError.name }
        : (workbenchSelectedRun.error ? { code: 'RUN_ERROR', message: workbenchSelectedRun.error } : undefined),
      lastCheckpointId: lastCheckpoint ? (lastCheckpoint.payload as { checkpointId?: string })?.checkpointId : undefined,
    };
  }, [workbenchSelectedRun, runMonitor.traces]);

  const jumpToMonitor = useCallback((opts: { runId?: string; eventId?: string; itemId?: string; threadId?: string }) => {
    const { runId, eventId, itemId, threadId } = opts;
    if (itemId && !runId && !eventId && !threadId) {
      const target = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('itemJumpHighlight');
        setTimeout(() => target.classList.remove('itemJumpHighlight'), 1800);
        return;
      }
    }
    runMonitor.openDrawer();
    if (threadId) {
      runMonitor.toggleThread(threadId);
    }
    let targetRunId = runId;
    if (targetRunId) {
      runMonitor.selectRun(targetRunId);
    } else if (threadId) {
      const runForThread = runMonitor.runs.find(r => r.threadId === threadId && r.status === 'running')
        ?? runMonitor.runs.find(r => r.threadId === threadId);
      if (runForThread) {
        runMonitor.selectRun(runForThread.runId);
        targetRunId = runForThread.runId;
      }
    }
    if (eventId) {
      setTimeout(() => runMonitor.selectEvent(eventId), 300);
    }
    if (itemId) {
      setTimeout(() => runMonitor.selectByItemId(itemId), 500);
    }
  }, [runMonitor]);

  const handleControlInterrupt = useCallback(() => {
    if (workbenchSelectedRun) {
      void runMonitor.controlRun('interrupt', workbenchSelectedRun);
    } else {
      void stopTurn();
    }
  }, [runMonitor, workbenchSelectedRun]);

  const handleControlResume = useCallback(() => {
    if (workbenchSelectedRun) {
      void runMonitor.controlRun('resume', workbenchSelectedRun);
    }
  }, [runMonitor, workbenchSelectedRun]);

  const handleControlRollback = useCallback((checkpointId?: string) => {
    if (workbenchSelectedRun) {
      void runMonitor.controlRun('rollback', workbenchSelectedRun, { checkpointId });
    } else {
      void threadAction('rollback', 1);
    }
  }, [runMonitor, workbenchSelectedRun]);

  const [responsiveMode, setResponsiveMode] = useState<'side' | 'overlay' | 'sheet'>('side');
  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      if (w >= 1180) setResponsiveMode('side');
      else if (w >= 768) setResponsiveMode('overlay');
      else setResponsiveMode('sheet');
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const handleCloseWorkbench = useCallback(() => {
    setRightPaneVisible(false);
  }, []);

  const mergeApproval = useCallback((approval: ApprovalRequest) => {
    setPendingApprovals((current) =>
      current.some((item) => item.requestId === approval.requestId) ? current : [...current, approval],
    );
  }, []);
  const refreshThreads = useCallback(async () => {
    const response = await fetch('/api/threads');
    const data = (await response.json()) as { threads: ThreadMeta[] };
    setThreads(data.threads ?? []);
  }, []);
  const refreshApprovals = useCallback(async () => {
    const response = await fetch('/api/approvals');
    if (!response.ok) return;
    const data = (await response.json()) as { approvals?: ApprovalRequest[] };
    setPendingApprovals(data.approvals ?? []);
  }, []);
  const refreshProviders = useCallback(async () => {
    const [providerResponse, keyResponse] = await Promise.all([
      fetch('/api/providers'),
      fetch('/api/keys'),
    ]);
    if (providerResponse.ok) {
      const data = (await providerResponse.json()) as { providers?: ProviderEntry[] };
      setProviders(data.providers ?? []);
    }
    if (keyResponse.ok) {
      const data = (await keyResponse.json()) as { keys?: ApiKeyState[] };
      setKeyStates(data.keys ?? []);
    }
  }, []);
  // P2.3 单独刷新 keyStates：保存 preset 后用于 server truth reconcile
  const refreshKeyStates = useCallback(async () => {
    const response = await fetch('/api/keys');
    if (!response.ok) return;
    const data = (await response.json()) as { keys?: ApiKeyState[] };
    setKeyStates(data.keys ?? []);
  }, []);
  const refreshModelPresets = useCallback(async () => {
    const response = await fetch('/api/model-presets');
    if (!response.ok) return;
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }, []);
  const refreshSkills = useCallback(async (options: { forceReload?: boolean } = {}) => {
    const response = await fetch(options.forceReload ? '/api/skills?forceReload=1' : '/api/skills');
    if (!response.ok) return;
    const data = (await response.json()) as { skills?: SkillEntry[] };
    setSkillsList(data.skills ?? []);
  }, []);
  const refreshMcpStatus = useCallback(async (detail: 'light' | 'full' = 'light') => {
    try {
      const response = await fetch(detail === 'full' ? '/api/mcp/status?detail=full' : '/api/mcp/status');
      if (!response.ok) return;
      const data = (await response.json()) as { servers?: McpServerStatus[] };
      setMcpStatuses(data.servers ?? []);
    } catch (error) {
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? 'MCP 状态刷新失败' : 'MCP status refresh failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    }
  }, [addEvent, config.locale]);
  const refreshThreadChildren = useCallback(async (id: string) => {
    if (!id) return setThreadChildren([]);
    const response = await fetch(`/api/threads/${id}/children?recursive=1`);
    if (!response.ok) return setThreadChildren([]);
    const data = (await response.json()) as { children?: ThreadChildInfo[] };
    setThreadChildren(data.children ?? []);
  }, []);
  const reloadThreadSnapshot = useCallback(async (id: string, guard?: { signal?: AbortSignal; isCurrent: () => boolean }) => {
    let response: Response;
    try {
      response = await fetch(`/api/threads/${id}?includeChildren=1`, guard?.signal ? { signal: guard.signal } : undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
    if (!response.ok) return;
    if (guard && !guard.isCurrent()) return;
    const data = (await response.json()) as {
      thread?: ThreadMeta;
      turns?: TurnMeta[];
      items: ThreadItem[];
      config?: Partial<RunConfig>;
      usage?: ThreadUsage;
    };
    if (guard && !guard.isCurrent()) return;
    if (data.thread) {
      setThreads((current) => current.map((thread) => thread.threadId === id ? data.thread! : thread));
    }
    setTurns(data.turns ?? []);
    setThreadUsage(data.usage ?? null);
    setRunningTurnIds(new Set((data.turns ?? [])
      .filter((turn) => turn.status === 'running')
      .map((turn) => turn.turnId)));
    setItems(withSyntheticUserMessages(data.turns ?? [], data.items ?? []) as ThreadItem[]);
    if (data.config) {
      const { workspaceRoot, themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = data.config;
      void themeMode;
      void userAvatarId;
      void customUserAvatarDataUrl;
      setConfig((current) => ({
        ...current,
        ...threadConfig,
        ...(workspaceRoot ? { workspaceRoot } : {}),
      }));
    }
    if (guard && !guard.isCurrent()) return;
    try {
      const workflowData = await loadThreadWorkflow(id);
      if (guard && !guard.isCurrent()) return;
      setWorkflowComponents(workflowData.components ?? []);
      setWorkflowBlueprint(workflowData.blueprint ?? null);
    } catch {
      if (guard && !guard.isCurrent()) return;
      setWorkflowComponents([]);
      setWorkflowBlueprint(null);
    }
    if (guard && !guard.isCurrent()) return;
    await refreshThreadChildren(id);
  }, [refreshThreadChildren]);
  const requestWorkflowPlan = useCallback(async (goal: string) => {
      const trimmedGoal = goal.trim();
      if (!trimmedGoal) return;
      const draftTurnId = `workflow_draft_${Date.now()}`;
      const persistTranscript = Boolean(threadId);
      if (!persistTranscript) setItems((current) => mergeIncomingItems(current, [createWorkflowDraftUserItem(trimmedGoal, draftTurnId)]) as ThreadItem[]);
      setWorkflowPlanning(true);
      try {
      const editableWorkflow = activeWorkflow && activeWorkflow.definition.nodes.length > 0 ? activeWorkflow : null;
      const selectedScope = editableWorkflow?.definition.nodes.filter((node) => workflowSelectedNodeIds.includes(node.id)).map((node) => `${node.id}（${node.title}）`).join('、') ?? '';
      const effectiveGoal = editableWorkflow ? `${editableWorkflow.definition.goal}${selectedScope ? `\n\n修改范围：${selectedScope}` : ''}\n\n修改要求：${trimmedGoal}` : trimmedGoal;
      const draft = await planWorkflowDraft(effectiveGoal, threadId || undefined);
      setWorkflowPlanDraft(draft); setWorkflowComponents(draft.components); setWorkflowBlueprint(draft.blueprint ?? null);
      const nextItems = draft.items?.length ? draft.items : [createWorkflowDraftReplyItem(draft, config.locale, draftTurnId)];
      setItems((current) => mergeIncomingItems(current, nextItems) as ThreadItem[]);
      if (threadId && isUntitledWorkflowProjectTitle(activeThread?.title)) void renameConversation(threadId, workflowThreadTitleFromGoal(draft.workflow.definition.goal, config.locale === 'zh' ? '未命名工作流项目' : 'Untitled workflow project')).catch(() => undefined);
      if (threadId) void refreshThreads();
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '计划草案已生成' : 'Plan draft ready', detail: draft.workflow.definition.goal, tone: 'success' });
    } catch (error) {
      setItems((current) => mergeIncomingItems(current, [createWorkflowDraftErrorItem(error instanceof Error ? error.message : String(error), config.locale, draftTurnId)]) as ThreadItem[]);
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '计划生成失败' : 'Plan failed', detail: error instanceof Error ? error.message : String(error), tone: 'danger' });
    } finally { setWorkflowPlanning(false); }
  }, [activeThread?.title, activeWorkflow, addEvent, config.locale, refreshThreads, threadId, workflowSelectedNodeIds]);
  const commitWorkflowPlan = useCallback(async () => {
    if (!workflowPlanDraft) return;
    setWorkflowSaving(true);
    try {
      let targetThreadId = threadId;
      if (!targetThreadId) {
        const thread = await createWorkflowThread(workflowPlanDraft.goal, config.workspaceRoot);
        targetThreadId = thread.threadId; setThreadId(targetThreadId);
        await refreshThreads();
      }
      const data = await saveThreadWorkflow(targetThreadId, workflowPlanDraft.workflow);
      if (data.thread) setThreads((current) => current.some((thread) => thread.threadId === targetThreadId)
        ? current.map((thread) => thread.threadId === targetThreadId ? data.thread! : thread)
        : [data.thread!, ...current]);
      setWorkflowComponents(data.components ?? workflowPlanDraft.components); setWorkflowBlueprint(data.blueprint ?? workflowPlanDraft.blueprint ?? null); setWorkflowPlanDraft(null);
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '计划已保存' : 'Plan saved', detail: data.workflow?.definition.goal ?? workflowPlanDraft.goal, tone: 'success' });
    } catch (error) {
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '保存失败' : 'Save failed', detail: error instanceof Error ? error.message : String(error), tone: 'danger' });
    } finally { setWorkflowSaving(false); }
  }, [addEvent, config.locale, config.workspaceRoot, refreshThreads, threadId, workflowPlanDraft]);
  const saveWorkflow = useCallback(async (workflow: WorkflowSnapshot) => {
    if (!threadId) return;
    setWorkflowSaving(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/workflow`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      });
      const data = (await response.json()) as { thread?: ThreadMeta; workflow?: WorkflowSnapshot; components?: WorkflowComponentDefinition[]; blueprint?: WorkflowBlueprintCompileResult | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Workflow save failed');
      if (data.thread) setThreads((current) => current.map((thread) => thread.threadId === threadId ? data.thread! : thread));
      setWorkflowComponents(data.components ?? []); setWorkflowBlueprint(data.blueprint ?? null);
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '节点已保存' : 'Workflow saved', detail: data.workflow?.definition.goal ?? '', tone: 'success' });
    } catch (error) {
      addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '保存失败' : 'Save failed', detail: error instanceof Error ? error.message : String(error), tone: 'danger' });
    } finally { setWorkflowSaving(false); }
  }, [addEvent, config.locale, threadId]);
  const controlWorkflowRuntime = useCallback(async (action: WorkflowRuntimeAction, nodeId?: string) => { if (!threadId || !activeWorkflow) return; setWorkflowRuntimeBusy(true);
    try { const data = await controlThreadWorkflow(threadId, action, { nodeId, runId: activeWorkflow.run.id, input: { goal: activeWorkflow.definition.goal } }); if (data.thread) setThreads((current) => current.map((thread) => thread.threadId === threadId ? data.thread! : thread)); setWorkflowComponents(data.components ?? workflowComponents); setWorkflowBlueprint(data.blueprint ?? workflowBlueprint); addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '工作流状态已更新' : 'Workflow updated', detail: data.workflow?.run.status ?? action, tone: data.workflow?.run.status === 'failed' ? 'danger' : data.workflow?.run.status === 'blocked' ? 'warning' : 'success' }); if (runMonitor.open) void runMonitor.refresh(runMonitor.selectedRunId || undefined); }
    catch (error) { addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '工作流运行失败' : 'Workflow runtime failed', detail: error instanceof Error ? error.message : String(error), tone: 'danger' }); } finally { setWorkflowRuntimeBusy(false); }
  }, [activeWorkflow, addEvent, config.locale, runMonitor, threadId, workflowBlueprint, workflowComponents]);
  const loadThread = useCallback(
    async (id: string) => {
      if (!id) return;
      const request = threadLoadGuardRef.current.begin();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setThreadId(id);
      setWorkflowPlanDraft(null);
      setEvents([]);
      setCacheDiagnostics(null);
      setCompactionPressure(null);
      taskRuntimeMonitor.clear();
      const isCurrent = () => threadLoadGuardRef.current.isCurrent(request.generation);
      await reloadThreadSnapshot(id, { signal: request.signal, isCurrent });
      if (!isCurrent()) return;
      try {
        const overrides = await fetchThreadConfigOverrides(id);
        if (!isCurrent()) return;
        setConfig((current) => {
          const next = { ...current };
          if (overrides.provider) next.provider = overrides.provider;
          if (overrides.model) next.model = overrides.model;
          if (overrides.baseUrl !== undefined) next.baseUrl = overrides.baseUrl;
          return next;
        });
      } catch {
        if (!isCurrent()) return;
      }
      void (async () => {
        try {
          const response = await fetch(`/api/threads/${id}/context-pressure`, request.signal ? { signal: request.signal } : undefined);
          if (!response.ok) return;
          const data = await response.json() as { pressure?: { estimatedTokens?: number; maxTokens?: number; softThreshold?: number; hardThreshold?: number; ratio?: number; status?: string } };
          if (!isCurrent()) return;
          if (data.pressure) {
            setCompactionPressure(data.pressure as never);
          }
        } catch {
          // 主动查询失败时不阻断，后续 SSE 事件仍可更新
        }
      })();
      const sourceGeneration = request.generation;
      threadEventSourceGenerationRef.current = sourceGeneration;
      const source = new EventSource(authEventSourceUrl(`/api/events/${id}`));
      source.onmessage = (message) => {
        if (!threadLoadGuardRef.current.isCurrent(sourceGeneration)) return;
        try {
          const event = JSON.parse(message.data) as Record<string, unknown>;
          if (event.type === 'connected') return;
          const described = describeEvent(event, config.locale);
          if (described) addEvent(described);
          if (event.type === 'turn.started' && typeof event.turnId === 'string') {
            setRunningTurnIds((current) => new Set([...current, event.turnId as string]));
          }
          if (
            (event.type === 'turn.completed' || event.type === 'turn.failed')
            && typeof event.turnId === 'string'
          ) {
            setRunningTurnIds((current) => {
              const next = new Set(current);
              next.delete(event.turnId as string);
              return next;
            });
            void refreshThreadChildren(id);
            if (runMonitor.open) void runMonitor.refresh(runMonitor.selectedRunId || undefined);
          }
          if (event.type === 'approval.required' && typeof event.requestId === 'string') {
            mergeApproval(event as unknown as ApprovalRequest);
          }
          if (event.type === 'approval.resolved' && typeof event.requestId === 'string') {
            setPendingApprovals((current) => current.filter((item) => item.requestId !== event.requestId));
          }
          if (event.type === 'thread.token_usage.updated' && event.usage) {
            setThreadUsage(event.usage as ThreadUsage);
          }
          if (event.type === 'thread.metadata.updated' && typeof event.threadId === 'string') {
            setThreads((current) =>
              current.map((t) => {
                if (t.threadId !== event.threadId) return t;
                const updated: ThreadMeta = { ...t };
                if (typeof event.title === 'string') updated.title = event.title;
                if (typeof event.status === 'string') updated.status = event.status as ThreadMeta['status'];
                return updated;
              }),
            );
          }
          if (event.type === 'cache.diagnostics') {
            setCacheDiagnostics(event as never);
          }
          if (event.type === 'context.compaction_pressure' && event.pressure) {
            setCompactionPressure(event.pressure as never);
          }
          if (event.type === 'child_agent.event') {
            void refreshThreadChildren(id);
          }
          if (event.type === 'harness.state.updated' && typeof event.harnessRunId === 'string') {
            if ((event.status as string) !== 'active') void refreshThreadChildren(id);
          }
          if (isTaskRuntimeEvent(event)) taskRuntimeMonitor.applyEvent(event);
          if (event.type === 'agent_message.delta') {
            setItems((current) => applyAgentMessageDelta(current, event as never) as ThreadItem[]);
          }
          if (event.type === 'item.discarded' && typeof event.itemId === 'string') {
            const itemId = event.itemId;
            setItems((current) => removeThreadItem(current, itemId) as ThreadItem[]);
          }
          if (
            (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed')
            && event.item
          ) {
            setItems((current) => mergeIncomingItems(current, [event.item as ThreadItem]));
            if ((event.item as ThreadItem).type === 'collab_tool_call') {
              void refreshThreadChildren(id);
            }
          }
        } catch {
          addEvent({
            kind: 'event',
            title: config.locale === 'zh' ? '事件解析失败' : 'Event parse failed',
            detail: message.data,
            tone: 'warning',
          });
        }
      };
      source.onerror = () => {
        if (!threadLoadGuardRef.current.isCurrent(sourceGeneration)) return;
        addEvent({
          kind: 'events',
          title: config.locale === 'zh' ? '连接恢复中' : 'Reconnecting',
          detail: config.locale === 'zh' ? '事件连接断开，正在重新拉取当前对话。' : 'The event stream disconnected; reloading the current thread.',
          tone: 'warning',
        });
        window.setTimeout(() => {
          if (threadLoadGuardRef.current.isCurrent(sourceGeneration)) {
            source.close();
            eventSourceRef.current = null;
            void reloadThreadSnapshot(id, {
              isCurrent: () => threadLoadGuardRef.current.isCurrent(sourceGeneration),
            });
          }
        }, 500);
      };
      eventSourceRef.current = source;
    },
    [addEvent, config.locale, mergeApproval, refreshThreadChildren, reloadThreadSnapshot, runMonitor, taskRuntimeMonitor],
  );
  const selectThreadFromSidebar = useCallback((id: string) => { resetWorkflowState(); setWorkspaceView(isWorkflowProjectThread(threads.find((thread) => thread.threadId === id)) ? 'workflow' : 'chat'); void loadThread(id); }, [loadThread, threads]); const createWorkflowProjectDraft = useCallback(async () => {
    eventSourceRef.current?.close(); eventSourceRef.current = null; setWorkspaceView('workflow'); setTurns([]); setItems([]); setThreadUsage(null); setThreadChildren([]); setRunningTurnIds(new Set());
    setEvents([]); resetWorkflowState(); setStatus(config.locale === 'zh' ? '正在创建工作流项目' : 'Creating workflow project');
    try { const title = config.locale === 'zh' ? '未命名工作流项目' : 'Untitled workflow project'; const thread = await createWorkflowThread(title, config.workspaceRoot); setThreadId(thread.threadId); setThreads((current) => current.some((candidate) => candidate.threadId === thread.threadId) ? current.map((candidate) => candidate.threadId === thread.threadId ? thread : candidate) : [thread, ...current]); setStatus(config.locale === 'zh' ? '准备创建工作流' : 'Ready to plan workflow'); }
    catch (error) { setThreadId(''); setStatus(t(config.locale, 'idle')); addEvent({ kind: 'workflow', title: config.locale === 'zh' ? '创建工作流失败' : 'Workflow create failed', detail: error instanceof Error ? error.message : String(error), tone: 'danger' }); }
  }, [addEvent, config.locale, config.workspaceRoot]);

  useEffect(() => {
    fetch('/api/settings')
      .then((response) => response.json())
      .then((data: { config?: Partial<RunConfig>; stored?: boolean } & SettingsResponseWithWebProvider) => {
        setConfig((current) => {
          if (data.stored || !hasStoredRunConfig) {
            return { ...defaultConfig, ...data.config };
          }
          return mergeRunConfigDefaults(data.config, current);
        });
        applyWebProviderState(data);
        setConfigHydrated(true);
      })
      .catch(() => setConfigHydrated(true));
    void refreshThreads();
    void refreshProviders();
    void refreshModelPresets();
    void refreshSkills();
    void refreshBotStatus();
    fetch('/api/mcp')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { servers?: McpConfig[] } | null) => {
        if (data?.servers) {
          setMcps(normalizeStoredMcps(data.servers));
        }
        setMcpHydrated(true);
        void refreshMcpStatus('light');
      })
      .catch(() => setMcpHydrated(true));
    return () => {
      eventSourceRef.current?.close();
      threadLoadGuardRef.current.dispose();
      sendMessageGuardRef.current.dispose();
    };
  }, [applyWebProviderState, hasStoredRunConfig, refreshBotStatus, refreshMcpStatus, refreshModelPresets, refreshProviders, refreshSkills, refreshThreads]);
  useEffect(() => {
    void refreshApprovals();
    const timer = window.setInterval(() => void refreshApprovals(), 2000);
    return () => window.clearInterval(timer);
  }, [refreshApprovals]);
  useEffect(() => {
    if (!configHydrated) return;
    localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config, configHydrated]);
  useEffect(() => {
    const roots = [config.workspaceRoot, ...threads.map((thread) => thread.workspaceRoot)];
    setRememberedWorkspaceRoots((current) => rememberWorkspaceRoots(current, roots));
  }, [config.workspaceRoot, threads]);
  useEffect(() => {
    if (!mcpHydrated) return;
    void fetch('/api/mcp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: mcps }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { statuses?: McpServerStatus[] } | null) => {
        if (data?.statuses) setMcpStatuses(data.statuses);
      })
      .catch((error) => {
        addEvent({
          kind: 'error',
          title: config.locale === 'zh' ? 'MCP 配置保存失败' : 'MCP config save failed',
          detail: error instanceof Error ? error.message : String(error),
          tone: 'danger',
        });
      });
  }, [addEvent, config.locale, mcpHydrated, mcps]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (!transcriptFollow.following) return;
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  }, [lastItemSignature, transcriptFollow.following]);
  function handleTranscriptScroll() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    setTranscriptFollow((current: TranscriptFollowState) => nextTranscriptFollowState({
      following: current.following,
      distanceFromBottom,
      source: 'user',
    }));
  }
  function handleReturnToBottom() {
    setTranscriptFollow(nextTranscriptFollowState({
      following: false,
      distanceFromBottom: 0,
      source: 'return-action',
    }));
    const transcript = transcriptRef.current;
    if (transcript) {
      requestAnimationFrame(() => {
        transcript.scrollTop = transcript.scrollHeight;
      });
    }
  }
  useEffect(() => { resizeTextareaToContent(composerInputRef.current); }, [activeSlashOption, images.length, input]);
  // 窄屏下窗口变宽时自动收起 sidebar 抽屉 — Chinese: auto-close sidebar drawer when resizing to wide
  useEffect(() => {
    function onResize() { if (window.innerWidth >= 768) setSidebarOpen(false); }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  async function createConversation(workspaceRoot = config.workspaceRoot, conversationKind: 'chat' | 'project' = 'project') {
    setBusy(true);
    setStatus(t(config.locale, 'creating'));
    try {
      const runConfig = { ...threadApiConfig, workspaceRoot: conversationKind === 'chat' ? '' : workspaceRoot };
      if (conversationKind === 'project') {
        setRememberedWorkspaceRoots((current) => rememberWorkspaceRoots(current, [workspaceRoot]));
      }
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t(config.locale, 'untitled'), config: runConfig, conversationKind }),
      });
      const data = (await response.json()) as { thread: ThreadMeta };
      await refreshThreads();
      await loadThread(data.thread.threadId);
      setStatus(t(config.locale, 'ready'));
    } finally { setBusy(false); }
  }
  async function createPlainConversation() {
    await createConversation('', 'chat');
  }
  async function createConversationWithWorkspacePicker() {
    if (busy) return;
    setStatus(workspacePickerStatus(config.locale));
    try {
      const workspaceRoot = await pickWorkspaceRoot(); if (!workspaceRoot) { setStatus(t(config.locale, 'ready')); return; }
      setConfig((current) => ({ ...current, workspaceRoot })); setRememberedWorkspaceRoots((current) => rememberWorkspaceRoots(current, [workspaceRoot]));
      await createConversation(workspaceRoot, 'project');
    } catch (error) {
      setDialog(workspacePickerNotice(config.locale, error)); setStatus(t(config.locale, 'ready'));
    }
  }
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setImages((current) => [...current, { name: file.name || `paste-${Date.now()}.png`, dataUrl }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }
  function addImageFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setImages((current) => [...current, { name: file.name, dataUrl }]);
      };
      reader.readAsDataURL(file);
    }
  }
  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files) return;
    addImageFiles(files);
    event.target.value = '';
  }
  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingImage(false);
    addImageFiles(event.dataTransfer.files);
  }
  function removeImage(index: number) {
    setImages((current) => current.filter((_, i) => i !== index));
  }
  function requestDecisionDialog(options: Omit<Extract<AppDialogState, { kind: 'decision' }>, 'kind' | 'resolve'>) {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...options, kind: 'decision', resolve });
    });
  }
  function requestTextDialog(options: Omit<Extract<AppDialogState, { kind: 'text' }>, 'kind' | 'resolve'>) {
    return new Promise<string | null>((resolve) => {
      setDialog({ ...options, kind: 'text', resolve });
    });
  }
  async function runSlashCommand(command: SlashCommand) {
    switch (command.kind) {
      case 'skills.list':
        setInput('/skills ');
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
        return;
      case 'skills.add':
        {
          const installTargets = extractGitHubSkillInstallUrls(command.args);
          if (installTargets.length > 0) {
            await installSkillsFromGitHub(installTargets, command.args);
          } else {
            await createSkillDraft(command.args);
          }
        }
        return;
      case 'mcp.list':
        setInput('/mcp ');
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
        return;
      case 'mcp.add':
        setInput('');
        setActionBusy(true);
        try {
          const { draft, sourceError } = await resolveMcpDraftFromInput(command.args);
          setPendingMcpDraft(draft);
          setSettingsOpen(true);
          if (sourceError) addEvent({ kind: 'config', title: config.locale === 'zh' ? 'MCP 来源读取失败' : 'MCP source read failed', detail: sourceError, tone: 'warning' });
        } finally {
          setActionBusy(false);
        }
        return;
      case 'web_search.mode':
        setWebSearchMode(command.mode);
        setInput('');
        return;
      case 'compact':
        setInput('');
        if (threadId && !busy && !actionBusy) await threadAction('compact');
        return;
      case 'task.mode':
        if (!command.args.trim()) {
          setInput(`/${command.mode} `);
          window.requestAnimationFrame(() => composerInputRef.current?.focus());
          return;
        }
        await sendMessage(modeInstructionFor(command.mode, config.locale), command.args);
        return;
      case 'none':
        return;
    }
  }
  function selectSlashOption(option: PaletteOption) {
    if (option.action === 'insert_skill') {
      setActiveSlashOption(null);
      setInput(`$${option.skillName} `);
      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
        composerInputRef.current?.setSelectionRange(option.skillName.length + 2, option.skillName.length + 2);
      });
      return;
    }
    if (option.action === 'enable_mcp') {
      const selected = mcps.find((mcp) => mcp.id === option.mcpId);
      setMcps((current) => current.map((mcp) => (
        mcp.id === option.mcpId ? { ...mcp, enabled: true } : mcp
      )));
      setActiveSlashOption(null);
      setInput('');
      addEvent({
        kind: 'config',
        title: config.locale === 'zh' ? 'MCP 已启用' : 'MCP enabled',
        detail: selected?.name ?? option.title,
        tone: 'success',
      });
      return;
    }
    if (option.command.endsWith(' ')) {
      setActiveSlashOption(option);
      setInput('');
      window.requestAnimationFrame(() => composerInputRef.current?.focus());
      return;
    }
    setInput('');
    void runSlashCommand(parseSlashCommand(option.command));
  }
  async function submitComposer() {
    if (workspaceView === 'workflow') {
      const goal = input.trim();
      if (!goal) return;
      setInput('');
      setStatus(config.locale === 'zh' ? '正在更新工作流' : 'Updating workflow');
      await requestWorkflowPlan(goal);
      setStatus(t(config.locale, 'idle'));
      return;
    }
    if (activeSlashOption) {
      if (!input.trim()) return;
      const command = parseSlashCommand(activeSlashOption.command + input);
      setActiveSlashOption(null);
      await runSlashCommand(command);
      return;
    }
    if (slashVisible && images.length === 0) {
      if (filteredSlashOptions.length > 0) {
        const exactOption = filteredSlashOptions.find((option) => option.command.trim() === input.trim());
        selectSlashOption(exactOption ?? filteredSlashOptions[0]);
        return;
      }
      const command = parseSlashCommand(input);
      if (command.kind !== 'none') {
        await runSlashCommand(command);
        return;
      }
    }
    await sendMessage();
  }
  function setWebSearchMode(mode: WebSearchMode) {
    setConfig((current) => ({ ...current, webSearchMode: mode }));
    addEvent({
      kind: 'config',
      title: config.locale === 'zh' ? '联网搜索模式' : 'Web search mode',
      detail: mode,
      tone: 'success',
    });
  }
  async function createSkillDraft(description: string) {
    const text = description.trim();
    if (!text) {
      return;
    }
    setInput('');
    const localDraft = createLocalSkillDraftItems(text, config.locale);
    setItems((current) => mergeIncomingItems(current, localDraft.items));
    setBusy(true);
    setStatus(config.locale === 'zh' ? '生成 Skill 草稿' : 'Drafting skill');
    try {
      const response = await fetch('/api/skills/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text, config: threadApiConfig }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? 'Skill draft failed');
      }
      const data = (await response.json()) as { draft?: SkillDraft; source?: SkillDraft['source']; error?: string };
      if (!data.draft) throw new Error('Skill draft missing');
      setSkillDraft({ ...data.draft, source: data.source, error: data.error });
      setItems((current) => completeLocalSkillDraftItem(
        current,
        localDraft.statusItemId,
        'completed',
        config.locale === 'zh' ? `已生成 Skill 草稿：${data.draft?.name ?? text}` : `Skill draft ready: ${data.draft?.name ?? text}`,
      ));
      setStatus(t(config.locale, 'idle'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setItems((current) => completeLocalSkillDraftItem(
        current,
        localDraft.statusItemId,
        'failed',
        error instanceof Error ? error.message : String(error),
      ));
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? 'Skill 草稿失败' : 'Skill draft failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }
  async function installSkillsFromGitHub(skillUrls: string[], args: string) {
    const installTargets = skillUrls.map((url) => url.trim()).filter(Boolean);
    const text = args.trim();
    const inputText = `/skills add ${text}`.trim();
    if (!text) return;
    let activeThreadId = threadId;
    const localDraft = createLocalSkillDraftItems(text, config.locale, undefined, 'install');
    setInput('');
    setActiveSlashOption(null);
    setBusy(true);
    setStatus(config.locale === 'zh' ? '安装 Skill' : 'Installing skill');
    try {
      if (!activeThreadId) {
        const threadResponse = await fetch('/api/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: inputText.slice(0, 60), config: threadApiConfig }),
        });
        if (!threadResponse.ok) {
          const error = (await threadResponse.json()) as { error?: string };
          throw new Error(error.error ?? 'Create thread failed');
        }
        const threadData = (await threadResponse.json()) as { thread: ThreadMeta };
        activeThreadId = threadData.thread.threadId;
        await refreshThreads();
        await loadThread(activeThreadId);
      }
      setItems((current) => mergeIncomingItems(current, localDraft.items));
      const response = await fetch(`/api/threads/${activeThreadId}/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText, urls: installTargets, config: threadApiConfig }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? 'Skill install failed');
      }
      const data = (await response.json()) as {
        items?: ThreadItem[];
        installed?: Array<{ name: string; path: string; sourcePath: string }>;
        skillsRoot?: string;
      };
      const installed = data.installed ?? [];
      const detail = installed.length > 0
        ? installed.map((skill) => skill.name).join(', ')
        : text;
      setItems((current) => mergeIncomingItems(removeLocalThreadItems(current, localDraft.items), data.items ?? []));
      await refreshSkills();
      await refreshThreads();
      addEvent({
        kind: 'config',
        title: config.locale === 'zh' ? 'Skill 已安装' : 'Skill installed',
        detail,
        tone: 'success',
      });
      setStatus(t(config.locale, 'idle'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      if (activeThreadId) {
        await loadThread(activeThreadId);
      }
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? 'Skill 安装失败' : 'Skill install failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveSkillDraft(draft: SkillDraft) {
    const response = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error ?? 'Save skill failed');
    }
    setSkillDraft(null);
    addEvent({
      kind: 'config',
      title: config.locale === 'zh' ? 'Skill 已保存' : 'Skill saved',
      detail: draft.name,
      tone: 'success',
    });
    await refreshSkills({ forceReload: true });
  }
  async function deleteSkill(name: string) {
    const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error ?? 'Delete skill failed');
    }
    await refreshSkills({ forceReload: true });
    addEvent({
      kind: 'config',
      title: config.locale === 'zh' ? 'Skill 已删除' : 'Skill removed',
      detail: name,
      tone: 'success',
    });
  }
  async function sendMessage(
    modeInstruction?: string,
    forcedText?: string,
    options: { imagesOverride?: ComposerImage[]; clearComposerImages?: boolean } = {},
  ) {
    const text = (forcedText ?? input).trim();
    const outgoingImages = options.imagesOverride ?? images;
    const hasImages = outgoingImages.length > 0;
    if (!text && !hasImages) return;
    const sendReq = sendMessageGuardRef.current.begin();
    const isSendCurrent = () => sendMessageGuardRef.current.isCurrent(sendReq.generation);
    let activeThreadId = threadId;
    if (!activeThreadId) {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (text || 'Image').slice(0, 60),
          config: { ...threadApiConfig, workspaceRoot: '' },
          conversationKind: 'chat',
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? 'Create thread failed');
      }
      const data = (await response.json()) as { thread: ThreadMeta };
      if (!data.thread?.threadId) throw new Error('Create thread failed');
      activeThreadId = data.thread.threadId;
      if (!isSendCurrent()) return;
      activeTurnThreadIdRef.current = activeThreadId;
      await loadThread(activeThreadId);
      if (!isSendCurrent()) return;
      await refreshThreads();
      if (!isSendCurrent()) return;
    }
    setBusy(true);
    activeTurnThreadIdRef.current = activeThreadId;
    setInput('');
    const sentImages = [...outgoingImages];
    if (options.clearComposerImages ?? !options.imagesOverride) setImages([]);
    setStatus(t(config.locale, 'running'));
    const pendingUserItem: ThreadItem = {
      id: `pending_user_${Date.now()}`,
      type: 'user_message',
      text: text || (config.locale === 'zh' ? '见附件图片。' : 'See attached image(s).'),
      status: 'in_progress',
      timestamp: new Date().toISOString(),
    };
    if (!isSendCurrent()) {
      setBusy(false);
      activeTurnThreadIdRef.current = '';
      return;
    }
    setItems((current) => mergeIncomingItems(current, [pendingUserItem]));
    try {
      const body: Record<string, unknown> = { input: text || 'See attached image(s).', config: threadApiConfig };
      if (modeInstruction) body.modeInstruction = modeInstruction;
      if (sentImages.length > 0) {
        body.images = sentImages.map((img) => ({ name: img.name, dataUrl: img.dataUrl }));
      }
      const response = await fetch(`/api/threads/${activeThreadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: sendReq.signal,
      });
      if (!isSendCurrent()) return;
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? 'Turn failed');
      }
      const data = (await response.json()) as { items: ThreadItem[] };
      if (!isSendCurrent()) return;
      setItems((current) => mergeIncomingItems(current, data.items ?? []));
      setRunningTurnIds(new Set());
      await refreshThreads();
      if (!isSendCurrent()) return;
      setStatus(t(config.locale, 'idle'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!isSendCurrent()) return;
      setStatus(error instanceof Error ? error.message : String(error));
      if (activeThreadId) {
        await loadThread(activeThreadId);
      }
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '发送失败' : 'Send failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      if (isSendCurrent()) {
        setBusy(false);
        activeTurnThreadIdRef.current = '';
      }
    }
  }
  async function stopTurn() {
    const targetThreadId = activeTurnThreadIdRef.current || threadId; if (!targetThreadId) return;
    setBusy(false);
    setRunningTurnIds(new Set());
    setStatus(config.locale === 'zh' ? '已停止' : 'Interrupted');
    showToast(config.locale === 'zh' ? '已请求停止当前回复' : 'Stop requested');
    try {
      const response = await fetch(`/api/threads/${targetThreadId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: threadApiConfig }),
      });
      const data = (await response.json()) as { interrupted?: boolean };
      if (!response.ok || !data.interrupted) {
        await reloadThreadSnapshot(targetThreadId);
      }
    } catch {
      await reloadThreadSnapshot(targetThreadId);
    } finally {
      setBusy(false);
      setRunningTurnIds(new Set());
      addEvent({
        kind: 'interrupt',
        title: config.locale === 'zh' ? '已停止' : 'Interrupted',
        detail: config.locale === 'zh' ? '当前回复已请求中断。' : 'The current turn was interrupted.',
        tone: 'warning',
      });
    }
  }
  async function decideApproval(requestId: string, approved: boolean) {
    const response = await fetch(`/api/approvals/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved,
        reason: approved ? 'approved from web' : 'denied from web',
      }),
    });
    if (response.ok) {
      setPendingApprovals((current) => current.filter((item) => item.requestId !== requestId));
    }
  }
  async function threadAction(action: 'compact' | 'fork' | 'rollback', count = 1) {
    if (!threadId || busy || actionBusy) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: threadApiConfig, count }),
      });
      const data = await response.json();
      addEvent({
        kind: action,
        title: actionTitle(action, config.locale),
        detail: actionDetail(action, data, config.locale),
        tone: response.ok ? 'success' : 'danger',
      });
      if (action === 'fork' && data.thread?.threadId) {
        await refreshThreads();
        await loadThread(data.thread.threadId);
      } else {
        await loadThread(threadId);
      }
    } finally {
      setActionBusy(false);
    }
  }
  function rollbackToTurn(turnId: string) {
    if (turnId !== latestRollbackTurnId) return;
    const count = rollbackCountForTurn(turnId, turns, items);
    const userText = items.find((item) => item.type === 'user_message' && item.turnId === turnId)?.text;
    if (userText) {
      setInput(userText);
      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
        resizeTextareaToContent(composerInputRef.current);
      });
    }
    void threadAction('rollback', count);
  }
  async function regenerateFromTurn(turnId: string) {
    if (!threadId || busy || actionBusy || turnId !== latestRollbackTurnId) return;
    const userText = items.find((item) => item.type === 'user_message' && item.turnId === turnId)?.text?.trim();
    if (!userText) return;
    const count = rollbackCountForTurn(turnId, turns, items);
    setActionBusy(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: threadApiConfig, count }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? 'Rollback failed');
      addEvent({
        kind: 'rollback',
        title: config.locale === 'zh' ? '正在重新回答' : 'Regenerating response',
        detail: config.locale === 'zh' ? '已回退最近一轮，正在重新发送。' : 'Rolled back the latest turn and is sending it again.',
        tone: 'success',
      });
      await loadThread(threadId);
      setActionBusy(false);
      await sendMessage(undefined, userText, { imagesOverride: [], clearComposerImages: false });
    } catch (error) {
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '重新回答失败' : 'Regenerate failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      setActionBusy(false);
    }
  }
  async function branchFromTurn(turnId: string) {
    if (!threadId) return;
    const index = turns.findIndex((turn) => turn.turnId === turnId);
    const trailingTurns = index >= 0 ? Math.max(0, turns.length - index - 1) : 0;
    setBusy(true);
    try {
      const forkResponse = await fetch(`/api/threads/${threadId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: threadApiConfig }),
      });
      const forkData = await forkResponse.json() as { thread?: ThreadMeta };
      const nextThreadId = forkData.thread?.threadId;
      if (!forkResponse.ok || !nextThreadId) throw new Error('Fork failed');
      if (trailingTurns > 0) {
        await fetch(`/api/threads/${nextThreadId}/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: trailingTurns }),
        });
      }
      await refreshThreads();
      await loadThread(nextThreadId);
      addEvent({
        kind: 'fork',
        title: actionTitle('fork', config.locale),
        detail: config.locale === 'zh' ? '已从这条回复创建分支对话。' : 'A branch was created from this reply.',
        tone: 'success',
      });
    } catch (error) {
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '分支失败' : 'Branch failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }
  async function copyMessage(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(config.locale === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard');
      addEvent({
        kind: 'copy',
        title: config.locale === 'zh' ? '已复制' : 'Copied',
        detail: config.locale === 'zh' ? '消息内容已复制到剪贴板。' : 'Message copied to clipboard.',
        tone: 'success',
      });
    } catch (error) {
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '复制失败' : 'Copy failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    }
  }
  // 中文注释：点击工具条目"预览"按钮 → 切换右侧栏到文件标签并驱动预览
  // — Chinese: clicking "preview" on a tool item switches the right panel to Files tab and drives preview
  function previewFileFromItem(path: string) {
    if (!path) return;
    setPreviewRequest({ path, pin: true, nonce: Date.now() });
  }
  // 中文注释：点击工具条目"打开"按钮 → 调用 Tauri 在系统编辑器中打开
  // — Chinese: clicking "open" on a tool item invokes Tauri to open in system editor
  async function openFileFromItem(path: string) {
    if (!path) return;
    const ok = await openInSystemEditor(path);
    if (!ok) {
      showToast(config.locale === 'zh' ? '无法打开文件，仅桌面端支持。' : 'Unable to open file (desktop only).');
    }
  }
  async function deleteConversation(id: string) {
    if (!id) return;
    const accepted = await requestDecisionDialog({
      title: t(config.locale, 'deleteConversation'),
      message: config.locale === 'zh' ? '此操作会删除这个对话和本地记录。' : 'This will delete the chat and its local records.',
      actionLabel: t(config.locale, 'remove'),
      cancelLabel: t(config.locale, 'cancel'),
      tone: 'danger',
    });
    if (!accepted) return;
    const previousThreads = threads;
    const previousThreadId = threadId;
    const nextState = optimisticDeleteThread(threads, id, threadId);
    setThreads(nextState.threads);
    if (id === threadId) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setBusy(false);
      setStatus(t(config.locale, 'idle'));
      resetWorkflowState();
      const nextThread = nextState.threads.find((thread) => thread.threadId === nextState.nextThreadId);
      setWorkspaceView(isWorkflowProjectThread(nextThread) ? 'workflow' : 'chat');
      if (nextState.nextThreadId) {
        setThreadId(nextState.nextThreadId);
        setTurns([]);
        setItems([]);
        setThreadUsage(null);
        setEvents([]);
        void loadThread(nextState.nextThreadId);
      } else {
        setThreadId('');
        setTurns([]);
        setItems([]);
        setThreadUsage(null);
        setEvents([]);
      }
    }
    try {
      const response = await fetch(`/api/threads/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      await refreshThreads();
      await refreshBotStatus();
    } catch (error) {
      setThreads(previousThreads);
      if (previousThreadId) {
        await loadThread(previousThreadId);
      }
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '删除失败' : 'Delete failed',
        detail: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    }
  }
  async function renameConversation(id: string, title: string) {
    const response = await fetch(`/api/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    const data = (await response.json().catch(() => ({}))) as { thread?: ThreadMeta; error?: string };
    if (!response.ok || !data.thread) throw new Error(data.error ?? 'Rename failed');
    setThreads((current) => current.map((thread) => thread.threadId === id ? data.thread! : thread));
  }
  async function toggleThreadMemoryExcluded(excluded: boolean) {
    if (!threadId) return;
    const response = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: { memoryExcluded: excluded ? 'true' : 'false' } }),
    });
    const data = (await response.json().catch(() => ({}))) as { thread?: ThreadMeta; error?: string };
    if (!response.ok || !data.thread) {
      addEvent({
        kind: 'error',
        title: config.locale === 'zh' ? '记忆设置失败' : 'Memory setting failed',
        detail: data.error ?? 'Unable to update thread memory setting',
        tone: 'danger',
      });
      return;
    }
    setThreads((current) => current.map((thread) => thread.threadId === threadId ? data.thread! : thread));
  }
  // P2.3 拆分：requestModelPresetName 单独询问名称，saveModelPreset 只负责 POST
  async function requestModelPresetName(defaultName: string): Promise<string | null> {
    const name = await requestTextDialog({
      title: t(config.locale, 'saveModelPreset'),
      value: defaultName,
      actionLabel: t(config.locale, 'save'),
      cancelLabel: t(config.locale, 'cancel'),
    });
    if (name === null) return null;
    return name.trim() || defaultName;
  }
  async function saveModelPreset(name: string, presetConfig: ModelPresetConfig): Promise<void> {
    const response = await fetch('/api/model-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config: presetConfig }),
    });
    if (!response.ok) throw new Error('Model preset save failed');
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }
  async function deleteModelPreset(presetId: string): Promise<void> {
    const response = await fetch(`/api/model-presets/${encodeURIComponent(presetId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Model preset delete failed');
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }
  function applyModelPreset(preset: ModelPreset) {
    setConfig((current) => ({ ...current, ...preset.config }));
  }
  async function saveProviderKey(providerId: string, apiKey: string) {
    const response = await fetch(`/api/keys/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (response.ok) {
      const data = (await response.json()) as { keys?: ApiKeyState[] };
      setKeyStates(data.keys ?? []);
    }
  }
  async function clearProviderKey(providerId: string) {
    const response = await fetch(`/api/keys/${providerId}`, { method: 'DELETE' });
    if (response.ok) {
      const data = (await response.json()) as { keys?: ApiKeyState[] };
      setKeyStates(data.keys ?? []);
    }
  }
  async function saveProviderEnvVar(providerId: string, envVar: string) {
    const response = await fetch(`/api/keys/${providerId}/env-var`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envVar }) });
    if (response.ok) {
      const data = (await response.json()) as { keys?: ApiKeyState[] };
      setKeyStates(data.keys ?? []);
    }
  }
  async function saveThreadModelOverrides(overrides: ThreadConfigOverrides): Promise<void> {
    if (!threadId) return;
    await patchThreadConfigOverrides(threadId, overrides);
    setConfig((current) => {
      const next = { ...current };
      if (overrides.provider) next.provider = overrides.provider;
      if (overrides.model) next.model = overrides.model;
      if (overrides.baseUrl !== undefined) next.baseUrl = overrides.baseUrl;
      return next;
    });
  }
  function saveGlobalModelConfig(nextConfig: RunConfig): void {
    localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
    setConfig(nextConfig);
  }
  const shortcutThemeMode = resolveThemeShortcutMode(config.themeMode);
  const themeShortcutLabel = shortcutThemeMode === 'dark'
    ? (config.locale === 'zh' ? '深色' : 'Dark')
    : (config.locale === 'zh' ? '浅色' : 'Light');
  const themeShortcutTitle = config.locale === 'zh'
    ? `主题：${themeShortcutLabel}，点击切换`
    : `Theme: ${themeShortcutLabel}. Click to switch`;
  const themeShortcutIcon = shortcutThemeMode === 'dark' ? 'moon' : 'sun';
  return (
    <main className={[
      'appShell',
      `theme-${config.themeMode}`,
      sidebarCollapsed ? 'sidebarCollapsed' : '',
    ].filter(Boolean).join(' ')}
    style={{
      gridTemplateColumns: sidebarCollapsed
        ? '58px minmax(0, 1fr)'
        : '294px minmax(0, 1fr)',
      gridTemplateRows: '40px minmax(0, 1fr)',
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <TitleBar title="Nexus" locale={config.locale} />
      </div>
      {/* 窄屏 sidebar scrim 遮罩 — Chinese: narrow sidebar scrim */}
      <button type="button" className={`sidebarScrim${sidebarOpen ? ' mobileOpen' : ''}`} aria-label={config.locale === 'zh' ? '关闭侧栏' : 'Close sidebar'} onClick={() => setSidebarOpen(false)} />
      <aside className={[sidebarCollapsed ? 'conversationPane collapsed' : 'conversationPane', sidebarOpen ? 'mobileOpen' : ''].filter(Boolean).join(' ')}>
        <WorkspaceThreadList
          activeThreadId={threadId} busy={busy} currentWorkspaceRoot={config.workspaceRoot} locale={config.locale}
          rememberedRoots={rememberedWorkspaceRoots} runningTurnIds={runningTurnIds} searchQuery={threadFilter}
          sidebarCollapsed={sidebarCollapsed} threads={threads} weixinActiveThreadId={botConfig?.weixin.activeThreadId ?? ''} dingtalkActiveThreadId={botConfig?.dingtalk.activeThreadId ?? ''}
          onCreatePlainChat={() => void createPlainConversation()}
          onCreateInWorkspace={(workspaceRoot) => void createConversation(workspaceRoot, 'project')} onDeleteThread={(id) => void deleteConversation(id)}
          onCreateWorkflowProject={createWorkflowProjectDraft}
          onForgetWorkspace={(workspaceRoot) => setRememberedWorkspaceRoots((current) => forgetWorkspaceRoot(current, workspaceRoot))}
          onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
          onPickWorkspace={() => void createConversationWithWorkspacePicker()}
          onRenameThread={renameConversation}
          onSearchQueryChange={setThreadFilter} onSelectThread={(id) => { selectThreadFromSidebar(id); setSidebarOpen(false); }}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />
      </aside>
      <section
        className={[
          'workspace',
          rightPaneVisible ? '' : 'rightPaneHidden',
          isWorkflowView ? 'workflowSplit' : '',
        ].filter(Boolean).join(' ')}
        style={{
          gridTemplateColumns: rightPaneGridTemplateColumns,
        }}
      >
        <header className="topbar">
          <div className="conversationTitle">
            <strong>{activeThread?.title || workflowTitle || t(config.locale, 'noConversation')}</strong>
            <span>{status}</span>
          </div>
          {tokenUsage || hasContextPressure(compactionPressure) ? (
            <div className="tokenUsageBar" title={buildTokenTooltip(tokenUsage, compactionPressure, config.locale)}>
              <div className="tokenUsageBarRow">
                <span className="tokenUsageBarLabel cacheLabel">
                  {config.locale === 'zh' ? '缓存' : 'cache'} {tokenUsage?.hitRate ?? 0}%
                </span>
                {hasContextPressure(compactionPressure) ? (
                  <span className="tokenUsageBarLabel contextLabel">
                    {config.locale === 'zh' ? '上下文' : 'ctx'} {contextUsagePercent(compactionPressure)}%
                  </span>
                ) : null}
              </div>
              <div className="tokenUsageBarTrack">
                {hasContextPressure(compactionPressure) ? (
                  <>
                    <div
                      className="tokenUsageBarCacheSeg"
                      style={{ width: `${cacheContextPercent(tokenUsage, compactionPressure)}%` }}
                    />
                    <div
                      className="tokenUsageBarContextSeg"
                      style={{ width: `${Math.max(0, contextUsagePercent(compactionPressure) - cacheContextPercent(tokenUsage, compactionPressure))}%` }}
                    />
                    <div
                      className="tokenUsageBarRemainSeg"
                      style={{ width: `${Math.max(0, 100 - contextUsagePercent(compactionPressure))}%` }}
                    />
                    {compactionPressure?.softThreshold && compactionPressure?.maxTokens ? (
                      <div
                        className="tokenUsageBarSoftLine"
                        style={{ left: `${(compactionPressure.softThreshold / compactionPressure.maxTokens) * 100}%` }}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <div
                      className="tokenUsageBarCacheSeg"
                      style={{ width: `${tokenUsage?.hitRate ?? 0}%`, borderRadius: '999px 0 0 999px' }}
                    />
                    <div
                      className="tokenUsageBarRemainSeg"
                      style={{ width: `${Math.max(0, 100 - (tokenUsage?.hitRate ?? 0))}%`, borderRadius: '0 999px 999px 0' }}
                    />
                  </>
                )}
              </div>
            </div>
          ) : null}
          {cacheSummary ? <span className="tokenPill cache">{cacheSummary}</span> : null}
          {pressureSummary ? <span className="tokenPill warn">{pressureSummary}</span> : null}
          <div className="actions">
            {/* 移动端菜单按钮，窄屏显示 — Chinese: mobile menu button, narrow-only */}
            <button type="button" className="iconButton mobileMenuButton" onClick={() => setSidebarOpen((value) => !value)} title={config.locale === 'zh' ? '菜单' : 'Menu'} aria-label={config.locale === 'zh' ? '菜单' : 'Menu'} aria-expanded={sidebarOpen}><Icon name="menu" /></button>
            <button
              className="iconButton themeQuickButton"
              onClick={() => setConfig((current) => ({ ...current, themeMode: nextThemeMode(current.themeMode) }))}
              title={themeShortcutTitle}
              aria-label={themeShortcutTitle}
            >
              <Icon name={themeShortcutIcon} />
              <span className="themeQuickLabel">{themeShortcutLabel}</span>
            </button>
            <button className="iconButton" onClick={() => void threadAction('compact')} disabled={!threadId || busy || actionBusy} title={t(config.locale, 'compact')} aria-label={t(config.locale, 'compact')}><Icon name="refresh" /></button>
            <button className={monitorButtonActive ? 'iconButton panelButton active' : 'iconButton panelButton'} onClick={openUnifiedMonitor} title={config.locale === 'zh' ? '任务监控' : 'Task monitor'} aria-label={config.locale === 'zh' ? '任务监控' : 'Task monitor'}><Icon name="activity" /></button>
            <button className="iconButton helpButton" onClick={() => setSettingsHelpOpen(true)} title={config.locale === 'zh' ? '设置说明' : 'Settings guide'} aria-label={config.locale === 'zh' ? '设置说明' : 'Settings guide'}><Icon name="question" /></button>
            <button className={rightPaneVisible ? 'iconButton panelButton rightPaneToggleButton active' : 'iconButton panelButton rightPaneToggleButton'} onClick={() => setRightPaneVisible((value) => !value)} title={config.locale === 'zh' ? '显示/隐藏右侧栏' : 'Show/hide right panel'} aria-label={config.locale === 'zh' ? '显示/隐藏右侧栏' : 'Show/hide right panel'}><Icon name="panel" /></button>
          </div>
        </header>
        <div className="contentGrid">
          <section className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
            {items.length === 0 ? (
              <div className="empty">{workspaceView === 'workflow'
                ? (config.locale === 'zh' ? '从下方输入工作流目标，或描述节点修改要求。' : 'Describe a workflow goal or node change below.')
                : t(config.locale, 'empty')}</div>
            ) : (
              transcriptGroups.map((group) => (
                group.kind === 'user' ? (
                  <ItemView item={group.item as ThreadItem} key={group.item.id} locale={config.locale} canRollback={Boolean(group.item.turnId && group.item.turnId === latestRollbackTurnId && !busy && !actionBusy)} onBranch={branchFromTurn} onCopy={copyMessage} onRollback={rollbackToTurn} onPreviewFile={previewFileFromItem} onOpenFile={openFileFromItem} userAvatarId={config.userAvatarId} customUserAvatarDataUrl={config.customUserAvatarDataUrl} />
                ) : (
                  <AssistantTurnView
                    group={{ ...group, items: group.items as ThreadItem[], status: group.turnId && runningTurnIds.has(group.turnId) ? 'running' : group.status }}
                    key={group.id}
                    locale={config.locale}
                    canRegenerate={Boolean(group.turnId && group.turnId === latestRollbackTurnId && !busy && !actionBusy)}
                    childActivityByThread={childActivityByThread}
                    onBranch={branchFromTurn}
                    onCopy={copyMessage}
                    onRegenerate={regenerateFromTurn}
                    onPreviewFile={previewFileFromItem}
                    onOpenFile={openFileFromItem}
                    workspaceRoot={activeWorkspaceRoot}
                  />
                )
              ))
            )}
            {transcriptFollow.showReturnToBottom ? (
              <button
                type="button"
                className="returnToBottomButton"
                onClick={handleReturnToBottom}
                aria-label={config.locale === 'zh' ? '回到底部' : 'Return to bottom'}
              >
                {config.locale === 'zh' ? '回到底部' : '↓ Return to bottom'}
              </button>
            ) : null}
          </section>
          {rightPaneVisible ? (
            <>
              <button
                type="button"
                className="rightPaneDivider"
                aria-label={config.locale === 'zh' ? '调整右侧栏宽度' : 'Resize right panel'}
                title={config.locale === 'zh' ? '拖拽调整右侧栏宽度' : 'Drag to resize right panel'}
                onPointerDown={startRightPaneResize}
              />
              {workspaceView === 'workflow' ? <section className="workflowSidePane"><WorkflowPanel locale={config.locale} workflow={activeWorkflow} blueprint={workflowBlueprint} components={workflowComponents} planDraft={workflowPlanDraft} saving={workflowSaving} runtimeBusy={workflowRuntimeBusy} onSave={(workflow) => void saveWorkflow(workflow)} onCancelPlan={() => setWorkflowPlanDraft(null)} onCommitPlan={() => void commitWorkflowPlan()} onSelectionChange={setWorkflowSelectedNodeIds} onRunWorkflow={() => void controlWorkflowRuntime('run')} onTestWorkflow={() => void controlWorkflowRuntime('test_run')} onPublishWorkflow={() => void controlWorkflowRuntime('publish')} onResumeWorkflow={() => void controlWorkflowRuntime('resume')} onCancelWorkflow={() => void controlWorkflowRuntime('cancel')} onRetryWorkflowNode={(nodeId) => void controlWorkflowRuntime('retry_node', nodeId)} runEvents={runMonitor.events} /></section> : <RightPane activeThread={activeThread} activeThreadId={threadId} activeThreadTitle={activeThread?.title ?? ''} busy={busy} threadChildren={threadChildren} externalPreviewRequest={previewRequest} locale={config.locale} runtimeItems={items} workspaceRoot={activeWorkspaceRoot} onJumpToMonitor={jumpToMonitor} onToggleMemoryExcluded={(excluded) => void toggleThreadMemoryExcluded(excluded)} traceSummary={workbenchTraceSummary as Parameters<typeof RightPane>[0]['traceSummary']} currentRunId={workbenchCurrentRunId} controlCapabilities={workbenchSelectedRun?.controlCapabilities ? { interrupt: workbenchSelectedRun.controlCapabilities.interrupt, resume: workbenchSelectedRun.controlCapabilities.resume, rollback: { enabled: workbenchSelectedRun.controlCapabilities.rollback.enabled, checkpointIds: workbenchSelectedRun.controlCapabilities.rollback.checkpointIds ?? [], reason: workbenchSelectedRun.controlCapabilities.rollback.reason } } : undefined} onInterrupt={handleControlInterrupt} onResume={handleControlResume} onRollback={handleControlRollback} responsiveMode={responsiveMode === 'side' ? undefined : responsiveMode} onCloseRequest={handleCloseWorkbench} />}
            </>
          ) : null}
        </div>
        {pendingApprovals.length > 0 ? (
          <section className="approvalPanel" aria-label={t(config.locale, 'approvalRequired')}>
            {pendingApprovals.map((approval) => (
              <article className="approvalItem" key={approval.requestId}>
                <div>
                  <strong>{t(config.locale, 'approvalRequired')}</strong>
                  <span>{approval.description}</span>
                </div>
                <button className="textButton" onClick={() => void decideApproval(approval.requestId, false)}>
                  {t(config.locale, 'deny')}
                </button>
                <button className="solidButton" onClick={() => void decideApproval(approval.requestId, true)}>
                  {t(config.locale, 'approve')}
                </button>
                {approval.kind === 'file_write' ? (
                  <div className="approvalItemDiff">
                    <ApprovalDiffPreview payload={approval.payload} locale={config.locale} />
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        <ComposerBar activeSlashOption={activeSlashOption} activeThreadId={threadId} actionBusy={actionBusy} applyModelPreset={applyModelPreset} botConfig={botConfig} botStatus={botStatus} busy={busy} composerInputRef={composerInputRef} config={config} draggingImage={draggingImage} filteredSlashOptions={filteredSlashOptions} handleDrop={handleDrop} handleFileSelect={handleFileSelect} handlePaste={handlePaste} images={images} input={input} modelPresets={modelPresets} openRemoteAssistants={openRemoteAssistants} removeImage={removeImage} rightPaneVisible={rightPaneVisible} selectSlashOption={selectSlashOption} setActiveSlashOption={setActiveSlashOption} setConfig={setConfig} setDraggingImage={setDraggingImage} setInput={setInput} slashVisible={slashVisible} stopTurn={stopTurn} submitComposer={submitComposer} workflowMode={workspaceView === 'workflow'} workflowPlanning={workflowPlanning} />
      </section>
      {settingsOpen ? (
        <SettingsDrawer
          botConfig={botConfig} botStatus={botStatus} config={config} keyStates={keyStates} locale={config.locale}
          mcps={mcps} mcpStatuses={mcpStatuses} modelPresets={modelPresets} providers={providers} skillsList={skillsList}
          refreshSkills={refreshSkills} refreshMcpStatus={refreshMcpStatus} refreshBotStatus={refreshBotStatus}
          refreshProviders={refreshProviders} refreshKeyStates={refreshKeyStates}
          clearProviderKey={clearProviderKey}
          deleteSkill={deleteSkill}
          requestModelPresetName={requestModelPresetName} saveModelPreset={saveModelPreset} deleteModelPreset={deleteModelPreset} saveProviderKey={saveProviderKey} saveProviderEnvVar={saveProviderEnvVar} saveBotConfig={saveBotConfig} saveSkillDraft={saveSkillDraft} logoutWeixin={logoutWeixin}
          webProviderState={webProviderState} saveWebProviderKey={saveWebProviderKey} clearWebProviderKey={clearWebProviderKey}
          setConfig={setConfig} setMcps={setMcps} setOpen={setSettingsOpen}
          pendingMcpDraft={pendingMcpDraft}
          consumePendingMcpDraft={() => setPendingMcpDraft(null)}
          startDingtalkStream={startDingtalkStream} stopDingtalkStream={stopDingtalkStream} testDingtalkMessage={testDingtalkMessage}
          activeThreadId={threadId}
          saveThreadModelOverrides={saveThreadModelOverrides}
          saveGlobalModelConfig={saveGlobalModelConfig}
        />
      ) : null}
      {settingsHelpOpen ? <SettingsHelpDialog locale={config.locale} onClose={() => setSettingsHelpOpen(false)} /> : null}
      <RunMonitorDrawer
        threadId={threadId}
        open={runMonitor.open}
        adminMode={runMonitor.adminMode}
        adminToken={runMonitor.adminToken}
        runs={runMonitor.runs}
        traces={runMonitor.traces}
        visibleTraces={runMonitor.visibleTraces}
        threads={runMonitor.threads}
        selectedRunId={runMonitor.selectedRunId}
        selectedRun={runMonitor.selectedRun}
        selectedEventId={runMonitor.selectedEventId}
        selectedTrace={runMonitor.selectedTrace}
        categoryFilter={runMonitor.categoryFilter}
        errorsOnly={runMonitor.errorsOnly}
        tracePage={runMonitor.tracePage}
        expandedThreadId={runMonitor.expandedThreadId}
        autoRefresh={runMonitor.autoRefresh}
        autoRefreshInterval={runMonitor.autoRefreshInterval}
        loading={runMonitor.loading}
        allCategories={runMonitor.allCategories}
        zh={runMonitor.zh}
        onClose={() => runMonitor.setOpen(false)}
        onRefresh={() => void runMonitor.refresh(runMonitor.selectedRunId || undefined)}
        onSelectRun={(runId) => void runMonitor.refresh(runId)}
        onControlRun={(action, opts) => {
          if (runMonitor.selectedRun) {
            void runMonitor.controlRun(action, runMonitor.selectedRun, opts);
          }
        }}
        onToggleThread={runMonitor.toggleThread}
        onSelectEvent={runMonitor.selectEvent}
        onToggleCategory={runMonitor.toggleCategory}
        onSetErrorsOnly={runMonitor.setErrorsOnly}
        onAutoRefreshChange={runMonitor.setAutoRefresh}
        onAutoRefreshIntervalChange={runMonitor.setAutoRefreshInterval}
        onAdminTokenChange={runMonitor.setAdminToken}
        onLoadOlder={() => void runMonitor.loadOlder()}
      />
      {dialog ? <AppDialog dialog={dialog} onClose={() => setDialog(null)} /> : null}
      {toast ? <div className="toastNotice" key={toast.id}>{toast.text}</div> : null}
      {weixinConnectState ? <WeixinConnectDialog locale={config.locale} state={weixinConnectState} onClose={() => setWeixinConnectState(null)} /> : null}
      {skillDraft ? (
        <SkillDraftDialog
          draft={skillDraft}
          locale={config.locale}
          onCancel={() => setSkillDraft(null)}
          onSave={saveSkillDraft}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
