import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RUN_CONFIG_STORAGE_KEY, mergeRunConfigDefaults, type PermissionPresetId, type ReasoningEffort, type RunConfig, type RunProfile, type WebSearchMode } from './config.js';
import { Icon } from './components/Icon.js';
import { AppDialog, SettingsHelpDialog, SkillDraftDialog, type AppDialogState } from './components/Dialogs.js';
import { AssistantTurnView, ItemView } from './components/ItemView.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { WeixinConnectDialog } from './components/WeixinConnectDialog.js';
import { RightPane, type RightPaneTab } from './components/RightPane.js';
import { WorkspaceThreadList } from './components/WorkspaceThreadList.js';
import { useBotControls, type WeixinLoginState } from './botClient.js';
import { resizeTextareaToContent } from './composer.js';
import { defaultConfig, defaultMcps } from './defaults.js';
import { t } from './i18n.js';
import { mcpFromCommandText, normalizeStoredMcps } from './mcpConfig.js';
import { getSlashCommandOptions, isSlashInput, parseSlashCommand, type SlashCommand, type SlashCommandOption } from './slashCommands.js';
import { localizedSkillDescription } from './skillDescriptions.js';
import { readStored } from './storage.js';
import { buildChildActivityByThread } from './subagentActivity.js';
import { buildAgentStageRows, buildSubagentStatusRows } from './subagents.js';
import { modeInstructionFor } from './taskModes.js';
import { formatCacheDiagnostics, formatCompactionPressure, formatThreadTokenSummary } from './usageDisplay.js';
import { runProfileDescription, runProfileLabel } from './runProfiles.js';
import { actionDetail, actionTitle, completeLocalSkillDraftItem, createLocalSkillDraftItems, mergeIncomingItems } from './threadItems.js';
import { optimisticDeleteThread } from './threads.js';
import { forgetWorkspaceRoot, pickWorkspaceRoot, readRememberedWorkspaceRoots, rememberWorkspaceRoots, workspacePickerNotice, workspacePickerStatus } from './workspaces.js';
import {
  applyAgentMessageDelta,
  describeEvent,
  groupTranscriptItems,
  withSyntheticUserMessages,
  type EventDraft,
} from './threadView.js';
import type {
  ApiKeyState,
  ApprovalRequest,
  EventLine,
  McpConfig,
  McpServerStatus,
  ModelPreset,
  ProviderEntry,
  SkillDraft,
  SkillEntry,
  ThreadItem,
  ThreadChildInfo,
  ThreadMeta,
  ThreadUsage,
  TurnMeta,
} from './types.js';
import './styles.css';
type PaletteOption = SlashCommandOption & (
  | { action?: 'command' }
  | { action: 'insert_skill'; skillName: string; hideCommand: true }
  | { action: 'enable_mcp'; mcpId: string; hideCommand: true }
);

function App() {
  const [hasStoredRunConfig] = useState(() => Boolean(localStorage.getItem(RUN_CONFIG_STORAGE_KEY)));
  const [config, setConfig] = useState<RunConfig>(() => ({
    ...defaultConfig,
    ...readStored<Partial<RunConfig>>(RUN_CONFIG_STORAGE_KEY, {}),
  }));
  const [configHydrated, setConfigHydrated] = useState(false);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [rememberedWorkspaceRoots, setRememberedWorkspaceRoots] = useState<string[]>(() => readRememberedWorkspaceRoots());
  const [threadId, setThreadId] = useState('');
  const [turns, setTurns] = useState<TurnMeta[]>([]);
  const [items, setItems] = useState<ThreadItem[]>([]);
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
  } | null>(null);
  const [threadChildren, setThreadChildren] = useState<ThreadChildInfo[]>([]);
  const [, setEvents] = useState<EventLine[]>([]);
  const [runningTurnIds, setRunningTurnIds] = useState<Set<string>>(() => new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [threadFilter, setThreadFilter] = useState('');
  const [input, setInput] = useState('');
  const [activeSlashOption, setActiveSlashOption] = useState<SlashCommandOption | null>(null);
  const [images, setImages] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [draggingImage, setDraggingImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHelpOpen, setSettingsHelpOpen] = useState(false);
  const [rightPaneVisible, setRightPaneVisible] = useState(true), [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>('status');
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [keyStates, setKeyStates] = useState<ApiKeyState[]>([]);
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>([]);
  const [skillsList, setSkillsList] = useState<SkillEntry[]>([]);
  const [mcps, setMcps] = useState<McpConfig[]>(() => normalizeStoredMcps(readStored('nexus.mcps', defaultMcps)));
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpHydrated, setMcpHydrated] = useState(false);
  const [pendingMcpDraft, setPendingMcpDraft] = useState<McpConfig | null>(null);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [weixinConnectState, setWeixinConnectState] = useState<WeixinLoginState | null>(null);
  const eventCounter = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const { botConfig, botStatus, refreshBotStatus, saveBotConfig, connectWeixin } = useBotControls();

  const activeThread = threads.find((thread) => thread.threadId === threadId);
  const activeProvider = providers.find((provider) => provider.id === config.provider);
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
  const transcriptGroups = useMemo(() => groupTranscriptItems(items, turns), [items, turns]);
  const subagentRows = useMemo(() => buildSubagentStatusRows(threadChildren, config.locale), [config.locale, threadChildren]);
  const agentStageRows = useMemo(() => buildAgentStageRows({
    activeThreadId: threadId,
    activeThreadTitle: activeThread?.title ?? '',
    busy,
    children: subagentRows,
    locale: config.locale,
  }), [activeThread?.title, busy, config.locale, subagentRows, threadId]);
  const activeWorkspaceRoot = activeThread?.tags?.conversationKind === 'chat' ? '' : (activeThread?.workspaceRoot || config.workspaceRoot || '');
  const childActivityByThread = useMemo(() => buildChildActivityByThread(threadChildren), [threadChildren]);
  const tokenSummary = useMemo(() => {
    return formatThreadTokenSummary(threadUsage, config.locale);
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

  const openWeixinRemote = useCallback(() => void connectWeixin(threadId || undefined, setWeixinConnectState), [connectWeixin, threadId]);
  const slashVisible = !activeSlashOption && isSlashInput(input) && !busy && images.length === 0;
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

  const refreshModelPresets = useCallback(async () => {
    const response = await fetch('/api/model-presets');
    if (!response.ok) return;
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }, []);

  const refreshSkills = useCallback(async () => {
    const response = await fetch('/api/skills');
    if (!response.ok) return;
    const data = (await response.json()) as { skills?: SkillEntry[] };
    setSkillsList(data.skills ?? []);
  }, []);

  const refreshMcpStatus = useCallback(async () => {
    const response = await fetch('/api/mcp/status');
    if (!response.ok) return;
    const data = (await response.json()) as { servers?: McpServerStatus[] };
    setMcpStatuses(data.servers ?? []);
  }, []);

  const refreshThreadChildren = useCallback(async (id: string) => {
    if (!id) return setThreadChildren([]);
    const response = await fetch(`/api/threads/${id}/children?recursive=1`);
    if (!response.ok) return setThreadChildren([]);
    const data = (await response.json()) as { children?: ThreadChildInfo[] };
    setThreadChildren(data.children ?? []);
  }, []);

  const reloadThreadSnapshot = useCallback(async (id: string) => {
    const response = await fetch(`/api/threads/${id}?includeChildren=1`);
    if (!response.ok) return;
    const data = (await response.json()) as {
      turns?: TurnMeta[];
      items: ThreadItem[];
      config?: Partial<RunConfig>;
      usage?: ThreadUsage;
    };
    setTurns(data.turns ?? []);
    setThreadUsage(data.usage ?? null);
    setRunningTurnIds(new Set((data.turns ?? [])
      .filter((turn) => turn.status === 'running')
      .map((turn) => turn.turnId)));
    setItems(withSyntheticUserMessages(data.turns ?? [], data.items ?? []) as ThreadItem[]);
    if (data.config) {
      const { workspaceRoot, ...threadConfig } = data.config;
      setConfig((current) => ({
        ...current,
        ...threadConfig,
        ...(workspaceRoot ? { workspaceRoot } : {}),
      }));
    }
    await refreshThreadChildren(id);
  }, [refreshThreadChildren]);

  const loadThread = useCallback(
    async (id: string) => {
      if (!id) return;
      setThreadId(id);
      setEvents([]);
      setCacheDiagnostics(null);
      setCompactionPressure(null);
      await reloadThreadSnapshot(id);
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/events/${id}`);
      source.onmessage = (message) => {
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
          if (event.type === 'cache.diagnostics') {
            setCacheDiagnostics(event as never);
          }
          if (event.type === 'context.compaction_pressure' && event.pressure) {
            setCompactionPressure(event.pressure as never);
          }
          if (event.type === 'child_agent.event') {
            void refreshThreadChildren(id);
          }
          if (event.type === 'agent_message.delta') {
            setItems((current) => applyAgentMessageDelta(current, event as never) as ThreadItem[]);
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
        addEvent({
          kind: 'events',
          title: config.locale === 'zh' ? '连接恢复中' : 'Reconnecting',
          detail: config.locale === 'zh' ? '事件连接断开，正在重新拉取当前对话。' : 'The event stream disconnected; reloading the current thread.',
          tone: 'warning',
        });
        window.setTimeout(() => {
          if (eventSourceRef.current === source) {
            eventSourceRef.current?.close();
            void reloadThreadSnapshot(id);
          }
        }, 500);
      };
      eventSourceRef.current = source;
    },
    [addEvent, config.locale, mergeApproval, refreshThreadChildren, reloadThreadSnapshot],
  );

  useEffect(() => {
    fetch('/api/settings')
      .then((response) => response.json())
      .then((data: { config?: Partial<RunConfig>; stored?: boolean }) => {
        setConfig((current) => {
          if (data.stored || !hasStoredRunConfig) {
            return { ...defaultConfig, ...data.config };
          }
          return mergeRunConfigDefaults(data.config, current);
        });
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
        void refreshMcpStatus();
      })
      .catch(() => setMcpHydrated(true));
    return () => eventSourceRef.current?.close();
  }, [hasStoredRunConfig, refreshBotStatus, refreshMcpStatus, refreshModelPresets, refreshProviders, refreshSkills, refreshThreads]);

  useEffect(() => {
    void refreshApprovals();
    const timer = window.setInterval(() => void refreshApprovals(), 2000);
    return () => window.clearInterval(timer);
  }, [refreshApprovals]);

  useEffect(() => {
    if (!configHydrated) return;
    localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify(config));
    void fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: apiConfig }),
    });
    if (threadId) {
      void fetch(`/api/threads/${threadId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: apiConfig }),
      });
    }
  }, [apiConfig, config, configHydrated, threadId]);

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
      });
  }, [mcpHydrated, mcps]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }, [lastItemSignature]);

  useEffect(() => { resizeTextareaToContent(composerInputRef.current); }, [activeSlashOption, images.length, input]);

  async function createConversation(workspaceRoot = config.workspaceRoot, conversationKind: 'chat' | 'project' = 'project') {
    setBusy(true);
    setStatus(t(config.locale, 'creating'));
    try {
      const runConfig = { ...apiConfig, workspaceRoot: conversationKind === 'chat' ? '' : workspaceRoot };
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
    } finally {
      setBusy(false);
    }
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
        if (isGitHubUrl(command.args)) {
          await installSkillFromGitHub(command.args);
        } else {
          await createSkillDraft(command.args);
        }
        return;
      case 'mcp.list':
        setInput('/mcp ');
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
        return;
      case 'mcp.add':
        setPendingMcpDraft(mcpFromCommandText(command.args));
        setSettingsOpen(true);
        setInput('');
        return;
      case 'web_search.mode':
        setWebSearchMode(command.mode);
        setInput('');
        return;
      case 'compact':
        setInput('');
        if (threadId && !busy) await threadAction('compact');
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
        body: JSON.stringify({ description: text, config: apiConfig }),
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

  async function installSkillFromGitHub(skillUrl: string) {
    const text = skillUrl.trim();
    if (!text) return;
    let activeThreadId = threadId;
    setInput('');
    setActiveSlashOption(null);
    setBusy(true);
    setStatus(config.locale === 'zh' ? '安装 Skill' : 'Installing skill');
    try {
      if (!activeThreadId) {
        const threadResponse = await fetch('/api/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `/skills add ${text}`.slice(0, 60), config: apiConfig }),
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

      const response = await fetch(`/api/threads/${activeThreadId}/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text, config: apiConfig }),
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
      setItems((current) => mergeIncomingItems(current, data.items ?? []));
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
  }

  async function sendMessage(modeInstruction?: string, forcedText?: string) {
    const text = (forcedText ?? input).trim();
    const hasImages = images.length > 0;
    if (!text && !hasImages) return;
    let activeThreadId = threadId;
    if (!activeThreadId) {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (text || 'Image').slice(0, 60),
          config: { ...apiConfig, workspaceRoot: '' },
          conversationKind: 'chat',
        }),
      });
      const data = (await response.json()) as { thread: ThreadMeta };
      activeThreadId = data.thread.threadId;
      await loadThread(activeThreadId);
      await refreshThreads();
    }

    setBusy(true);
    setInput('');
    const sentImages = [...images];
    setImages([]);
    setStatus(t(config.locale, 'running'));
    const pendingUserItem: ThreadItem = {
      id: `pending_user_${Date.now()}`,
      type: 'user_message',
      text: text || (config.locale === 'zh' ? '见附件图片。' : 'See attached image(s).'),
      status: 'in_progress',
      timestamp: new Date().toISOString(),
    };
    setItems((current) => mergeIncomingItems(current, [pendingUserItem]));
    try {
      const body: Record<string, unknown> = { input: text || 'See attached image(s).', config: apiConfig };
      if (modeInstruction) body.modeInstruction = modeInstruction;
      if (sentImages.length > 0) {
        body.images = sentImages.map((img) => ({ name: img.name, dataUrl: img.dataUrl }));
      }
      const response = await fetch(`/api/threads/${activeThreadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? 'Turn failed');
      }
      const data = (await response.json()) as { items: ThreadItem[] };
      setItems((current) => mergeIncomingItems(current, data.items ?? []));
      setRunningTurnIds(new Set());
      await refreshThreads();
      setStatus(t(config.locale, 'idle'));
    } catch (error) {
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
      setBusy(false);
    }
  }

  async function stopTurn() {
    if (!threadId) return;
    const response = await fetch(`/api/threads/${threadId}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: apiConfig }),
    });
    const data = (await response.json()) as { interrupted?: boolean };
    if (data.interrupted) {
      setBusy(false);
      setRunningTurnIds(new Set());
      setStatus(t(config.locale, 'stop'));
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
    if (!threadId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/threads/${threadId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: apiConfig, count }),
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
      setBusy(false);
    }
  }

  function rollbackToTurn(turnId: string) {
    const index = turns.findIndex((turn) => turn.turnId === turnId);
    const count = index >= 0 ? Math.max(1, turns.length - index) : 1;
    void threadAction('rollback', count);
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
        body: JSON.stringify({ config: apiConfig }),
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

  async function saveModelPreset() {
    const defaultName = `${activeProvider?.name ?? config.provider} / ${config.model}`;
    const name = await requestTextDialog({
      title: t(config.locale, 'saveModelPreset'),
      value: defaultName,
      actionLabel: t(config.locale, 'save'),
      cancelLabel: t(config.locale, 'cancel'),
    });
    if (name === null) return;
    const response = await fetch('/api/model-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || defaultName,
        config: apiConfig,
      }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }

  function applyModelPreset(preset: ModelPreset) {
    setConfig((current) => ({ ...current, ...preset.config }));
  }

  async function deleteModelPreset(id: string) {
    const response = await fetch(`/api/model-presets/${id}`, { method: 'DELETE' });
    if (!response.ok) return;
    const data = (await response.json()) as { presets?: ModelPreset[] };
    setModelPresets(data.presets ?? []);
  }

  function selectProvider(providerId: string) {
    const normalizedProviderId = providerId === 'doubao' ? 'volcengine' : providerId;
    const provider = providers.find((item) => item.id === normalizedProviderId);
    setConfig((current) => ({
      ...current,
      provider: normalizedProviderId,
      baseUrl: provider?.baseUrl ?? current.baseUrl,
    }));
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
    }}>
      <aside className={sidebarCollapsed ? 'conversationPane collapsed' : 'conversationPane'}>
        <WorkspaceThreadList
          activeThreadId={threadId} busy={busy} currentWorkspaceRoot={config.workspaceRoot} locale={config.locale}
          rememberedRoots={rememberedWorkspaceRoots} runningTurnIds={runningTurnIds} searchQuery={threadFilter}
          sidebarCollapsed={sidebarCollapsed} threads={threads}
          onCreatePlainChat={() => void createPlainConversation()}
          onCreateInWorkspace={(workspaceRoot) => void createConversation(workspaceRoot, 'project')} onDeleteThread={(id) => void deleteConversation(id)}
          onForgetWorkspace={(workspaceRoot) => setRememberedWorkspaceRoots((current) => forgetWorkspaceRoot(current, workspaceRoot))}
          onOpenSettings={() => setSettingsOpen(true)}
          onPickWorkspace={() => void createConversationWithWorkspacePicker()}
          onRenameThread={renameConversation}
          onSearchQueryChange={setThreadFilter} onSelectThread={(id) => void loadThread(id)}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />
      </aside>

      <section className={rightPaneVisible ? 'workspace' : 'workspace rightPaneHidden'}>
        <header className="topbar">
          <div className="conversationTitle">
            <strong>{activeThread?.title || t(config.locale, 'noConversation')}</strong>
            <span>{status}</span>
          </div>
          {tokenSummary ? <span className="tokenPill">{tokenSummary}</span> : null}
          {cacheSummary ? <span className="tokenPill cache">{cacheSummary}</span> : null}
          {pressureSummary ? <span className="tokenPill warn">{pressureSummary}</span> : null}
          <div className="actions">
            <button className="iconButton" onClick={() => void threadAction('compact')} disabled={!threadId || busy} title={t(config.locale, 'compact')} aria-label={t(config.locale, 'compact')}><Icon name="refresh" /></button>
            <button className="iconButton helpButton" onClick={() => setSettingsHelpOpen(true)} title={config.locale === 'zh' ? '设置说明' : 'Settings guide'} aria-label={config.locale === 'zh' ? '设置说明' : 'Settings guide'}><Icon name="question" /></button>
            <button className={rightPaneVisible ? 'iconButton panelButton active' : 'iconButton panelButton'} onClick={() => setRightPaneVisible((value) => !value)} title={config.locale === 'zh' ? '显示/隐藏右侧栏' : 'Show/hide right panel'} aria-label={config.locale === 'zh' ? '显示/隐藏右侧栏' : 'Show/hide right panel'}><Icon name="panel" /></button>
          </div>
        </header>

        <div className="contentGrid">
          <section className="transcript" ref={transcriptRef}>
            {items.length === 0 ? (
              <div className="empty">{t(config.locale, 'empty')}</div>
            ) : (
              transcriptGroups.map((group, index) => (
                group.kind === 'user' ? (
                  <ItemView
                    item={group.item as ThreadItem}
                    key={`${group.item.id}-${index}`}
                    locale={config.locale}
                    onBranch={branchFromTurn}
                    onCopy={copyMessage}
                    onRollback={rollbackToTurn}
                  />
                ) : (
                  <AssistantTurnView
                    group={{
                      ...group,
                      items: group.items as ThreadItem[],
                      status: group.turnId && runningTurnIds.has(group.turnId) ? 'running' : group.status,
                    }}
                    key={`${group.id}-${index}`}
                    locale={config.locale}
                    childActivityByThread={childActivityByThread}
                    onBranch={branchFromTurn}
                    onCopy={copyMessage}
                  />
                )
              ))
            )}
          </section>
          {rightPaneVisible ? <RightPane activeTab={rightPaneTab} agentStageRows={agentStageRows} locale={config.locale} workspaceRoot={activeWorkspaceRoot} onTabChange={setRightPaneTab} /> : null}
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
              </article>
            ))}
          </section>
        ) : null}

        <footer
          className={draggingImage ? 'composer dragging' : 'composer'}
          onDragEnter={(event) => {
            event.preventDefault();
            setDraggingImage(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDraggingImage(false)}
          onDrop={handleDrop}
        >
          <div className="composerMain">
            <div className="composerInner">
              {images.length > 0 ? (
                <div className="imageStrip">
                  {images.map((img, i) => (
                    <div className="imageThumb" key={i}>
                      <img src={img.dataUrl} alt={img.name} />
                      <button className="imageRemove" onClick={() => removeImage(i)} title={t(config.locale, 'remove')} aria-label={t(config.locale, 'remove')}>
                        <Icon name="x" />
                      </button>
                      <span>{img.name}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {slashVisible && filteredSlashOptions.length > 0 ? (
                <div className="slashPalette" role="listbox" aria-label="Slash commands">
                  {filteredSlashOptions.map((option) => (
                    <button
                      className={'hideCommand' in option && option.hideCommand ? 'slashOption compact' : 'slashOption'}
                      key={option.id}
                      onClick={() => selectSlashOption(option)}
                    >
                      <strong>{option.title}</strong>
                      {'hideCommand' in option && option.hideCommand ? null : <span>{option.command}</span>}
                      <small>{option.detail}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={activeSlashOption ? 'commandInputRow active' : 'commandInputRow'}>
                {activeSlashOption ? (
                  <div className="commandChip" title={activeSlashOption.command.trim()}>
                    <span>{activeSlashOption.command.trim()}</span>
                    <button
                      type="button"
                      title={t(config.locale, 'cancel')}
                      aria-label={t(config.locale, 'cancel')}
                      onClick={() => {
                        setActiveSlashOption(null);
                        setInput('');
                        composerInputRef.current?.focus();
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ) : null}
                <textarea
                  ref={composerInputRef}
                  value={input}
                  rows={1}
                  onChange={(event) => { setInput(event.target.value); window.requestAnimationFrame(() => resizeTextareaToContent(composerInputRef.current)); }}
                  onInput={() => resizeTextareaToContent(composerInputRef.current)}
                  onPaste={handlePaste}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (busy) return;
                      void submitComposer();
                    }
                  }}
                  placeholder={activeSlashOption ? (config.locale === 'zh' ? '输入自然语言参数...' : 'Describe what to add...') : t(config.locale, 'placeholder')}
                />
              </div>
            </div>
            <button
              className="sendButton"
              onClick={() => busy ? void stopTurn() : void submitComposer()}
              disabled={!busy && (!input.trim() && images.length === 0)}
              title={busy ? t(config.locale, 'stop') : t(config.locale, 'send')}
              aria-label={busy ? t(config.locale, 'stop') : t(config.locale, 'send')}
            >
              <Icon name={busy ? 'stop' : 'send'} />
            </button>
          </div>
          <div className="composerBottom">
            <div className="composerMeta">
              <span>{config.model}</span>
            </div>
            <div className="composerActions">
              <button className="fileButton" title={config.locale === 'zh' ? '连接微信远程助手' : 'Connect WeChat assistant'} aria-label={config.locale === 'zh' ? '连接微信远程助手' : 'Connect WeChat assistant'} onClick={openWeixinRemote}><Icon name="spark" /></button>
              <label className="fileButton" title={t(config.locale, 'attachImage')} aria-label={t(config.locale, 'attachImage')}>
                <input type="file" accept="image/*" multiple onChange={handleFileSelect} hidden />
                <Icon name="clip" />
              </label>
              <label className="modeSelect" title={t(config.locale, 'mode')} aria-label={t(config.locale, 'mode')}>
                <select value={config.permissions} onChange={(event) => setConfig({ ...config, permissions: event.target.value as PermissionPresetId })}><option value="read_only">{config.locale === 'zh' ? '只读' : 'Read'}</option><option value="workspace">{config.locale === 'zh' ? '默认' : 'Default'}</option><option value="danger_full_access">{config.locale === 'zh' ? '自主' : 'Auto'}</option></select>
              </label>
              <label className="modeSelect reasoningSelect" title={config.locale === 'zh' ? '思考程度' : 'Reasoning effort'} aria-label={config.locale === 'zh' ? '思考程度' : 'Reasoning effort'}>
                <select value={config.reasoningEffort} onChange={(event) => setConfig({ ...config, reasoningEffort: event.target.value as ReasoningEffort })}><option value="low">{config.locale === 'zh' ? '快速' : 'Fast'}</option><option value="medium">{config.locale === 'zh' ? '均衡' : 'Balanced'}</option><option value="high">{config.locale === 'zh' ? '深度' : 'Deep'}</option></select>
              </label>
              <label className="modeSelect runProfileSelect" title={runProfileDescription(config.runProfile, config.locale)} aria-label={config.locale === 'zh' ? '运行模式' : 'Run profile'}><select value={config.runProfile} onChange={(event) => setConfig({ ...config, runProfile: event.target.value as RunProfile })}><option value="cache_first">{runProfileLabel('cache_first', config.locale)}</option><option value="runtime_os">{runProfileLabel('runtime_os', config.locale)}</option></select></label>
            </div>
          </div>
        </footer>
      </section>

      {settingsOpen ? (
        <SettingsDrawer
          botConfig={botConfig} botStatus={botStatus} config={config} keyStates={keyStates} locale={config.locale}
          mcps={mcps} mcpStatuses={mcpStatuses} modelPresets={modelPresets} providers={providers} skillsList={skillsList}
          refreshSkills={refreshSkills} refreshMcpStatus={refreshMcpStatus} refreshBotStatus={refreshBotStatus}
          applyModelPreset={applyModelPreset} clearProviderKey={clearProviderKey} deleteModelPreset={deleteModelPreset}
          saveModelPreset={saveModelPreset} saveProviderKey={saveProviderKey} saveBotConfig={saveBotConfig}
          selectProvider={selectProvider} setConfig={setConfig} setMcps={setMcps} setOpen={setSettingsOpen}
          pendingMcpDraft={pendingMcpDraft}
          consumePendingMcpDraft={() => setPendingMcpDraft(null)}
        />
      ) : null}
      {settingsHelpOpen ? <SettingsHelpDialog locale={config.locale} onClose={() => setSettingsHelpOpen(false)} /> : null}
      {dialog ? <AppDialog dialog={dialog} onClose={() => setDialog(null)} /> : null}
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

function isGitHubUrl(value: string): boolean {
  try {
    return new URL(value.trim()).hostname === 'github.com';
  } catch {
    return false;
  }
}

createRoot(document.getElementById('root')!).render(<App />);
