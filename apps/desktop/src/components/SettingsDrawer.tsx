// 设置面板入口薄壳（desktop 桌面端）：注册 Shell 与各 page；状态、handler 集中于此
// 与 web 差异：含 desktopCapabilities、logoutWeixin、bridgeMode='desktop_managed'、
// updateXxxConfig 在 patch 时立即 save；没有 admin tab；saveModelPreset 签名不同
import React, { useEffect, useState } from 'react';
import type { Locale, RunConfig } from '../config/config.js';
import { emptyMcp } from '../config/defaults.js';
import { upsertById } from '../features/chat/threadItems.js';
import { readDesktopCapabilities, type DesktopCapabilities } from '../api/desktopBridge.js';
import type { RecommendedMcp, RecommendedSkill } from '../features/settings/pluginCatalog.js';
import type { ApiKeyState, BotConfig, BotStatus, McpConfig, McpServerStatus, MemoryRecord, ModelPreset, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../shared/types.js';
import type { ModelPresetConfig } from '@nexus/protocol';
import { SettingsShell } from './settings/SettingsShell.js';
import { AppearancePage } from './settings/AppearancePage.js';
import { ModelsPage } from './settings/ModelsPage.js';
import { AgentsPage } from './settings/AgentsPage.js';
import { ToolsPage } from './settings/ToolsPage.js';
import { MonitorPage } from './settings/MonitorPage.js';
import { MemoryPage } from './settings/MemoryPage.js';
import { McpConfigDialog } from './settings/McpConfigDialog.js';
import { FirecrawlKeyDialog } from './settings/FirecrawlKeyDialog.js';
import { useSettingsController } from '../features/settings/useSettingsController.js';

const defaultBotConfig: BotConfig = {
  weixin: {
    enabled: false,
    bridgeMode: 'desktop_managed',
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

const defaultWeixinBridgeUrl = 'http://127.0.0.1:18790/api/v1/admin/rpc';

function preferDesktopBotConfig(config: BotConfig): BotConfig {
  return {
    ...config,
    weixin: {
      ...config.weixin,
      bridgeMode: 'desktop_managed',
      bridgeUrl: defaultWeixinBridgeUrl,
      syncHistoryOnConnect: config.weixin.syncHistoryOnConnect ?? true,
    },
  };
}

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
  saveEnvironmentVariables,
  skillsList,
  refreshSkills,
  refreshMcpStatus,
  refreshBotStatus,
  refreshProviders,
  refreshKeyStates,
  setConfig,
  setMcps,
  setOpen,
  saveBotConfig,
  logoutWeixin,
  saveWebProviderKey,
  clearWebProviderKey,
  consumePendingMcpDraft,
  webProviderState,
  startDingtalkStream,
  stopDingtalkStream,
  testDingtalkMessage,
  activeThreadId,
  saveThreadModelOverrides,
  saveGlobalModelConfig,
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
  refreshBotStatus: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshKeyStates: () => Promise<void>;
  requestModelPresetName: (defaultName: string) => Promise<string | null>;
  saveModelPreset: (name: string, presetConfig: ModelPresetConfig) => Promise<void>;
  deleteModelPreset: (presetId: string) => Promise<void>;
  saveSkillDraft: (draft: import('../shared/types.js').SkillDraft) => Promise<void>;
  saveBotConfig: (config: BotConfig) => Promise<void>;
  logoutWeixin: () => Promise<void>;
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  saveProviderEnvVar: (providerId: string, envVar: string) => Promise<void>;
  saveEnvironmentVariables: (text: string) => Promise<void>;
  saveWebProviderKey: (apiKey: string) => Promise<void>;
  clearWebProviderKey: () => Promise<void>;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  setOpen: (open: boolean) => void;
  consumePendingMcpDraft?: () => void;
  webProviderState: WebProviderPublicConfig | null;
  startDingtalkStream: () => Promise<{ ok?: boolean; error?: string }>;
  stopDingtalkStream: () => Promise<void>;
  testDingtalkMessage: (conversationId: string, conversationType: 'dm' | 'group', text?: string) => Promise<{ ok?: boolean; error?: string }>;
  activeThreadId: string;
  saveThreadModelOverrides: (overrides: { provider: string; model: string; baseUrl: string }) => Promise<void>;
  saveGlobalModelConfig: (config: RunConfig) => void;
}) {
  const settings = useSettingsController({
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
    saveEnvironmentVariables,
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
  const [desktopCapabilities, setDesktopCapabilities] = useState<DesktopCapabilities | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpConfig>(emptyMcp());
  const [editingMcpId, setEditingMcpId] = useState('');
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [webKeyDraft, setWebKeyDraft] = useState('');
  const [firecrawlDialogOpen, setFirecrawlDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('agent');
  const [pluginNotice, setPluginNotice] = useState('');
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryNotice, setMemoryNotice] = useState('');

  const dingtalkStatus = botStatus?.dingtalk;
  const dingtalkConfigured = Boolean(botDraft.dingtalk.clientId && botDraft.dingtalk.clientSecret);

  const settingsTabs = [
    { id: 'agent', label: locale === 'zh' ? '模型' : 'Model' },
    { id: 'appearance', label: locale === 'zh' ? '外观' : 'Appearance' },
    { id: 'memory', label: locale === 'zh' ? '记忆' : 'Memory' },
    { id: 'performance', label: locale === 'zh' ? '性能' : 'Performance' },
    { id: 'plugins', label: locale === 'zh' ? '插件中心' : 'Plugins' },
    { id: 'remote', label: locale === 'zh' ? '远程助手' : 'Remote bots' },
  ];

  useEffect(() => {
    setSkillsRootDraft(config.skillsRoot);
    if (!config.skillsRoot) {
      void ensureSkillsRoot();
    }
  }, [config.skillsRoot]);

  useEffect(() => {
    if (botConfig) setBotDraft(preferDesktopBotConfig(botConfig));
  }, [botConfig]);

  useEffect(() => {
    void readDesktopCapabilities().then(setDesktopCapabilities);
  }, []);

  useEffect(() => {
    if (!pendingMcpDraft) return;
    setMcpDraft(pendingMcpDraft);
    setEditingMcpId('');
    setMcpPanelOpen(true);
    consumePendingMcpDraft?.();
  }, [consumePendingMcpDraft, pendingMcpDraft]);

  useEffect(() => {
    if (activeSection === 'memory') void refreshMemories();
  }, [activeSection]);

  async function ensureSkillsRoot() {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const data = (await response.json()) as { config?: Partial<RunConfig> };
    const skillsRoot = data.config?.skillsRoot;
    if (!skillsRoot) return;
    setSkillsRootDraft(skillsRoot);
    setConfig((current) => current.skillsRoot ? current : { ...current, skillsRoot });
  }

  function saveSkillsRoot() {
    setConfig({ ...config, skillsRoot: skillsRootDraft });
    settings.markDirty('skillsRoot', false);
  }

  async function updateWeixinConfig(patch: Partial<BotConfig['weixin']>) {
    const next = {
      ...botDraft,
      weixin: {
        ...botDraft.weixin,
        ...patch,
        bridgeMode: 'desktop_managed' as const,
        bridgeUrl: defaultWeixinBridgeUrl,
      },
    };
    setBotDraft(next);
    await saveBotConfig(next);
    setWeixinNotice(locale === 'zh' ? '远程助手设置已更新。' : 'Remote assistant setting updated.');
  }

  async function handleWeixinLogout() {
    await logoutWeixin();
    setWeixinNotice(locale === 'zh' ? '微信账号已退出。' : 'WeChat account logged out.');
  }

  function patchDingtalk(patch: Partial<BotConfig['dingtalk']>) {
    setBotDraft({
      ...botDraft,
      dingtalk: { ...botDraft.dingtalk, ...patch },
    });
  }

  async function updateDingtalkConfig(patch: Partial<BotConfig['dingtalk']>) {
    const next = {
      ...botDraft,
      dingtalk: { ...botDraft.dingtalk, ...patch },
    };
    setBotDraft(next);
    await saveBotConfig(next);
    setDingtalkNotice(locale === 'zh' ? '钉钉设置已更新。' : 'DingTalk settings updated.');
  }

  function patchDwsCli(patch: Partial<BotConfig['dwsCli']>) {
    setBotDraft({
      ...botDraft,
      dwsCli: { ...botDraft.dwsCli, ...patch },
    });
  }

  async function updateDwsCliConfig(patch: Partial<BotConfig['dwsCli']>) {
    const next = {
      ...botDraft,
      dwsCli: { ...botDraft.dwsCli, ...patch },
    };
    setBotDraft(next);
    await saveBotConfig(next);
    setDingtalkNotice(locale === 'zh' ? '钉钉 CLI 设置已更新。' : 'DingTalk CLI settings updated.');
  }

  async function handleStartDingtalk() {
    const result = await startDingtalkStream();
    if (result.ok) {
      setDingtalkNotice(locale === 'zh' ? '钉钉 Stream 已连接。' : 'DingTalk Stream connected.');
    } else {
      setDingtalkNotice(locale === 'zh' ? `连接失败：${result.error || '未知错误'}` : `Connection failed: ${result.error || 'unknown error'}`);
    }
  }

  async function handleStopDingtalk() {
    await stopDingtalkStream();
    setDingtalkNotice(locale === 'zh' ? '钉钉 Stream 已停止。' : 'DingTalk Stream stopped.');
  }

  async function handleTestDingtalk() {
    if (!dingtalkTestConvId.trim()) {
      setDingtalkNotice(locale === 'zh' ? '请输入会话 ID。' : 'Please enter conversation ID.');
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

  function saveMcp() {
    if (!mcpCanSave) return;
    setMcps((current) => upsertById(current, {
      id: editingMcpId || crypto.randomUUID(),
      name: mcpDraft.name.trim(),
      command: mcpDraft.command.trim(),
      args: mcpDraft.args.trim(),
      enabled: mcpDraft.enabled,
    }));
    closeMcpPanel();
  }

  const mcpCanSave = Boolean(mcpDraft.name.trim() && mcpDraft.command.trim());

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
    if (!apiKey) {
      return;
    }
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

  async function refreshMemories() {
    const response = await fetch('/api/memories');
    if (!response.ok) return;
    const data = (await response.json()) as { records?: MemoryRecord[]; settings?: Partial<RunConfig> };
    setMemoryRecords(data.records ?? []);
    if (data.settings) {
      setConfig((current) => ({ ...current, ...data.settings }));
    }
  }

  async function saveMemorySettings(patch: Partial<RunConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    const response = await fetch('/api/memories/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
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
        },
      }),
    });
    setMemoryNotice(response.ok ? (locale === 'zh' ? '记忆设置已保存。' : 'Memory settings saved.') : (locale === 'zh' ? '记忆设置保存失败。' : 'Failed to save memory settings.'));
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
            modelConfigDraft={settings.modelConfigDraft}
            setModelConfigDraft={settings.setModelConfigDraft}
            providers={providers}
            keyStates={keyStates}
            modelPresets={modelPresets}
            deleteModelPreset={deleteModelPreset}
            apiKeyDraft={settings.apiKeyDraft}
            setApiKeyDraft={settings.setApiKeyDraft}
            modelKeySource={settings.modelKeySource}
            setModelKeySource={settings.setModelKeySource}
            showSavedModelKey={settings.showSavedModelKey}
            setShowSavedModelKey={settings.setShowSavedModelKey}
            modelKeyNotice={settings.modelKeyNotice}
            modelEnvVarDraft={settings.modelEnvVarDraft}
            setModelEnvVarDraft={settings.setModelEnvVarDraft}
            modelEnvVarOptions={settings.modelEnvVarOptions}
            modelEnvBatchText={settings.modelEnvBatchText}
            setModelEnvBatchText={settings.setModelEnvBatchText}
            customProviderName={settings.customProviderName}
            setCustomProviderName={settings.setCustomProviderName}
            selectModelProviderDraft={settings.selectModelProviderDraft}
            loadModelPresetIntoDraft={settings.loadModelPresetIntoDraft}
            handleBatchSetModelEnv={settings.handleBatchSetModelEnv}
            handleSaveModelConfig={settings.handleSaveModelConfig}
            handleSetCurrentModelConfig={settings.handleSetCurrentModelConfig}
            markDirty={settings.markDirty}
            dirtyFields={settings.dirtyFields}
          />
        );
      case 'appearance':
        return (
          <AppearancePage
            locale={locale}
            config={config}
            setConfig={setConfig}
            markDirty={settings.markDirty}
            dirtyFields={settings.dirtyFields}
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
            markDirty={settings.markDirty}
            dirtyFields={settings.dirtyFields}
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
            dirtyFields={settings.dirtyFields}
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
            desktopCapabilities={desktopCapabilities}
            dingtalkConfigured={dingtalkConfigured}
            dingtalkStatus={dingtalkStatus}
            updateWeixinConfig={updateWeixinConfig}
            updateDingtalkConfig={updateDingtalkConfig}
            updateDwsCliConfig={updateDwsCliConfig}
            patchDingtalk={patchDingtalk}
            patchDwsCli={patchDwsCli}
            handleWeixinLogout={handleWeixinLogout}
            handleStartDingtalk={handleStartDingtalk}
            handleStopDingtalk={handleStopDingtalk}
            handleTestDingtalk={handleTestDingtalk}
            refreshBotStatus={refreshBotStatus}
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
        saveState={settings.saveState}
        onSave={settings.handleSave}
        onCancel={settings.handleCancel}
        saveLabel={settings.saveLabel}
        pluginMode={activeSection === 'plugins'}
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
