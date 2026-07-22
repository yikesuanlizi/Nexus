// 设置面板入口薄壳：注册 Shell 与各 page；状态/handler 通过 useSettingsController 管理
import React, { useCallback, useEffect, useState } from 'react';
import type { Locale, RunConfig } from '../config/config.js';
import { emptyMcp } from '../config/defaults.js';
import type { RecommendedMcp, RecommendedSkill } from '../features/settings/pluginCatalog.js';
import type { ApiKeyState, BotConfig, BotStatus, McpConfig, McpServerStatus, MemoryRecord, ModelPreset, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../shared/types.js';
import { SettingsShell } from './settings/SettingsShell.js';
import { AppearancePage } from './settings/AppearancePage.js';
import { ModelsPage } from './settings/ModelsPage.js';
import { AgentsPage } from './settings/AgentsPage.js';
import { ToolsPage } from './settings/ToolsPage.js';
import { MonitorPage } from './settings/MonitorPage.js';
import { MemoryPage } from './settings/MemoryPage.js';
import { AboutPage, type AuthTokenPublic } from './settings/AboutPage.js';
import { McpConfigDialog } from './settings/McpConfigDialog.js';
import { FirecrawlKeyDialog } from './settings/FirecrawlKeyDialog.js';
import { useSettingsController } from '../features/settings/useSettingsController.js';

interface AuthTokenDraft {
  name: string;
  role: 'admin' | 'tenant' | 'bot';
  tenantId: string;
  scopes: string;
}

const defaultBotConfig: BotConfig = {
  weixin: {
    enabled: false,
    bridgeMode: 'external_rpc',
    bridgeUrl: 'http://127.0.0.1:18790/api/v1/admin/rpc',
    accountId: '',
    activeThreadId: '',
    autoStartMonitor: true,
    syncHistoryOnConnect: true,
  },
  feishu: { enabled: false },
  dingtalk: {
    enabled: false,
    connectionMode: 'stream',
    clientId: '',
    clientSecret: '',
    robotCode: '',
    cardTemplateId: '',
    targetGroupName: '',
    targetGroupConversationId: '',
    targetGroupSessionWebhook: '',
    lastDetectedGroupConversationId: '',
    lastDetectedGroupSessionWebhook: '',
    lastDetectedGroupAt: '',
    allowedUsers: [],
    webhookSecret: '',
    activeThreadId: '',
    autoStart: true,
  },
  dwsCli: {
    enabled: false,
    binaryPath: '',
    clientId: '',
    clientSecret: '',
  },
  qq: { enabled: false },
};

export function SettingsDrawer({
  botConfig,
  botStatus,
  config,
  deleteSkill,
  keyStates,
  locale,
  mcps,
  mcpStatuses,
  modelPresets,
  providers,
  pendingMcpDraft,
  requestModelPresetName,
  saveModelPreset,
  deleteModelPreset,
  saveSkillDraft,
  saveProviderKey,
  saveProviderEnvVar,
  skillsList,
  refreshSkills,
  refreshMcpStatus,
  refreshBotStatus,
  refreshProviders,
  setConfig,
  setMcps,
  setOpen,
  saveBotConfig,
  saveWebProviderKey,
  clearWebProviderKey,
  consumePendingMcpDraft,
  webProviderState,
  showAdminControls = false,
  startDingtalkStream,
  stopDingtalkStream,
  testDingtalkMessage,
  activeThreadId,
  saveThreadModelOverrides,
  saveGlobalModelConfig,
  refreshKeyStates,
}: {
  botConfig: BotConfig | null;
  botStatus: BotStatus | null;
  clearProviderKey: (providerId: string) => Promise<void>;
  config: RunConfig;
  deleteSkill: (name: string) => Promise<void>;
  keyStates: ApiKeyState[];
  locale: Locale;
  mcps: McpConfig[];
  mcpStatuses: McpServerStatus[];
  modelPresets: ModelPreset[];
  pendingMcpDraft?: McpConfig | null;
  providers: ProviderEntry[];
  skillsList: SkillEntry[];
  refreshSkills: (options?: { forceReload?: boolean }) => Promise<void>;
  refreshMcpStatus: (detail?: 'light' | 'full') => Promise<void>;
  refreshBotStatus: () => void;
  refreshProviders: () => Promise<void>;
  requestModelPresetName: (defaultName: string) => Promise<string | null>;
  saveModelPreset: (name: string, presetConfig: import('../shared/types.js').ModelPresetConfig) => Promise<void>;
  deleteModelPreset: (presetId: string) => Promise<void>;
  saveSkillDraft: (draft: import('../shared/types.js').SkillDraft) => Promise<void>;
  saveBotConfig: (config: BotConfig) => Promise<void>;
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  saveProviderEnvVar: (providerId: string, envVar: string) => Promise<void>;
  saveWebProviderKey: (apiKey: string) => Promise<void>;
  clearWebProviderKey: () => Promise<void>;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  setOpen: (open: boolean) => void;
  consumePendingMcpDraft?: () => void;
  webProviderState: WebProviderPublicConfig | null;
  showAdminControls?: boolean;
  startDingtalkStream?: () => Promise<{ ok?: boolean; error?: string }>;
  stopDingtalkStream?: () => Promise<void>;
  testDingtalkMessage?: (conversationId: string, conversationType: 'dm' | 'group', text?: string) => Promise<{ ok?: boolean; error?: string }>;
  activeThreadId: string;
  saveThreadModelOverrides: (overrides: { provider: string; model: string; baseUrl: string }) => Promise<void>;
  saveGlobalModelConfig: (config: RunConfig) => void;
  refreshKeyStates: () => Promise<void>;
}) {
  const controller = useSettingsController({
    locale,
    config,
    activeThreadId,
    providers,
    keyStates,
    modelPresets,
    requestModelPresetName,
    saveModelPreset,
    saveProviderKey,
    saveProviderEnvVar,
    saveThreadModelOverrides,
    saveGlobalModelConfig,
    setConfig,
    refreshProviders,
    refreshKeyStates,
    onClose: () => setOpen(false),
  });

  const [skillsRootDraft, setSkillsRootDraft] = useState(config.skillsRoot);
  const [botDraft, setBotDraft] = useState<BotConfig>(botConfig ?? defaultBotConfig);
  const [weixinNotice, setWeixinNotice] = useState('');
  const [dingtalkNotice, setDingtalkNotice] = useState('');
  const [dingtalkTestConvId, setDingtalkTestConvId] = useState('');
  const [dingtalkTestConvType, setDingtalkTestConvType] = useState<'dm' | 'group'>('dm');
  const [mcpDraft, setMcpDraft] = useState<McpConfig>(emptyMcp());
  const [editingMcpId, setEditingMcpId] = useState('');
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [webKeyDraft, setWebKeyDraft] = useState('');
  const [firecrawlDialogOpen, setFirecrawlDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('agent');
  const [pluginNotice, setPluginNotice] = useState('');
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryNotice, setMemoryNotice] = useState('');
  const [authTokens, setAuthTokens] = useState<AuthTokenPublic[]>([]);
  const [authTokenNotice, setAuthTokenNotice] = useState('');
  const [adminBootstrapToken, setAdminBootstrapToken] = useState('');
  const [newAuthToken, setNewAuthToken] = useState<AuthTokenDraft>({
    name: '',
    role: 'tenant',
    tenantId: 'tenantA',
    scopes: '*',
  });

  const settingsTabs = [
    { id: 'agent', label: locale === 'zh' ? '模型' : 'Model' },
    { id: 'appearance', label: locale === 'zh' ? '外观' : 'Appearance' },
    { id: 'memory', label: locale === 'zh' ? '记忆' : 'Memory' },
    { id: 'performance', label: locale === 'zh' ? '性能' : 'Performance' },
    { id: 'plugins', label: locale === 'zh' ? '插件中心' : 'Plugins' },
    { id: 'remote', label: locale === 'zh' ? '远程助手' : 'Remote bots' },
    ...(showAdminControls ? [{ id: 'admin', label: locale === 'zh' ? '管理员' : 'Admin' }] : []),
  ];

  useEffect(() => {
    setSkillsRootDraft(config.skillsRoot);
    if (!config.skillsRoot) {
      void ensureSkillsRoot();
    }
  }, [config.skillsRoot]);

  useEffect(() => {
    if (botConfig) setBotDraft(botConfig);
  }, [botConfig]);

  useEffect(() => {
    if (!pendingMcpDraft) return;
    setMcpDraft(pendingMcpDraft);
    setEditingMcpId('');
    setMcpPanelOpen(true);
    consumePendingMcpDraft?.();
  }, [consumePendingMcpDraft, pendingMcpDraft]);

  useEffect(() => {
    if (activeSection === 'admin' && showAdminControls) void refreshAuthTokens();
    if (activeSection === 'admin' && !showAdminControls) setActiveSection('agent');
    if (activeSection === 'memory') void refreshMemories();
  }, [activeSection, showAdminControls]);

  async function ensureSkillsRoot() {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const data = (await response.json()) as { config?: Partial<RunConfig> };
    const root = data.config?.skillsRoot;
    if (!root) return;
    setSkillsRootDraft(root);
    setConfig((current) => current.skillsRoot ? current : { ...current, skillsRoot: root });
  }

  function saveSkillsRoot() {
    setConfig((current) => ({ ...current, skillsRoot: skillsRootDraft }));
    controller.markDirty('skillsRoot', false);
  }

  function patchWeixin(patch: Partial<BotConfig['weixin']>) {
    setBotDraft((current) => ({ ...current, weixin: { ...current.weixin, ...patch } }));
  }

  async function saveWeixinConfig() {
    await saveBotConfig(botDraft);
    setWeixinNotice(locale === 'zh' ? '远程助手配置已保存。' : 'Remote assistant config saved.');
  }

  function patchDingtalk(patch: Partial<BotConfig['dingtalk']>) {
    setBotDraft((current) => ({ ...current, dingtalk: { ...current.dingtalk, ...patch } }));
  }

  async function saveDingtalkConfig() {
    await saveBotConfig(botDraft);
    setDingtalkNotice(locale === 'zh' ? '钉钉机器人配置已保存。' : 'DingTalk bot config saved.');
  }

  function patchDwsCli(patch: Partial<BotConfig['dwsCli']>) {
    setBotDraft((current) => ({ ...current, dwsCli: { ...current.dwsCli, ...patch } }));
  }

  async function saveDwsCliConfig() {
    await saveBotConfig(botDraft);
    setDingtalkNotice(locale === 'zh' ? '钉钉 CLI 配置已保存。' : 'DingTalk CLI config saved.');
  }

  async function handleStartDingtalk() {
    if (!startDingtalkStream) return;
    const result = await startDingtalkStream();
    if (result.ok) {
      setDingtalkNotice(locale === 'zh' ? '钉钉 Stream 已连接。' : 'DingTalk Stream connected.');
    } else {
      setDingtalkNotice(locale === 'zh' ? `连接失败：${result.error || '未知错误'}` : `Connection failed: ${result.error || 'unknown error'}`);
    }
  }

  async function handleStopDingtalk() {
    if (!stopDingtalkStream) return;
    await stopDingtalkStream();
    setDingtalkNotice(locale === 'zh' ? '钉钉 Stream 已停止。' : 'DingTalk Stream stopped.');
  }

  async function handleTestDingtalk() {
    if (!testDingtalkMessage || !dingtalkTestConvId.trim()) {
      setDingtalkNotice(locale === 'zh' ? '请填写 conversationId。' : 'Please fill in conversationId.');
      return;
    }
    const result = await testDingtalkMessage(dingtalkTestConvId.trim(), dingtalkTestConvType);
    if (result.ok) {
      setDingtalkNotice(locale === 'zh' ? '测试消息已发送。' : 'Test message sent.');
    } else {
      setDingtalkNotice(locale === 'zh' ? `发送失败：${result.error || '未知错误'}` : `Send failed: ${result.error || 'unknown error'}`);
    }
  }

  function closeMcpPanel() {
    setMcpDraft(emptyMcp());
    setEditingMcpId('');
    setMcpPanelOpen(false);
  }

  function openAddMcpPanel() {
    setMcpDraft(emptyMcp());
    setEditingMcpId('');
    setMcpPanelOpen(true);
  }

  function openEditMcpPanel(item: McpConfig) {
    setMcpDraft(item);
    setEditingMcpId(item.id);
    setMcpPanelOpen(true);
  }

  function addRecommendedMcp(item: RecommendedMcp) {
    setMcpDraft({ ...item.draft, id: '' });
    setEditingMcpId('');
    setMcpPanelOpen(true);
    setActiveSection('plugins');
  }

  async function installRecommendedSkill(item: RecommendedSkill) {
    try {
      await saveSkillDraft(item.draft);
      await refreshSkills({ forceReload: true });
      setPluginNotice(locale === 'zh' ? `已安装 ${item.name}` : `Installed ${item.name}`);
    } catch (error) {
      setPluginNotice(error instanceof Error ? error.message : String(error));
    }
  }

  const mcpCanSave = Boolean(mcpDraft.name.trim() && mcpDraft.command.trim());

  function saveMcp() {
    if (!mcpCanSave) return;
    setMcps((current) => {
      const upsert = (arr: McpConfig[], item: McpConfig): McpConfig[] => {
        const idx = arr.findIndex((x) => x.id === item.id);
        if (idx >= 0) { const next = [...arr]; next[idx] = item; return next; }
        return [...arr, item];
      };
      return upsert(current, {
        id: editingMcpId || crypto.randomUUID(),
        name: mcpDraft.name.trim(),
        command: mcpDraft.command.trim(),
        args: mcpDraft.args.trim(),
        enabled: mcpDraft.enabled,
      });
    });
    closeMcpPanel();
  }

  function closeFirecrawlDialog() {
    setFirecrawlDialogOpen(false);
    setWebKeyDraft('');
  }

  async function handleFirecrawlToggle(nextEnabled: boolean) {
    if (!nextEnabled) {
      setConfig((current) => ({ ...current, webProvider: 'native_fetch' }));
      setPluginNotice(locale === 'zh' ? '已切回本地读取。' : 'Switched back to local fetch.');
      return;
    }
    const firecrawlMasked = webProviderState?.firecrawl.masked ?? '';
    const firecrawlHasPreview = /[.•·]/.test(firecrawlMasked);
    const firecrawlConfigured = Boolean(webProviderState?.firecrawl.configured && firecrawlHasPreview);
    if (firecrawlConfigured) {
      setConfig((current) => ({ ...current, webProvider: 'firecrawl' }));
      setPluginNotice(locale === 'zh' ? 'Firecrawl 已开启。' : 'Firecrawl enabled.');
      return;
    }
    setConfig((current) => ({ ...current, webProviderKeySource: 'config' }));
    setFirecrawlDialogOpen(true);
  }

  async function handleSaveFirecrawlKeyAndEnable() {
    const apiKey = webKeyDraft.trim();
    if (!apiKey) return;
    try {
      await saveWebProviderKey(apiKey);
      setConfig((current) => ({ ...current, webProvider: 'firecrawl', webProviderKeySource: 'config' }));
      setPluginNotice(locale === 'zh' ? 'Firecrawl 已开启。' : 'Firecrawl enabled.');
      closeFirecrawlDialog();
    } catch (error) {
      setPluginNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearFirecrawlKey() {
    try {
      await clearWebProviderKey();
      setConfig((current) => ({ ...current, webProvider: 'native_fetch', webProviderKeySource: 'config' }));
      setPluginNotice(locale === 'zh' ? '已清除 Firecrawl 密钥。' : 'Firecrawl key cleared.');
      closeFirecrawlDialog();
    } catch (error) {
      setPluginNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function adminHeaders(): Record<string, string> {
    return adminBootstrapToken.trim() ? { 'x-nexus-admin-bootstrap-token': adminBootstrapToken.trim() } : {};
  }

  async function refreshAuthTokens() {
    const response = await fetch('/api/admin/tokens', { headers: adminHeaders() });
    if (!response.ok) {
      setAuthTokenNotice(locale === 'zh' ? '需要管理员 JWT 或 Bootstrap Token。' : 'Admin JWT or bootstrap token is required.');
      return;
    }
    const data = (await response.json()) as { tokens?: AuthTokenPublic[] };
    setAuthTokens(data.tokens ?? []);
    setAuthTokenNotice('');
  }

  async function createAuthToken() {
    const response = await fetch('/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        ...newAuthToken,
        scopes: newAuthToken.scopes.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    });
    const data = (await response.json()) as { token?: string; record?: AuthTokenPublic; error?: string };
    if (!response.ok || !data.record) {
      setAuthTokenNotice(data.error ?? (locale === 'zh' ? '创建失败。' : 'Create failed.'));
      return;
    }
    setAuthTokens((current) => [data.record!, ...current.filter((item) => item.id !== data.record!.id)]);
    setAuthTokenNotice(data.token
      ? (locale === 'zh' ? `新 Token 仅显示一次：${data.token}` : `New token, shown once: ${data.token}`)
      : '');
  }

  async function deleteAuthToken(id: string) {
    const response = await fetch(`/api/admin/tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (!response.ok) return;
    setAuthTokens((current) => current.filter((item) => item.id !== id));
  }

  async function rotateAuthToken(id: string) {
    const response = await fetch(`/api/admin/tokens/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const data = (await response.json()) as { token?: string; record?: AuthTokenPublic; error?: string };
    if (!response.ok || !data.record) {
      setAuthTokenNotice(data.error ?? (locale === 'zh' ? '轮换失败。' : 'Rotate failed.'));
      return;
    }
    setAuthTokens((current) => current.map((item) => item.id === id ? data.record! : item));
    setAuthTokenNotice(data.token
      ? (locale === 'zh' ? `轮换后的 Token 仅显示一次：${data.token}` : `Rotated token, shown once: ${data.token}`)
      : '');
  }

  const refreshBotStatusAsync = useCallback(async () => {
    refreshBotStatus();
  }, [refreshBotStatus]);

  async function refreshMemories() {
    const response = await fetch('/api/memories');
    if (!response.ok) return;
    const data = (await response.json()) as { records?: MemoryRecord[]; settings?: Partial<RunConfig> };
    setMemoryRecords(data.records ?? []);
    if (data.settings) setConfig((current) => ({ ...current, ...data.settings! }));
  }

  async function saveMemorySettings(patch: Partial<RunConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    const response = await fetch('/api/memories/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: {
        memoryEnabled: next.memoryEnabled,
        autoExtractMemories: next.autoExtractMemories,
        useColdMemories: next.useColdMemories,
        memoryInjectLimit: next.memoryInjectLimit,
        memoryTokenBudget: next.memoryTokenBudget,
        episodeMemoryEnabled: next.episodeMemoryEnabled,
        episodeInjectLimit: next.episodeInjectLimit,
        episodeTokenBudget: next.episodeTokenBudget,
        episodeSwitchCooldownTurns: next.episodeSwitchCooldownTurns,
        episodeSealIdleMinutes: next.episodeSealIdleMinutes,
        episodeColdAfterDays: next.episodeColdAfterDays,
        episodeFtsCandidateLimit: next.episodeFtsCandidateLimit,
      } }),
    });
    setMemoryNotice(response.ok
      ? (locale === 'zh' ? '记忆设置已保存。' : 'Memory settings saved.')
      : (locale === 'zh' ? '记忆设置保存失败。' : 'Failed to save memory settings.'));
  }

  async function deleteMemory(id: string) {
    const response = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.ok) {
      setMemoryRecords((current) => current.filter((record) => record.id !== id));
      setMemoryNotice(locale === 'zh' ? '记忆已删除。' : 'Memory deleted.');
    }
  }

  async function exportMemories() {
    const response = await fetch('/api/memories/export', { method: 'POST' });
    const data = response.ok ? await response.json() as { outputDir?: string } : null;
    setMemoryNotice(response.ok
      ? (locale === 'zh' ? `已导出到 ${data?.outputDir ?? ''}` : `Exported to ${data?.outputDir ?? ''}`)
      : (locale === 'zh' ? '导出失败。' : 'Export failed.'));
  }

  function renderActivePage() {
    switch (activeSection) {
      case 'agent':
        return (
          <ModelsPage
            locale={locale}
            config={config}
            modelConfigDraft={controller.modelConfigDraft}
            setModelConfigDraft={controller.setModelConfigDraft}
            providers={providers}
            keyStates={keyStates}
            modelPresets={modelPresets}
            deleteModelPreset={deleteModelPreset}
            apiKeyDraft={controller.apiKeyDraft}
            setApiKeyDraft={controller.setApiKeyDraft}
            modelKeySource={controller.modelKeySource}
            setModelKeySource={controller.setModelKeySource}
            showSavedModelKey={controller.showSavedModelKey}
            setShowSavedModelKey={controller.setShowSavedModelKey}
            modelKeyNotice={controller.modelKeyNotice}
            modelEnvVarDraft={controller.modelEnvVarDraft}
            setModelEnvVarDraft={controller.setModelEnvVarDraft}
            modelEnvVarOptions={controller.modelEnvVarOptions}
            customProviderName={controller.customProviderName}
            setCustomProviderName={controller.setCustomProviderName}
            selectModelProviderDraft={controller.selectModelProviderDraft}
            loadModelPresetIntoDraft={controller.loadModelPresetIntoDraft}
            handleSaveModelConfig={controller.handleSaveModelConfig}
            handleSetCurrentModelConfig={controller.handleSetCurrentModelConfig}
            markDirty={controller.markDirty}
            dirtyFields={controller.dirtyFields}
          />
        );
      case 'appearance':
        return (
          <AppearancePage
            locale={locale}
            config={config}
            setConfig={setConfig}
            markDirty={controller.markDirty}
            dirtyFields={controller.dirtyFields}
          />
        );
      case 'memory':
        return (
          <MemoryPage
            locale={locale}
            config={config}
            memoryRecords={memoryRecords}
            memoryNotice={memoryNotice}
            saveMemorySettings={saveMemorySettings}
            deleteMemory={deleteMemory}
            exportMemories={exportMemories}
          />
        );
      case 'performance':
        return (
          <MonitorPage
            locale={locale}
            config={config}
            setConfig={setConfig}
            markDirty={controller.markDirty}
            dirtyFields={controller.dirtyFields}
          />
        );
      case 'plugins':
        return (
          <ToolsPage
            locale={locale}
            config={config}
            setConfig={setConfig}
            mcps={mcps}
            setMcps={setMcps}
            mcpStatuses={mcpStatuses}
            refreshMcpStatus={refreshMcpStatus}
            openAddMcpPanel={openAddMcpPanel}
            openEditMcpPanel={openEditMcpPanel}
            skillsList={skillsList}
            skillsRootDraft={skillsRootDraft}
            setSkillsRootDraft={setSkillsRootDraft}
            saveSkillsRoot={saveSkillsRoot}
            refreshSkills={refreshSkills}
            deleteSkill={deleteSkill}
            installRecommendedSkill={installRecommendedSkill}
            addRecommendedMcp={addRecommendedMcp}
            webProviderState={webProviderState}
            setFirecrawlDialogOpen={setFirecrawlDialogOpen}
            handleFirecrawlToggle={handleFirecrawlToggle}
            pluginNotice={pluginNotice}
            setPluginNotice={setPluginNotice}
            dirtyFields={controller.dirtyFields}
          />
        );
      case 'remote':
        return (
          <AgentsPage
            locale={locale}
            botConfig={botConfig}
            botStatus={botStatus}
            botDraft={botDraft}
            weixinNotice={weixinNotice}
            dingtalkNotice={dingtalkNotice}
            dingtalkTestConvId={dingtalkTestConvId}
            setDingtalkTestConvId={setDingtalkTestConvId}
            dingtalkTestConvType={dingtalkTestConvType}
            setDingtalkTestConvType={setDingtalkTestConvType}
            patchWeixin={patchWeixin}
            patchDingtalk={patchDingtalk}
            patchDwsCli={patchDwsCli}
            saveWeixinConfig={saveWeixinConfig}
            saveDingtalkConfig={saveDingtalkConfig}
            saveDwsCliConfig={saveDwsCliConfig}
            handleStartDingtalk={handleStartDingtalk}
            handleStopDingtalk={handleStopDingtalk}
            handleTestDingtalk={handleTestDingtalk}
            refreshBotStatus={refreshBotStatusAsync}
          />
        );
      case 'admin':
        return (
          <AboutPage
            locale={locale}
            showAdminControls={showAdminControls}
            adminBootstrapToken={adminBootstrapToken}
            setAdminBootstrapToken={setAdminBootstrapToken}
            newAuthToken={newAuthToken}
            setNewAuthToken={setNewAuthToken}
            authTokens={authTokens}
            authTokenNotice={authTokenNotice}
            refreshAuthTokens={refreshAuthTokens}
            createAuthToken={createAuthToken}
            deleteAuthToken={deleteAuthToken}
            rotateAuthToken={rotateAuthToken}
          />
        );
      default:
        return null;
    }
  }

  const firecrawlMasked = webProviderState?.firecrawl.masked ?? '';
  const firecrawlHasPreview = /[.•·]/.test(firecrawlMasked);
  const firecrawlConfigured = Boolean(webProviderState?.firecrawl.configured && firecrawlHasPreview);

  return (
    <>
      <SettingsShell
        locale={locale}
        open={true}
        onClose={() => setOpen(false)}
        settingsTabs={settingsTabs}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        saveState={controller.saveState}
        onSave={controller.handleSave}
        onCancel={controller.handleCancel}
        pluginMode={activeSection === 'plugins'}
        saveLabel={controller.saveLabel}
      >
        {renderActivePage()}
      </SettingsShell>

      <McpConfigDialog
        locale={locale}
        open={mcpPanelOpen}
        mcpDraft={mcpDraft}
        editingMcpId={editingMcpId}
        mcpCanSave={mcpCanSave}
        onClose={closeMcpPanel}
        setMcpDraft={setMcpDraft}
        onSave={saveMcp}
      />

      <FirecrawlKeyDialog
        locale={locale}
        open={firecrawlDialogOpen}
        webProviderState={webProviderState}
        firecrawlMasked={firecrawlMasked}
        firecrawlHasPreview={firecrawlHasPreview}
        firecrawlConfigured={firecrawlConfigured}
        webKeyDraft={webKeyDraft}
        setWebKeyDraft={setWebKeyDraft}
        onClose={closeFirecrawlDialog}
        onSave={handleSaveFirecrawlKeyAndEnable}
        onClear={handleClearFirecrawlKey}
      />
    </>
  );
}

export { saveModelPresetDraft } from './settings/shared.js';
