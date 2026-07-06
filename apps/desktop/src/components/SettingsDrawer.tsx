import React, { useEffect, useState } from 'react';
import { RUN_CONFIG_STORAGE_KEY, type Locale, type RunConfig, type SecretSource, type ThemeMode } from '../config/config.js';
import { Icon, type IconName } from './Icon.js';
import { DropdownSelect, type DropdownOption } from './DropdownSelect.js';
import { emptyMcp } from '../config/defaults.js';
import { readDesktopCapabilities, type DesktopCapabilities } from '../api/desktopBridge.js';
import { formatTimestamp, t } from '../shared/i18n.js';
import { localizedSkillDescription } from '../features/settings/skillDescriptions.js';
import { recommendedPluginCatalog, type RecommendedMcp, type RecommendedSkill } from '../features/settings/pluginCatalog.js';
import { upsertById } from '../features/chat/threadItems.js';
import { CUSTOM_USER_AVATAR_ID, DEFAULT_USER_AVATAR_ID, USER_AVATAR_OPTIONS, UserAvatar, userAvatarLabel } from './UserAvatar.js';
import type { ApiKeyState, BotConfig, BotStatus, McpConfig, McpServerStatus, MemoryRecord, ModelPreset, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../shared/types.js';

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

export function SettingsDrawer({
  applyModelPreset,
  botConfig,
  botStatus,
  config,
  deleteModelPreset,
  deleteSkill,
  keyStates,
  locale,
  mcps,
  mcpStatuses,
  modelPresets,
  providers,
  pendingMcpDraft,
  saveModelPreset,
  saveSkillDraft,
  saveProviderKey,
  skillsList,
  refreshSkills,
  refreshMcpStatus,
  refreshBotStatus,
  selectProvider,
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
}: {
  applyModelPreset: (preset: ModelPreset) => void;
  botConfig: BotConfig | null;
  botStatus: BotStatus | null;
  clearProviderKey: (providerId: string) => Promise<void>;
  config: RunConfig;
  deleteModelPreset: (id: string) => Promise<void>;
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
  saveModelPreset: () => Promise<void>;
  saveSkillDraft: (draft: import('../shared/types.js').SkillDraft) => Promise<void>;
  saveBotConfig: (config: BotConfig) => Promise<void>;
  logoutWeixin: () => Promise<void>;
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  saveWebProviderKey: (apiKey: string) => Promise<void>;
  clearWebProviderKey: () => Promise<void>;
  selectProvider: (providerId: string) => void;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  setOpen: (open: boolean) => void;
  consumePendingMcpDraft?: () => void;
  webProviderState: WebProviderPublicConfig | null;
  startDingtalkStream: () => Promise<{ ok?: boolean; error?: string }>;
  stopDingtalkStream: () => Promise<void>;
  testDingtalkMessage: (conversationId: string, conversationType: 'dm' | 'group', text?: string) => Promise<{ ok?: boolean; error?: string }>;
}) {
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
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [webKeyDraft, setWebKeyDraft] = useState('');
  const [firecrawlDialogOpen, setFirecrawlDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('agent');
  const [activePluginTab, setActivePluginTab] = useState<'recommended' | 'mcp' | 'skills' | 'web'>('recommended');
  const [pluginSearch, setPluginSearch] = useState('');
  const [pluginNotice, setPluginNotice] = useState('');
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryNotice, setMemoryNotice] = useState('');
  const [memoryAdvancedExpanded, setMemoryAdvancedExpanded] = useState(false);
  const [modelKeySource, setModelKeySource] = useState<SecretSource>('env');
  const [showSavedModelKey, setShowSavedModelKey] = useState(false);
  const selectedProvider = providers.find((provider) => provider.id === config.provider);
  const selectedKeyState = keyStates.find((state) => state.providerId === config.provider);
  const firecrawlMasked = webProviderState?.firecrawl.masked ?? '';
  const firecrawlHasPreview = /[.•·]/.test(firecrawlMasked);
  const firecrawlConfigured = Boolean(webProviderState?.firecrawl.configured && firecrawlHasPreview);
  const firecrawlEnabled = config.webProvider === 'firecrawl';
  const mcpPanelTitle = editingMcpId ? t(locale, 'editMcp') : t(locale, 'addMcp');
  const pluginQuery = pluginSearch.trim().toLowerCase();
  const filteredRecommendedCatalog = recommendedPluginCatalog.filter((item) => {
    if (!pluginQuery) return true;
    return [
      item.name,
      item.titleZh,
      item.titleEn,
      item.descriptionZh,
      item.descriptionEn,
      item.type,
    ].some((value) => value.toLowerCase().includes(pluginQuery));
  });
  const filteredMcps = mcps.filter((item) => {
    if (!pluginQuery) return true;
    return [item.name, item.command, item.args].some((value) => value.toLowerCase().includes(pluginQuery));
  });
  const filteredSkills = skillsList.filter((skill) => {
    if (!pluginQuery) return true;
    return [
      skill.name,
      localizedSkillDescription(skill, locale),
      skill.sourcePath ?? '',
    ].some((value) => value.toLowerCase().includes(pluginQuery));
  });
  const webTools = [
    {
      id: 'native_fetch',
      title: locale === 'zh' ? '本地读取' : 'Local fetch',
      description: locale === 'zh' ? '直接读取网页内容，无需外部密钥。' : 'Read page content directly with no external key.',
    },
    {
      id: 'firecrawl',
      title: 'Firecrawl',
      description: locale === 'zh' ? '适合复杂网页抓取和结构化提取。' : 'Best for complex crawling and structured extraction.',
    },
  ].filter((item) => {
    if (!pluginQuery) return true;
    return [item.title, item.description, item.id].some((value) => value.toLowerCase().includes(pluginQuery));
  });
  const pluginNavItems = [
    {
      id: 'recommended' as const,
      label: locale === 'zh' ? '推荐' : 'Recommended',
      count: filteredRecommendedCatalog.length,
      total: recommendedPluginCatalog.length,
      icon: 'spark' as const,
    },
    {
      id: 'mcp' as const,
      label: 'MCP',
      count: filteredMcps.length,
      total: mcps.length,
      icon: 'panel' as const,
    },
    {
      id: 'skills' as const,
      label: t(locale, 'skills'),
      count: filteredSkills.length,
      total: skillsList.length,
      icon: 'workflow' as const,
    },
    {
      id: 'web' as const,
      label: locale === 'zh' ? '联网工具' : 'Web tools',
      count: webTools.length,
      total: 2,
      icon: 'search' as const,
    },
  ];
  const activePluginNav = pluginNavItems.find((item) => item.id === activePluginTab) ?? pluginNavItems[0];
  const settingsTabs = [
    { id: 'agent', label: locale === 'zh' ? '模型' : 'Model' },
    { id: 'appearance', label: locale === 'zh' ? '外观' : 'Appearance' },
    { id: 'memory', label: locale === 'zh' ? '记忆' : 'Memory' },
    { id: 'performance', label: locale === 'zh' ? '性能' : 'Performance' },
    { id: 'presets', label: t(locale, 'modelPresets') },
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

  useEffect(() => {
    if (config.webSearchMode !== 'auto') {
      setConfig((current) => ({ ...current, webSearchMode: 'auto' }));
    }
  }, [config.webSearchMode, setConfig]);

  useEffect(() => {
    setModelKeySource(selectedKeyState?.source === 'config' ? 'config' : 'env');
    setApiKeyDraft('');
    setShowSavedModelKey(false);
  }, [config.provider, selectedKeyState?.source]);

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
  }

  function patchWeixin(patch: Partial<BotConfig['weixin']>): BotConfig {
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
    return next;
  }

  async function updateWeixinConfig(patch: Partial<BotConfig['weixin']>) {
    const next = patchWeixin(patch);
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

  async function handleStartDingtalkStream() {
    const result = await startDingtalkStream();
    if (result.ok) {
      setDingtalkNotice(locale === 'zh' ? '钉钉 Stream 已启动。' : 'DingTalk Stream started.');
    } else {
      setDingtalkNotice(locale === 'zh' ? `启动失败: ${result.error}` : `Start failed: ${result.error}`);
    }
  }

  async function handleStopDingtalkStream() {
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
      setDingtalkNotice(locale === 'zh' ? `发送失败: ${result.error}` : `Send failed: ${result.error}`);
    }
  }

  const dingtalkStatus = botStatus?.dingtalk;
  const dingtalkConfigured = Boolean(botDraft.dingtalk.clientId && botDraft.dingtalk.clientSecret);

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
    setActivePluginTab('mcp');
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
    if (!mcpDraft.name.trim() || !mcpDraft.command.trim()) return;
    setMcps((current) => upsertById(current, { ...mcpDraft, id: editingMcpId || crypto.randomUUID() }));
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

  async function saveModelKeyDraftIfNeeded() {
    if (selectedProvider?.isLocal) return;
    if (modelKeySource !== 'config') return;
    const nextKey = apiKeyDraft.trim();
    if (!nextKey) return;
    await saveProviderKey(config.provider, nextKey);
    setApiKeyDraft('');
  }

  async function handleSaveModelConfig() {
    await saveModelKeyDraftIfNeeded();
    await saveModelPreset();
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

  async function handleSetCurrentModelConfig() {
    await saveModelKeyDraftIfNeeded();
    const normalizedConfig = { ...config, webSearchMode: 'auto' as const };
    localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify(normalizedConfig));
    setConfig(normalizedConfig);
  }

  function modelKeyEnvStatus() {
    const envVar = selectedProvider?.apiKeyEnvVar || selectedKeyState?.envVar || 'API_KEY';
    const configuredByEnv = selectedKeyState?.configured && selectedKeyState.source === 'env';
    return `${envVar}(${configuredByEnv ? (locale === 'zh' ? '已配置' : 'configured') : (locale === 'zh' ? '未发现' : 'missing')})`;
  }

  function savedModelKeyPlaceholder() {
    const hasSavedKey = selectedKeyState?.configured && selectedKeyState.source === 'config';
    if (!hasSavedKey) return locale === 'zh' ? '未保存密钥' : 'No saved key';
    if (showSavedModelKey) return selectedKeyState.masked ?? (locale === 'zh' ? '已保存密钥' : 'Saved key');
    return '••••••••••••••••';
  }

  function selectUserAvatar(userAvatarId: RunConfig['userAvatarId']) {
    setConfig((current) => ({ ...current, userAvatarId }));
  }

  function resetUserAvatar() {
    setConfig((current) => ({
      ...current,
      userAvatarId: DEFAULT_USER_AVATAR_ID,
      customUserAvatarDataUrl: '',
    }));
  }

  function handleUserAvatarUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      setConfig((current) => ({
        ...current,
        userAvatarId: CUSTOM_USER_AVATAR_ID,
        customUserAvatarDataUrl: result,
      }));
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="settingsLayer">
      <button className="scrim" aria-label={t(locale, 'cancel')} onClick={() => setOpen(false)} />
      <aside className="settingsDrawer" aria-label={t(locale, 'settings')}>
        <header className="settingsHeader">
          <div>
            <h2>{t(locale, 'settings')}</h2>
          </div>
          <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={() => setOpen(false)}>
            <Icon name="x" />
          </button>
        </header>

        <div className="settingsBody">
          <nav className="settingsNav" aria-label={t(locale, 'settings')}>
            {settingsTabs.map((tab) => (
              <button
                className={activeSection === tab.id ? 'active' : ''}
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className={`settingsContent ${activeSection === 'plugins' ? 'pluginContentMode' : ''}`}>
            {activeSection === 'agent' ? (
            <section className="settingsSection settingsHero modelSettingsPanel" id="settings-agent">
              <h3>{locale === 'zh' ? '模型' : 'Model'}</h3>
              <div className="formGrid modelSettingsList">
                <label className="modelConfigRow">
                  <span>{t(locale, 'provider')}</span>
                  <DropdownSelect className="modelProviderSelect" value={config.provider} onChange={selectProvider} options={providerDropdownOptions(providers, locale)} />
                </label>
                <label className="modelConfigRow">
                  <span>{t(locale, 'model')}</span>
                  <input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} />
                </label>
                <label className="modelConfigRow">
                  <span>{t(locale, 'baseUrl')}</span>
                  <input placeholder="provider default" value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
                </label>
              </div>
              <div className="providerCard compactProviderCard modelKeyCard">
                {selectedProvider?.isLocal ? (
                  <input readOnly value={t(locale, 'noKeyNeeded')} />
                ) : (
                  <>
                    <DropdownSelect<SecretSource>
                      className="modelKeySourceSelect"
                      value={modelKeySource}
                      onChange={(source) => {
                        setModelKeySource(source);
                        setApiKeyDraft('');
                        setShowSavedModelKey(false);
                      }}
                      options={[
                        { value: 'env', label: locale === 'zh' ? '环境变量' : 'Environment' },
                        { value: 'config', label: locale === 'zh' ? '已保存密钥' : 'Saved key' },
                      ]}
                    />
                    {modelKeySource === 'env' ? (
                      <input className="modelKeyStatusInput" readOnly value={modelKeyEnvStatus()} />
                    ) : (
                      <div className="savedModelKeyField">
                      <input
                        placeholder={savedModelKeyPlaceholder()}
                        value={apiKeyDraft}
                        onChange={(event) => setApiKeyDraft(event.target.value)}
                        type={showSavedModelKey ? 'text' : 'password'}
                      />
                      <button
                        aria-label={showSavedModelKey ? (locale === 'zh' ? '隐藏密钥' : 'Hide key') : (locale === 'zh' ? '显示密钥' : 'Show key')}
                        className="miniIconButton"
                        onClick={() => setShowSavedModelKey((current) => !current)}
                        type="button"
                      >
                        <Icon name={showSavedModelKey ? 'eyeOff' : 'eye'} />
                      </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modelSettingsActions">
                <button className="solidButton" onClick={() => void handleSaveModelConfig()}>
                  {locale === 'zh' ? '保存模型配置' : 'Save model config'}
                </button>
                <button className="textButton" onClick={() => void handleSetCurrentModelConfig()}>
                  {locale === 'zh' ? '设置当前模型配置' : 'Set current model config'}
                </button>
              </div>
            </section>
            ) : null}

            {activeSection === 'appearance' ? (
            <section className="settingsSection" id="settings-appearance">
              <div className="presetHeader">
                <div>
                  <h3>{locale === 'zh' ? '外观' : 'Appearance'}</h3>
                  <span>{locale === 'zh' ? '界面主题' : 'Interface theme'}</span>
                </div>
              </div>
              <div className="formGrid modelSettingsList">
                <label>
                  {locale === 'zh' ? '主题' : 'Theme'}
                  <DropdownSelect<ThemeMode> value={config.themeMode} onChange={(themeMode) => setConfig({ ...config, themeMode })} options={[{ value: 'dark', label: locale === 'zh' ? '深色' : 'Dark' }, { value: 'light', label: locale === 'zh' ? '浅色' : 'Light' }, { value: 'system', label: locale === 'zh' ? '跟随系统' : 'System' }]} />
                </label>
                <label>
                  {t(locale, 'language')}
                  <DropdownSelect<Locale> value={config.locale} onChange={(locale) => setConfig({ ...config, locale })} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
                </label>
              </div>
              <div className="avatarSettingsPanel">
                <div className="avatarSettingsHeader">
                  <div>
                    <strong>{locale === 'zh' ? '用户头像' : 'User avatar'}</strong>
                    <span>{locale === 'zh' ? '用于右侧用户消息，与 Agent 头像区分显示' : 'Shown on the right side of user messages, separate from agent avatars'}</span>
                  </div>
                  <div className="avatarSettingsPreview">
                    <UserAvatar avatarId={config.userAvatarId} customDataUrl={config.customUserAvatarDataUrl} size="lg" />
                    <span>{userAvatarLabel(config.userAvatarId, locale)}</span>
                  </div>
                </div>
                <div className="userAvatarGrid" aria-label={locale === 'zh' ? '选择用户头像' : 'Choose user avatar'}>
                  {USER_AVATAR_OPTIONS.map((option) => (
                    <button
                      className={config.userAvatarId === option.id ? 'userAvatarOption active' : 'userAvatarOption'}
                      key={option.id}
                      onClick={() => selectUserAvatar(option.id)}
                      type="button"
                    >
                      <UserAvatar avatarId={option.id} size="md" />
                      <span>{locale === 'zh' ? option.labelZh : option.labelEn}</span>
                    </button>
                  ))}
                  <label className={config.userAvatarId === CUSTOM_USER_AVATAR_ID ? 'userAvatarOption userAvatarUploadOption active' : 'userAvatarOption userAvatarUploadOption'}>
                    <input className="userAvatarUploadInput" accept="image/*" type="file" onChange={handleUserAvatarUpload} />
                    <UserAvatar avatarId={CUSTOM_USER_AVATAR_ID} customDataUrl={config.customUserAvatarDataUrl} size="md" />
                    <span>{config.customUserAvatarDataUrl ? (locale === 'zh' ? '更换自定义' : 'Replace custom') : (locale === 'zh' ? '上传自定义' : 'Upload custom')}</span>
                  </label>
                </div>
                <div className="avatarSettingsActions">
                  {config.customUserAvatarDataUrl ? (
                    <button className="textButton" type="button" onClick={() => selectUserAvatar(CUSTOM_USER_AVATAR_ID)}>
                      {locale === 'zh' ? '使用自定义头像' : 'Use custom avatar'}
                    </button>
                  ) : null}
                  <button className="textButton" type="button" onClick={resetUserAvatar}>
                    {locale === 'zh' ? '恢复默认头像' : 'Reset avatar'}
                  </button>
                </div>
              </div>
            </section>
            ) : null}

            {activeSection === 'memory' ? (
            <section className="settingsSection" id="settings-memory">
              <div className="presetHeader">
                <div>
                  <h3>{locale === 'zh' ? '记忆' : 'Memory'}</h3>
                  <span>{locale === 'zh' ? '热记忆来自当前运行，温记忆来自任务片段，冷记忆来自持久记录' : 'Hot memory is runtime state, warm memory is task episodes, cold memory is persistent records'}</span>
                </div>
                <button className="textButton" type="button" onClick={() => void exportMemories()}>
                  {locale === 'zh' ? '导出审计镜像' : 'Export audit mirror'}
                </button>
              </div>
              <div className="formGrid modelSettingsList">
                <label className="toggle">
                  <input
                    checked={config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ memoryEnabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '启用记忆系统' : 'Enable memory'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '启用记忆系统' : 'Enable memory'}</strong>
                      {locale === 'zh' ? '总开关。关闭后所有记忆功能都会失效，包括长期记忆、情景记忆和轻量笔记。' : 'Master switch. When off, all memory features are disabled, including long-term memory, episode memory, and light notes.'}
                    </span>
                  </span>
                </label>
                <label className="toggle">
                  <input
                    checked={config.autoExtractMemories}
                    disabled={!config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ autoExtractMemories: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '自动保存长期记忆' : 'Auto extract cold memories'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '自动保存长期记忆' : 'Auto extract cold memories'}</strong>
                      {locale === 'zh' ? '对话结束后，AI 会自动从对话中提炼有价值的知识点、用户偏好、决策结论等，存到长期记忆库里。关掉就不会自动存了。' : 'After each conversation, AI automatically extracts valuable facts, preferences, and decisions into long-term memory. Turn off to disable auto-saving.'}
                    </span>
                  </span>
                </label>
                <label className="toggle">
                  <input
                    checked={config.useColdMemories}
                    disabled={!config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ useColdMemories: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '对话时参考长期记忆' : 'Use cold memories at runtime'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '对话时参考长期记忆' : 'Use cold memories at runtime'}</strong>
                      {locale === 'zh' ? '生成回答时，会不会去记忆库里翻相关的旧记忆来参考。关掉的话，AI 就"记不住"以前的事了。' : 'When generating responses, AI will retrieve relevant past memories for reference. When off, AI won\'t recall previous conversations.'}
                    </span>
                  </span>
                </label>
                <label>
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '最多参考条数' : 'Inject limit'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '最多参考条数' : 'Inject limit'}</strong>
                      {locale === 'zh' ? '每次对话最多从记忆库里找几条记忆塞进上下文。越多越全，但也越占 token。' : 'Maximum number of memory entries injected into context per turn. More means more context but uses more tokens.'}
                    </span>
                  </span>
                  <input
                    min={1}
                    max={20}
                    type="number"
                    value={config.memoryInjectLimit}
                    onChange={(event) => void saveMemorySettings({ memoryInjectLimit: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '记忆占用 Token 上限' : 'Token budget'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '记忆占用 Token 上限' : 'Token budget'}</strong>
                      {locale === 'zh' ? '记忆内容最多占多少 token。省着点用，留给主对话更多空间。' : 'Maximum tokens allocated for memory content. Save tokens for the main conversation.'}
                    </span>
                  </span>
                  <input
                    min={200}
                    max={4000}
                    step={100}
                    type="number"
                    value={config.memoryTokenBudget}
                    onChange={(event) => void saveMemorySettings({ memoryTokenBudget: Number(event.target.value) })}
                  />
                </label>
              </div>
              <div className="presetHeader">
                <div>
                  <h4>{locale === 'zh' ? '情景记忆（任务片段）' : 'Episode memory'}</h4>
                  <span>{locale === 'zh' ? '把一次完整的任务打包记住，包含目标、进展、产出文件等' : 'Remember complete tasks with goals, progress, and artifacts'}</span>
                </div>
              </div>
              <div className="formGrid modelSettingsList">
                <label className="toggle">
                  <input
                    checked={config.episodeMemoryEnabled}
                    disabled={!config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ episodeMemoryEnabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '启用情景记忆' : 'Enable episode memory'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '启用情景记忆' : 'Enable episode memory'}</strong>
                      {locale === 'zh' ? '把每次完整的任务/对话打包成一个"情景记忆"，里面包含目标、进展、决策、产出文件等结构化信息。比零散的冷记忆更有条理。' : 'Packages each complete task/conversation into an "episode" with goals, progress, decisions, and artifacts. More structured than scattered cold memories.'}
                    </span>
                  </span>
                </label>
                <label>
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '最多参考情景数' : 'Inject limit'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '最多参考情景数' : 'Inject limit'}</strong>
                      {locale === 'zh' ? '每次对话最多注入几个相关的情景记忆。' : 'Maximum number of related episodes injected per conversation.'}
                    </span>
                  </span>
                  <input
                    min={0}
                    max={10}
                    type="number"
                    disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                    value={config.episodeInjectLimit}
                    onChange={(event) => void saveMemorySettings({ episodeInjectLimit: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '情景记忆 Token 上限' : 'Token budget'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '情景记忆 Token 上限' : 'Token budget'}</strong>
                      {locale === 'zh' ? '情景记忆内容最多占多少 token。' : 'Maximum tokens allocated for episode memory content.'}
                    </span>
                  </span>
                  <input
                    min={200}
                    max={4000}
                    step={100}
                    type="number"
                    disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                    value={config.episodeTokenBudget}
                    onChange={(event) => void saveMemorySettings({ episodeTokenBudget: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '温记忆保存天数' : 'Cold after days'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '温记忆保存天数' : 'Cold after days'}</strong>
                      {locale === 'zh' ? '情景记忆（温记忆）多少天没被用到，就降级成冷记忆。冷记忆检索稍慢但更省空间。' : 'Days before warm episodes degrade to cold memory. Cold memory is slower to retrieve but saves space.'}
                    </span>
                  </span>
                  <input
                    min={1}
                    max={365}
                    type="number"
                    disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                    value={config.episodeColdAfterDays}
                    onChange={(event) => void saveMemorySettings({ episodeColdAfterDays: Number(event.target.value) })}
                  />
                </label>
              </div>
              <button
                className={`memoryAdvancedToggle ${memoryAdvancedExpanded ? 'expanded' : ''}`}
                type="button"
                onClick={() => setMemoryAdvancedExpanded((v) => !v)}
              >
                <Icon name="chevronDown" />
                {locale === 'zh' ? '高级设置' : 'Advanced settings'}
              </button>
              <div className={`memoryAdvancedPanel ${memoryAdvancedExpanded ? 'expanded' : ''}`}>
                <div className="formGrid modelSettingsList">
                  <label>
                    <span className="settingRow">
                      <span className="settingLabel">
                        {locale === 'zh' ? '切换冷却回合数' : 'Switch cooldown turns'}
                        <span className="settingHelpIcon">
                          <Icon name="question" />
                        </span>
                      </span>
                      <span className="settingTooltip">
                        <strong>{locale === 'zh' ? '切换冷却回合数' : 'Switch cooldown turns'}</strong>
                        {locale === 'zh' ? '至少隔几轮对话才能切换到新的情景。防止话题频繁切换时情景也跟着跳来跳去，保持稳定。' : 'Minimum turns before switching to a new episode. Prevents rapid episode switching when topics change frequently.'}
                      </span>
                    </span>
                    <input
                      min={0}
                      max={20}
                      type="number"
                      disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                      value={config.episodeSwitchCooldownTurns}
                      onChange={(event) => void saveMemorySettings({ episodeSwitchCooldownTurns: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span className="settingRow">
                      <span className="settingLabel">
                        {locale === 'zh' ? '空闲封存分钟数' : 'Seal idle minutes'}
                        <span className="settingHelpIcon">
                          <Icon name="question" />
                        </span>
                      </span>
                      <span className="settingTooltip">
                        <strong>{locale === 'zh' ? '空闲封存分钟数' : 'Seal idle minutes'}</strong>
                        {locale === 'zh' ? '对话停多久后，把当前进行中的情景"打包封存"成温记忆。封存后就可以被其他对话检索到了。' : 'Minutes of inactivity before sealing the current episode as warm memory. Once sealed, it can be retrieved by other conversations.'}
                      </span>
                    </span>
                    <input
                      min={1}
                      max={1440}
                      type="number"
                      disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                      value={config.episodeSealIdleMinutes}
                      onChange={(event) => void saveMemorySettings({ episodeSealIdleMinutes: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span className="settingRow">
                      <span className="settingLabel">
                        {locale === 'zh' ? '搜索候选数量' : 'FTS candidate limit'}
                        <span className="settingHelpIcon">
                          <Icon name="question" />
                        </span>
                      </span>
                      <span className="settingTooltip">
                        <strong>{locale === 'zh' ? '搜索候选数量' : 'FTS candidate limit'}</strong>
                        {locale === 'zh' ? '先用全文搜索快速找出多少个候选情景，再精排。越大越全但越慢，一般不用改。' : 'Number of candidate episodes retrieved by full-text search before ranking. Larger is more comprehensive but slower. Usually no need to change.'}
                      </span>
                    </span>
                    <input
                      min={10}
                      max={200}
                      type="number"
                      disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                      value={config.episodeFtsCandidateLimit}
                      onChange={(event) => void saveMemorySettings({ episodeFtsCandidateLimit: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </div>
              {memoryNotice ? <p className="emptyHint">{memoryNotice}</p> : null}
              {memoryRecords.length === 0 ? (
                <p className="emptyHint">{locale === 'zh' ? '暂无长期记忆。' : 'No cold memories yet.'}</p>
              ) : (
                <div className="presetList">
                  {memoryRecords.map((record) => (
                    <article className="presetItem" key={record.id}>
                      <div>
                        <strong>{record.type}</strong>
                        <span>{record.text}</span>
                        <span>{locale === 'zh' ? '来源线程' : 'Source thread'}: {record.sourceThreadId ?? 'unknown'} · {locale === 'zh' ? '使用' : 'used'} {record.usageCount}</span>
                      </div>
                      <button className="textButton" type="button" onClick={() => void deleteMemory(record.id)}>
                        {locale === 'zh' ? '删除' : 'Delete'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
            ) : null}

            {activeSection === 'performance' ? (
            <section className="settingsSection" id="settings-performance">
              <h3>{locale === 'zh' ? '性能' : 'Performance'}</h3>
              <div className="formGrid modelSettingsList">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.systemMonitorEnabled === true}
                    onChange={(event) => {
                      setConfig({ ...config, systemMonitorEnabled: event.target.checked });
                    }}
                  />
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '启用系统监控限流' : 'Enable system monitor throttling'}
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '启用系统监控限流' : 'Enable system monitor throttling'}</strong>
                      {locale === 'zh' ? '系统监控 agent 运行时的 CPU / 内存 / 磁盘占用，超过阈值时自动限制并发和工具调用，防止系统过载。关闭后完全不监控。' : 'Monitors CPU / memory / disk usage during agent runs and throttles parallelism & tool calls when thresholds are exceeded. No monitoring when off.'}
                    </span>
                  </span>
                </label>
              </div>
              <div className="settingsInfoBlock">
                <p className="muted"><strong>{locale === 'zh' ? '三级限流策略' : 'Three-tier throttling'}</strong></p>
                <ul className="muted">
                  <li><strong>{locale === 'zh' ? '轻度 (CPU > 80% 或 内存 > 75%)' : 'Light (CPU > 80% or mem > 75%)'}</strong>：{locale === 'zh' ? '并发批次限制为 ≤ 2，禁止新建子 agent' : 'parallel batches ≤ 2, no new sub-agents'}</li>
                  <li><strong>{locale === 'zh' ? '中度 (CPU > 90% 或 内存 > 85%)' : 'Moderate (CPU > 90% or mem > 85%)'}</strong>：{locale === 'zh' ? '完全串行执行，禁止新建子 agent' : 'fully serial execution, no new sub-agents'}</li>
                  <li><strong>{locale === 'zh' ? '重度 (CPU > 95% 或 内存 > 95% 或 磁盘 < 500MB)' : 'Severe (CPU > 95% or mem > 95% or disk < 500MB)'}</strong>：{locale === 'zh' ? '仅允许只读工具，完全串行，禁止新建子 agent' : 'readonly tools only, fully serial, no new sub-agents'}</li>
                </ul>
                <p className="muted">{locale === 'zh' ? '⚠ 开启后下次 agent 调用时生效。阈值与采样间隔可在配置文件中自定义。' : '⚠ Takes effect on the next agent call. Thresholds and sample interval can be customized in config.'}</p>
              </div>
            </section>
            ) : null}

            {activeSection === 'presets' ? (
            <section className="settingsSection" id="settings-presets">
              <div className="presetHeader">
                <div>
                  <h3>{t(locale, 'modelPresets')}</h3>
                </div>
              </div>
              {modelPresets.length === 0 ? (
                <p className="emptyHint">{t(locale, 'noModelPresets')}</p>
              ) : (
                <div className="presetList">
                  {modelPresets.map((preset) => {
                    const presetProvider = providers.find((provider) => provider.id === preset.config.provider);
                    const applied = modelPresetMatchesRunConfig(preset, config);
                    return (
                      <article className={applied ? 'presetItem applied' : 'presetItem'} key={preset.id}>
                        <div>
                          <strong>{preset.name}</strong>
                          <span>
                            {presetProvider?.name ?? preset.config.provider ?? ''} · {preset.config.model ?? ''} · {formatTimestamp(preset.updatedAt, locale)}
                          </span>
                        </div>
                        {applied ? (
                          <span className="presetAppliedBadge">{locale === 'zh' ? '已应用' : 'Applied'}</span>
                        ) : (
                          <button className="textButton" onClick={() => applyModelPreset(preset)}>
                            {t(locale, 'applyPreset')}
                          </button>
                        )}
                        <button
                          className="iconButton danger"
                          title={t(locale, 'deletePreset')}
                          aria-label={t(locale, 'deletePreset')}
                          onClick={() => void deleteModelPreset(preset.id)}
                        >
                          <Icon name="trash" />
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            ) : null}

            {activeSection === 'plugins' ? (
            <section className="settingsSection pluginCatalogShell" id="settings-plugins">
              <div className="pluginCatalogApp">
              <div className="header">
                <div className="title-group">
                  <div className="title">
                    {locale === 'zh' ? '插件中心' : 'Plugins'}
                    <span className="title-dot" />
                  </div>
                  <div className="breadcrumb">
                    <span>Nexus</span> / {locale === 'zh' ? '插件' : 'Plugins'}
                  </div>
                </div>
                <div className="header-actions">
                  <input
                    className="search"
                    placeholder={locale === 'zh' ? '搜索插件...' : 'Search plugins...'}
                    value={pluginSearch}
                    onChange={(event) => setPluginSearch(event.target.value)}
                  />
                </div>
              </div>
              <div className="layout">
                <aside className="sidebar">
                  <div className="sidebar-label">{locale === 'zh' ? '分类' : 'Categories'}</div>
                  {pluginNavItems.map((item) => (
                    <button
                      className={`nav-item ${activePluginTab === item.id ? 'active' : ''}`}
                      key={item.id}
                      onClick={() => setActivePluginTab(item.id)}
                      type="button"
                    >
                      <Icon name={pluginNavIcon(item.id)} />
                      {item.label}
                      <span className="count">{item.count}</span>
                    </button>
                  ))}
                </aside>
                <div className="content">
                  <div className="section-header">
                    <div>
                      <h2 className="section-title">{activePluginNav.label}</h2>
                    </div>
                    <div className="section-header-actions">
                      <div className="section-count">
                        {locale === 'zh' ? '共 ' : ''}
                        <b>{activePluginNav.count}</b>
                        {locale === 'zh' ? ' 个' : ''}
                      </div>
                      {activePluginTab === 'skills' ? (
                        <button className="btn" onClick={() => void refreshSkills({ forceReload: true })} type="button">
                          {t(locale, 'refresh')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {pluginNotice ? <p className="pluginNotice">{pluginNotice}</p> : null}
                  <div className="pluginPane">
                {activePluginTab === 'recommended' ? (
                  <section className="pluginInnerSection" id="settings-plugin-recommended">
                    <div className="cards">
                      {filteredRecommendedCatalog.map((item) => {
                        const installed = item.type === 'skill'
                          ? skillsList.some((skill) => skill.name === item.name)
                          : mcps.some((mcp) => mcp.name === item.name);
                        const visual = recommendedCardVisual(item);
                        return (
                          <div className="card" key={item.id}>
                            <div className="card-head">
                              <div className="icon" style={{ background: visual.bg }}>
                                <Icon name={visual.icon} />
                              </div>
                              <div className="card-info">
                                <div className="card-title">{locale === 'zh' ? item.titleZh : item.titleEn}</div>
                                <div className="card-desc">{locale === 'zh' ? item.descriptionZh : item.descriptionEn}</div>
                              </div>
                            </div>
                            <div className="card-foot">
                              <div className="card-meta">
                                <span className="tag">{item.type === 'skill' ? 'Skill' : 'MCP'}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {installed ? (
                                  <button className="btn" disabled>{locale === 'zh' ? '已添加' : 'Added'}</button>
                                ) : item.type === 'skill' ? (
                                  <button className="btn btn-primary" type="button" onClick={() => void installRecommendedSkill(item)}>
                                    {locale === 'zh' ? '安装' : 'Install'}
                                  </button>
                                ) : (
                                  <button className="btn btn-primary" type="button" onClick={() => addRecommendedMcp(item)}>
                                    {locale === 'zh' ? '添加' : 'Add'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {activePluginTab === 'mcp' ? (
                  <McpSection
                    addLabel={t(locale, 'addMcp')}
                    hideHeader
                    id="settings-mcp"
                    items={filteredMcps}
                    locale={locale}
                    statuses={mcpStatuses}
                    onDelete={(id) => setMcps((current) => current.filter((item) => item.id !== id))}
                    onEdit={openEditMcpPanel}
                    onToggleEnabled={(id) => setMcps((current) => current.map((item) => (
                      item.id === id ? { ...item, enabled: !item.enabled } : item
                    )))}
                    onAdd={openAddMcpPanel}
                    onRefresh={() => void refreshMcpStatus('full')}
                    title={t(locale, 'mcp')}
                  />
                ) : null}
                {activePluginTab === 'skills' ? (
                  <section className="pluginInnerSection" id="settings-skills">
                    <div className="pluginControlCard">
                      <label className="pluginField">
                        {t(locale, 'skillsRoot')}
                        <input value={skillsRootDraft} onChange={(event) => setSkillsRootDraft(event.target.value)} />
                      </label>
                      <button className="btn btn-primary" onClick={saveSkillsRoot} disabled={skillsRootDraft === config.skillsRoot} type="button">
                        {t(locale, 'saveSkillsRoot')}
                      </button>
                    </div>
                    {filteredSkills.length === 0 ? (
                      <p className="emptyHint">{t(locale, 'noSkills')}</p>
                    ) : (
                      <div className="cards">
                        {filteredSkills.map((skill) => {
                          const visual = skillCardVisual(skill.name);
                          return (
                          <div className="card" key={skill.sourcePath || skill.name}>
                            <div className="card-head">
                              <div className="icon" style={{ background: visual.bg }}>
                                <Icon name={visual.icon} />
                              </div>
                              <div className="card-info">
                                <div className="card-title">{skill.name}</div>
                                <div className="card-desc">{localizedSkillDescription(skill, locale)}</div>
                              </div>
                            </div>
                            <div className="card-foot">
                              <div className="card-meta">
                                <span className="tag">Skill</span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                  className="btn btn-muted"
                                  title={t(locale, 'remove')}
                                  aria-label={t(locale, 'remove')}
                                  onClick={() => void deleteSkill(skill.name)}
                                >
                                  <Icon name="trash" />
                                </button>
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : null}
                {activePluginTab === 'web' ? (
                  <section className="pluginInnerSection webToolsPanel" id="settings-web-tools">
                    <div className="cards">
                      {webTools.map((tool) => {
                        const visual = webToolCardVisual(tool.id);
                        const isNativeFetch = tool.id === 'native_fetch';
                        const isSelected = tool.id === config.webProvider;
                        return (
                        <div className="card" key={tool.id}>
                          <div className="card-head">
                            <div className="icon" style={{ background: visual.bg }}>
                              <Icon name={visual.icon} />
                            </div>
                            <div className="card-info">
                              <div className="card-title">{tool.title}</div>
                              <div className="card-desc">{tool.description}</div>
                            </div>
                          </div>
                          <div className="card-foot">
                            <div className="card-meta">
                              <span className="tag">Web</span>
                              <span className={`tag toolStateTag ${isNativeFetch ? (isSelected ? 'active' : '') : (firecrawlConfigured ? 'ok' : 'warn')}`}>
                                {isNativeFetch
                                  ? (isSelected ? (locale === 'zh' ? '默认启用' : 'Default') : (locale === 'zh' ? '本地' : 'Local'))
                                  : (firecrawlConfigured
                                    ? `${locale === 'zh' ? '已配置' : 'Configured'} ${firecrawlMasked || ''}`.trim()
                                    : (locale === 'zh' ? '缺少密钥' : 'Missing key'))}
                              </span>
                            </div>
                            <div className="card-actions">
                              {isNativeFetch ? (
                                isSelected ? <span className="tag toolStateTag active">{locale === 'zh' ? '启用中' : 'Enabled'}</span> : null
                              ) : (
                                <>
                                  <button
                                    className="btn btn-muted"
                                    onClick={() => {
                                      setConfig((current) => ({ ...current, webProviderKeySource: 'config' }));
                                      setFirecrawlDialogOpen(true);
                                    }}
                                  >
                                    {firecrawlConfigured ? (locale === 'zh' ? '管理密钥' : 'Manage key') : (locale === 'zh' ? '填写密钥' : 'Enter key')}
                                  </button>
                                  <button
                                    type="button"
                                    className={`toggle ${firecrawlEnabled ? 'on' : ''}`}
                                    aria-pressed={firecrawlEnabled}
                                    aria-label={locale === 'zh' ? '切换 Firecrawl' : 'Toggle Firecrawl'}
                                    onClick={() => void handleFirecrawlToggle(!firecrawlEnabled)}
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                  </div>
                </div>
              </div>
              </div>
            </section>
            ) : null}

            {activeSection === 'remote' ? (
            <section className="settingsSection remoteBots" id="settings-remote">
              <div className="presetHeader">
                <div>
                  <h3>{locale === 'zh' ? '远程助手' : 'Remote bots'}</h3>
                  <span>{locale === 'zh' ? '微信优先，其他平台沿用同一网关' : 'WeChat first, other platforms use the same gateway'}</span>
                </div>
                <button className="textButton" onClick={() => void refreshBotStatus()}>{t(locale, 'refresh')}</button>
              </div>
              <div className="weixinBotPanel">
                <div className="weixinBotHeader">
                  <div>
                    <strong>{locale === 'zh' ? '个人微信桥接' : 'Personal WeChat bridge'}</strong>
                    <span>{locale === 'zh' ? '扫码、token 和消息监听由桌面端托管' : 'QR login, token, and monitoring are managed by desktop'}</span>
                  </div>
                  <span className={`botBadge ${botStatus?.weixin?.connected ? 'ok' : 'muted'}`}>
                    {botStatus?.weixin?.connected
                      ? (locale === 'zh' ? '已登录' : 'Signed in')
                      : (locale === 'zh' ? '未登录' : 'Not signed in')}
                  </span>
                </div>

                {!desktopCapabilities?.weixinBridge.managedAvailable ? (
                  <p className="botNotice warning">
                    {locale === 'zh'
                      ? '当前桌面微信桥接没有运行。开发模式会随 desktop dev 启动；如果仍不可用，请检查终端里的 weixin-bridge 日志。'
                      : 'The desktop WeChat bridge is not running. In dev it starts with desktop dev; check weixin-bridge logs if it remains unavailable.'}
                  </p>
                ) : null}

                <div className="weixinAccountRow">
                  <div className="weixinAccountMain">
                    <span>{locale === 'zh' ? '账号' : 'Account'}</span>
                    <strong title={botDraft.weixin.accountId || undefined}>
                      {botDraft.weixin.accountId || (locale === 'zh' ? '未登录' : 'Not signed in')}
                    </strong>
                  </div>
                  <div className="weixinAccountMeta">
                    <span>{desktopBridgeStatusLabel(desktopCapabilities, locale)}</span>
                    {botStatus?.weixin?.connected ? (
                      <button className="textButton danger" onClick={() => void handleWeixinLogout()}>
                        {locale === 'zh' ? '退出登录' : 'Log out'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {botStatus?.weixin?.bridgeStatus ? (
                  <div className="weixinBridgeDiagnostics">
                    {weixinBridgeDiagnostics(botStatus, locale).map((item) => (
                      <span className={item.tone === 'bad' ? 'bad' : undefined} key={item.label}>
                        {item.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                <label className="toggle botToggle historySyncToggle">
                  <input
                    type="checkbox"
                    checked={botDraft.weixin.syncHistoryOnConnect}
                    onChange={(event) => void updateWeixinConfig({ syncHistoryOnConnect: event.target.checked })}
                  />
                  <span>{locale === 'zh' ? '连接任意对话时同步微信历史消息' : 'Sync prior WeChat messages when connecting any conversation'}</span>
                </label>

                {weixinNotice || botStatus?.weixin?.error ? (
                  <p className="botNotice">{weixinNotice || botStatus?.weixin?.error}</p>
                ) : null}
              </div>

              <div className="remoteBotGrid compactBots">
                <article className="remoteBotCard">
                  <strong>{locale === 'zh' ? '飞书' : 'Feishu'}</strong>
                  <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
                  <small>{locale === 'zh' ? '待接入' : 'Pending'}</small>
                </article>
                <article className="remoteBotCard">
                  <strong>QQ</strong>
                  <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
                  <small>{locale === 'zh' ? '待接入' : 'Pending'}</small>
                </article>
              </div>

              <div className="botPanel dingtalkBotPanel">
                <div className="botPanelHeader">
                  <div className="botPanelTitle">
                    <h4>{locale === 'zh' ? '钉钉机器人' : 'DingTalk Bot'}</h4>
                    <span className={`botStatusBadge ${dingtalkStatus?.streamRunning ? 'ok' : dingtalkConfigured ? 'warn' : ''}`}>
                      {dingtalkStatus?.streamRunning
                        ? (locale === 'zh' ? 'Stream 已连接' : 'Stream connected')
                        : dingtalkConfigured
                          ? (locale === 'zh' ? 'Stream 未连接' : 'Stream offline')
                          : (locale === 'zh' ? '未配置' : 'Not configured')}
                    </span>
                  </div>
                  <label className="toggle botToggle">
                    <input
                      type="checkbox"
                      checked={botDraft.dingtalk.enabled}
                      onChange={(event) => void updateDingtalkConfig({ enabled: event.target.checked })}
                    />
                    <span>{locale === 'zh' ? '启用钉钉机器人' : 'Enable DingTalk bot'}</span>
                  </label>
                </div>

                <div className="formRow">
                  <label className="fieldLabel">
                    <span>{locale === 'zh' ? '连接模式' : 'Connection mode'}</span>
                    <select
                      value={botDraft.dingtalk.connectionMode}
                      onChange={(event) => patchDingtalk({ connectionMode: event.target.value as 'stream' | 'webhook' })}
                      onBlur={() => void updateDingtalkConfig({ connectionMode: botDraft.dingtalk.connectionMode })}
                      disabled={!botDraft.dingtalk.enabled}
                    >
                      <option value="stream">{locale === 'zh' ? 'Stream Push（推荐，无需公网）' : 'Stream Push (recommended, no public URL)'}</option>
                      <option value="webhook">{locale === 'zh' ? 'Webhook（需公网回调地址）' : 'Webhook (requires public callback URL)'}</option>
                    </select>
                  </label>
                </div>

                <div className="formGrid">
                  <label className="fieldLabel">
                    <span>Client ID</span>
                    <input
                      type="text"
                      value={botDraft.dingtalk.clientId}
                      placeholder={locale === 'zh' ? '钉钉开放平台 AppKey' : 'DingTalk AppKey'}
                      onChange={(event) => patchDingtalk({ clientId: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ clientId: botDraft.dingtalk.clientId })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>Client Secret</span>
                    <input
                      type="password"
                      value={botDraft.dingtalk.clientSecret}
                      placeholder={locale === 'zh' ? '钉钉开放平台 AppSecret' : 'DingTalk AppSecret'}
                      onChange={(event) => patchDingtalk({ clientSecret: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ clientSecret: botDraft.dingtalk.clientSecret })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                </div>

                <div className="formGrid">
                  <label className="fieldLabel">
                    <span>Robot Code</span>
                    <input
                      type="text"
                      value={botDraft.dingtalk.robotCode}
                      placeholder={locale === 'zh' ? '机器人编码（可选）' : 'Robot code (optional)'}
                      onChange={(event) => patchDingtalk({ robotCode: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ robotCode: botDraft.dingtalk.robotCode })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>{locale === 'zh' ? '默认对话 Thread' : 'Default thread'}</span>
                    <input
                      type="text"
                      value={botDraft.dingtalk.activeThreadId}
                      placeholder={locale === 'zh' ? '留空则使用默认收件线程' : 'Leave empty to use inbox thread'}
                      onChange={(event) => patchDingtalk({ activeThreadId: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ activeThreadId: botDraft.dingtalk.activeThreadId })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                </div>

                <div className="formGrid">
                  <label className="fieldLabel">
                    <span>{locale === 'zh' ? '目标群名称' : 'Target group name'}</span>
                    <input
                      type="text"
                      value={botDraft.dingtalk.targetGroupName}
                      placeholder={locale === 'zh' ? '例如：打完我去打DD·' : 'e.g. Team group'}
                      onChange={(event) => patchDingtalk({ targetGroupName: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ targetGroupName: botDraft.dingtalk.targetGroupName })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>{locale === 'zh' ? '目标群会话 ID / openConversationId' : 'Target group conversation ID / openConversationId'}</span>
                    <input
                      type="text"
                      value={botDraft.dingtalk.targetGroupConversationId}
                      placeholder="cidxxxx 或 openConversationId"
                      onChange={(event) => patchDingtalk({ targetGroupConversationId: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ targetGroupConversationId: botDraft.dingtalk.targetGroupConversationId })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                </div>

                {dingtalkStatus?.lastDetectedGroupConversationId ? (
                  <p className="botNotice">
                    {locale === 'zh'
                      ? `最近检测到群 ID：${dingtalkStatus.lastDetectedGroupConversationId}`
                      : `Last detected group ID: ${dingtalkStatus.lastDetectedGroupConversationId}`}
                  </p>
                ) : null}

                {botDraft.dingtalk.connectionMode === 'webhook' ? (
                  <label className="fieldLabel">
                    <span>Webhook Secret</span>
                    <input
                      type="password"
                      value={botDraft.dingtalk.webhookSecret}
                      placeholder={locale === 'zh' ? 'Webhook 回调签名密钥' : 'Webhook signing secret'}
                      onChange={(event) => patchDingtalk({ webhookSecret: event.target.value })}
                      onBlur={() => void updateDingtalkConfig({ webhookSecret: botDraft.dingtalk.webhookSecret })}
                      disabled={!botDraft.dingtalk.enabled}
                    />
                  </label>
                ) : null}

                <label className="fieldLabel">
                  <span>{locale === 'zh' ? '白名单用户 ID（逗号分隔，空则不限制）' : 'Allowed user IDs (comma-separated, empty = all users)'}</span>
                  <input
                    type="text"
                    value={botDraft.dingtalk.allowedUsers.join(',')}
                    placeholder={locale === 'zh' ? '例如：manager123,dev456' : 'e.g. manager123,dev456'}
                    onChange={(event) => patchDingtalk({ allowedUsers: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    onBlur={() => void updateDingtalkConfig({ allowedUsers: botDraft.dingtalk.allowedUsers })}
                    disabled={!botDraft.dingtalk.enabled}
                  />
                </label>

                <label className="toggle botToggle">
                  <input
                    type="checkbox"
                    checked={botDraft.dingtalk.autoStart}
                    onChange={(event) => void updateDingtalkConfig({ autoStart: event.target.checked })}
                    disabled={!botDraft.dingtalk.enabled}
                  />
                  <span>{locale === 'zh' ? '服务启动时自动连接 Stream' : 'Auto-connect Stream on service startup'}</span>
                </label>

                {dingtalkStatus?.error ? (
                  <p className="botNotice" style={{ color: 'var(--red, #e5484d)' }}>{dingtalkStatus.error}</p>
                ) : null}

                <div className="botActionRow">
                  {dingtalkStatus?.streamRunning ? (
                    <button
                      type="button"
                      className="outlineButton"
                      onClick={() => void handleStopDingtalkStream()}
                      disabled={!dingtalkConfigured || !botDraft.dingtalk.enabled}
                    >
                      {locale === 'zh' ? '停止 Stream' : 'Stop Stream'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="outlineButton"
                      onClick={() => void handleStartDingtalkStream()}
                      disabled={!dingtalkConfigured || !botDraft.dingtalk.enabled}
                    >
                      {locale === 'zh' ? '启动 Stream' : 'Start Stream'}
                    </button>
                  )}
                  <select
                    value={dingtalkTestConvType}
                    onChange={(event) => setDingtalkTestConvType(event.target.value as 'dm' | 'group')}
                    className="dingtalkTestSelect"
                  >
                    <option value="dm">{locale === 'zh' ? '单聊' : 'DM'}</option>
                    <option value="group">{locale === 'zh' ? '群聊' : 'Group'}</option>
                  </select>
                  <input
                    type="text"
                    value={dingtalkTestConvId}
                    placeholder={locale === 'zh' ? '会话 ID (conversationId)' : 'Conversation ID'}
                    onChange={(event) => setDingtalkTestConvId(event.target.value)}
                    className="dingtalkTestInput"
                  />
                  <button
                    type="button"
                    className="outlineButton"
                    onClick={() => void handleTestDingtalk()}
                    disabled={!dingtalkConfigured || !dingtalkTestConvId.trim()}
                  >
                    {locale === 'zh' ? '发送测试' : 'Test send'}
                  </button>
                </div>

                {dingtalkNotice ? (
                  <p className="botNotice">{dingtalkNotice}</p>
                ) : null}
              </div>

              {/* 钉钉 CLI (dws) 面板 */}
              {botConfig?.dingtalk?.enabled ? (
              <div className="botPanel dingtalkBotPanel">
                <div className="botPanelHeader">
                  <div className="botPanelTitle">
                    <h4>{locale === 'zh' ? '钉钉 CLI (dws)' : 'DingTalk CLI (dws)'}</h4>
                    <span>{locale === 'zh' ? '与机器人搭配使用，Agent 通过 CLI 操作钉钉企业数据' : 'Works alongside the bot; Agent operates DingTalk enterprise data via CLI'}</span>
                  </div>
                  <label className="toggle botToggle">
                    <input
                      type="checkbox"
                      checked={botDraft.dwsCli.enabled}
                      onChange={(event) => void updateDwsCliConfig({ enabled: event.target.checked })}
                    />
                    <span>{locale === 'zh' ? '启用 dws CLI' : 'Enable dws CLI'}</span>
                  </label>
                </div>

                <div className="formGrid">
                  <label className="fieldLabel">
                    <span>{locale === 'zh' ? 'dws 可执行文件路径' : 'dws binary path'}</span>
                    <input
                      type="text"
                      value={botDraft.dwsCli.binaryPath}
                      placeholder={locale === 'zh' ? '例如：/usr/local/bin/dws' : 'e.g. /usr/local/bin/dws'}
                      onChange={(event) => patchDwsCli({ binaryPath: event.target.value })}
                      onBlur={() => void updateDwsCliConfig({ binaryPath: botDraft.dwsCli.binaryPath })}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>Client ID (AppKey)</span>
                    <input
                      type="text"
                      value={botDraft.dwsCli.clientId}
                      placeholder={locale === 'zh' ? '钉钉开放平台 AppKey' : 'DingTalk AppKey'}
                      onChange={(event) => patchDwsCli({ clientId: event.target.value })}
                      onBlur={() => void updateDwsCliConfig({ clientId: botDraft.dwsCli.clientId })}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>Client Secret (AppSecret)</span>
                    <input
                      type="password"
                      value={botDraft.dwsCli.clientSecret}
                      placeholder={locale === 'zh' ? '钉钉开放平台 AppSecret' : 'DingTalk AppSecret'}
                      onChange={(event) => patchDwsCli({ clientSecret: event.target.value })}
                      onBlur={() => void updateDwsCliConfig({ clientSecret: botDraft.dwsCli.clientSecret })}
                    />
                  </label>
                </div>
              </div>
              ) : null}
            </section>
            ) : null}
          </div>
        </div>
      </aside>

      {mcpPanelOpen ? (
        <div className="dialogLayer" role="presentation" onMouseDown={closeMcpPanel}>
          <section
            className="appDialog pluginModalDialog mcpConfigDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-panel-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="dialogHeader">
              <div>
                <h2 id="mcp-panel-title">{mcpPanelTitle}</h2>
                <p className="dialogMessage">{locale === 'zh' ? '命令、参数和启用状态都会立即影响当前插件中心中的 MCP 配置。' : 'Command, args, and enabled state immediately affect the MCP configuration in Plugin Hub.'}</p>
              </div>
              <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={closeMcpPanel}>
                <Icon name="x" />
              </button>
            </header>
            <div className="mcpPanelForm">
              <label className="pluginModalField">
                {t(locale, 'name')}
                <input value={mcpDraft.name} onChange={(event) => setMcpDraft({ ...mcpDraft, name: event.target.value })} />
              </label>
              <label className="pluginModalField">
                {t(locale, 'command')}
                <input value={mcpDraft.command} onChange={(event) => setMcpDraft({ ...mcpDraft, command: event.target.value })} />
              </label>
              <label className="pluginModalField">
                {t(locale, 'args')}
                <input value={mcpDraft.args} onChange={(event) => setMcpDraft({ ...mcpDraft, args: event.target.value })} />
              </label>
              <div className="pluginModalToggle">
                <div>
                  <strong>{t(locale, 'enabled')}</strong>
                  <span>{locale === 'zh' ? '关闭后将保留配置，但不会在运行中启用。' : 'Disabled MCPs keep their config but do not run.'}</span>
                </div>
                <button
                  type="button"
                  className={`pluginToggle ${mcpDraft.enabled ? 'on' : ''}`}
                  aria-pressed={mcpDraft.enabled}
                  aria-label={t(locale, 'enabled')}
                  onClick={() => setMcpDraft({ ...mcpDraft, enabled: !mcpDraft.enabled })}
                />
              </div>
            </div>
            <div className="dialogActions">
              <button className="textButton" onClick={closeMcpPanel}>{t(locale, 'cancel')}</button>
              <button className="solidButton" onClick={saveMcp}>{t(locale, 'save')}</button>
            </div>
          </section>
        </div>
      ) : null}
      {firecrawlDialogOpen ? (
        <div className="dialogLayer" role="presentation" onMouseDown={closeFirecrawlDialog}>
          <section
            className="appDialog pluginModalDialog firecrawlKeyDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="firecrawl-key-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="dialogHeader">
              <div>
                <h2 id="firecrawl-key-title">Firecrawl API Key</h2>
                <p className="dialogMessage">
                  {firecrawlConfigured
                    ? (locale === 'zh' ? `当前已检测到密钥 ${firecrawlMasked}` : `Detected key ${firecrawlMasked}`)
                    : (locale === 'zh' ? '未检测到可用密钥，填写后才可开启 Firecrawl。' : 'No usable key detected. Fill in a key before enabling Firecrawl.')}
                </p>
              </div>
              <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={closeFirecrawlDialog}>
                <Icon name="x" />
              </button>
            </header>
            <div className="mcpPanelForm">
              <label className="pluginModalField">
                {locale === 'zh' ? 'API Key' : 'API Key'}
                <input
                  placeholder="fc-..."
                  value={webKeyDraft}
                  onChange={(event) => setWebKeyDraft(event.target.value)}
                  type="password"
                />
              </label>
              <div className="pluginModalSummary">
                <strong>{locale === 'zh' ? '密钥来源' : 'Key source'}</strong>
                <span>
                  {webProviderState?.firecrawl.source === 'env'
                    ? 'FIRECRAWL_API_KEY'
                    : (locale === 'zh' ? '项目配置' : 'Project config')}
                </span>
              </div>
            </div>
            <div className="dialogActions">
              {webProviderState?.firecrawl.source === 'config' && firecrawlHasPreview ? (
                <button className="textButton" onClick={() => void handleClearFirecrawlKey()}>
                  {t(locale, 'clearKey')}
                </button>
              ) : null}
              <button className="textButton" onClick={closeFirecrawlDialog}>{t(locale, 'cancel')}</button>
              <button className="solidButton" onClick={() => void handleSaveFirecrawlKeyAndEnable()}>
                {locale === 'zh' ? '保存并开启' : 'Save and enable'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

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

function desktopBridgeStatusLabel(capabilities: DesktopCapabilities | null, locale: Locale): string {
  if (capabilities?.weixinBridge.managedAvailable) return locale === 'zh' ? '可用' : 'Available';
  if (capabilities?.weixinBridge.reason === 'not_bundled') return locale === 'zh' ? '组件未打包' : 'Component not bundled';
  if (capabilities?.weixinBridge.reason === 'unsupported') return locale === 'zh' ? '仅桌面端可用' : 'Desktop only';
  return locale === 'zh' ? '未运行' : 'Not running';
}

function weixinBridgeDiagnostics(status: BotStatus, locale: Locale): Array<{ label: string; tone?: 'bad' }> {
  const bridgeStatus = status.weixin?.bridgeStatus;
  const monitors = bridgeStatus?.monitors ?? [];
  const activeMonitor = monitors.find((monitor) => monitor.running) ?? monitors[0];
  if (!activeMonitor) {
    return [{
      label: locale === 'zh' ? '监听：未启动' : 'Monitor: not started',
      tone: bridgeStatus?.error ? 'bad' : undefined,
    }];
  }
  const runningLabel = activeMonitor.running
    ? (locale === 'zh' ? '监听中' : 'Monitoring')
    : (locale === 'zh' ? '未监听' : 'Stopped');
  const result = [
    { label: runningLabel, tone: activeMonitor.running ? undefined : 'bad' as const },
    { label: `${locale === 'zh' ? '轮询' : 'Polls'} ${activeMonitor.pollCount ?? 0}` },
    { label: `${locale === 'zh' ? '消息' : 'Messages'} ${activeMonitor.messageCount ?? 0}` },
    { label: `${locale === 'zh' ? '投递' : 'Webhooks'} ${activeMonitor.webhookCount ?? 0}` },
  ];
  if (activeMonitor.lastError) {
    result.push({
      label: `${locale === 'zh' ? '最后错误' : 'Last error'}: ${activeMonitor.lastError}`,
      tone: 'bad' as const,
    });
  }
  return result;
}

function modelPresetMatchesRunConfig(preset: ModelPreset, config: RunConfig): boolean {
  const entries = Object.entries(preset.config) as Array<[keyof RunConfig, RunConfig[keyof RunConfig] | undefined]>;
  return entries.length > 0 && entries.every(([key, value]) => value === undefined || config[key] === value);
}

function providerDropdownOptions(providers: ProviderEntry[], locale: Locale): Array<DropdownOption<string>> {
  const local = providers.filter((provider) => provider.isLocal && provider.id !== 'openai_compatible');
  const generic = providers.filter((provider) => provider.id === 'openai_compatible');
  const chinaIds = new Set(['deepseek', 'zhipu', 'kimi', 'qwen', 'baidu', 'volcengine', 'siliconflow']);
  const china = providers.filter((provider) => chinaIds.has(provider.id));
  const global = providers.filter((provider) => !provider.isLocal && !chinaIds.has(provider.id));
  const map = (group: string, provider: ProviderEntry): DropdownOption<string> => ({
    group,
    value: provider.id,
    label: provider.name,
  });
  return [
    ...local.map((provider) => map(t(locale, 'localProvider'), provider)),
    ...china.map((provider) => map(t(locale, 'remoteChina'), provider)),
    ...global.map((provider) => map(t(locale, 'remoteGlobal'), provider)),
    ...generic.map((provider) => map(t(locale, 'genericProvider'), provider)),
  ];
}

function McpSection({
  addLabel,
  hideHeader = false,
  id,
  items,
  locale,
  onAdd,
  onDelete,
  onEdit,
  onRefresh,
  onToggleEnabled,
  statuses,
  title,
}: {
  addLabel: string;
  hideHeader?: boolean;
  id?: string;
  items: McpConfig[];
  locale: Locale;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: McpConfig) => void;
  onRefresh: () => void;
  onToggleEnabled: (id: string) => void;
  statuses: McpServerStatus[];
  title: string;
}) {
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  return (
    <section className="settingsSection" id={id}>
      {!hideHeader ? (
        <div className="section-header">
          <div>
            <h2 className="section-title">{title}</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={onRefresh}>{t(locale, 'refresh')}</button>
            <button className="btn btn-primary" onClick={onAdd}>{addLabel}</button>
          </div>
        </div>
      ) : null}
      <div className="cards">
        {items.map((item) => {
          const status = statusById.get(item.id);
          const statusText = mcpStatusText(status, item.enabled, locale);
          const commandLine = item.args.trim() ? `${item.command} ${item.args}` : item.command;
          const visual = mcpCardVisual(item.name);
          
          let statusClass = 'offline';
          if (statusText.tone === 'ok') statusClass = 'online';
          if (statusText.tone === 'warn') statusClass = 'warning';
          if (statusText.tone === 'danger') statusClass = 'error';
          
          const isOnline = statusClass === 'online';

          return (
            <div className="card" key={item.id} onClick={() => onEdit(item)}>
              <div className="card-head">
                <div className="icon" style={{ background: visual.bg }}>
                  <Icon name={visual.icon} />
                </div>
                <div className="card-info">
                  <div className="card-title">
                    {item.name} 
                    <span className={`status-dot ${statusClass}`} title={statusText.label + (status?.error ? `: ${status.error}` : '')}></span>
                  </div>
                  <div className="card-desc" title={commandLine}>{commandLine}</div>
                </div>
              </div>
              <div className="card-foot" onClick={(e) => e.stopPropagation()}>
                <div className="card-meta">
                  <span className="tag">Local</span>
                  {isOnline ? `${status?.toolCount ?? 0} ${locale === 'zh' ? '个工具' : 'tools'}` : statusText.label}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn btn-danger"
                    title={t(locale, 'remove')}
                    aria-label={t(locale, 'remove')}
                    onClick={() => onDelete(item.id)}
                    type="button"
                  >
                    <Icon name="trash" />
                  </button>
                  <div 
                    className={`toggle ${item.enabled ? 'on' : ''}`}
                    onClick={() => onToggleEnabled(item.id)}
                    title={item.enabled ? t(locale, 'enabled') : 'Off'}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function pluginNavIcon(tab: 'recommended' | 'mcp' | 'skills' | 'web'): IconName {
  switch (tab) {
    case 'recommended':
      return 'spark';
    case 'mcp':
      return 'panel';
    case 'skills':
      return 'workflow';
    case 'web':
      return 'search';
  }
}

function recommendedCardVisual(item: RecommendedSkill | RecommendedMcp): { icon: IconName; bg: string } {
  const id = item.id.toLowerCase();
  if (id.includes('playwright')) return { icon: item.type === 'mcp' ? 'puppet' : 'browser', bg: '#a7f3d0' };
  if (id.includes('browser')) return { icon: 'browser', bg: '#bae6fd' };
  if (id.includes('filesystem')) return { icon: 'folder', bg: '#fef3c7' };
  if (id.includes('figma')) return { icon: 'layers', bg: '#e9d5ff' };
  if (id.includes('code-review')) return { icon: 'review', bg: '#bae6fd' };
  if (id.includes('bug-hunt')) return { icon: 'activity', bg: '#fed7aa' };
  if (id.includes('frontend-design')) return { icon: 'browser', bg: '#a7f3d0' };
  if (id.includes('frontend-polish')) return { icon: 'spark', bg: '#e9d5ff' };
  if (id.includes('release-notes')) return { icon: 'doc', bg: '#fecdd3' };
  return item.type === 'mcp'
    ? { icon: 'panel', bg: '#bae6fd' }
    : { icon: 'workflow', bg: '#fef3c7' };
}

function skillCardVisual(name: string): { icon: IconName; bg: string } {
  const key = name.toLowerCase();
  if (key.includes('review')) return { icon: 'review', bg: '#bae6fd' };
  if (key.includes('sql')) return { icon: 'sql', bg: '#fef3c7' };
  if (key.includes('doc') || key.includes('release')) return { icon: 'doc', bg: '#fecdd3' };
  if (key.includes('mermaid')) return { icon: 'mermaid', bg: '#a7f3d0' };
  if (key.includes('translate')) return { icon: 'translate', bg: '#e9d5ff' };
  if (key.includes('playwright') || key.includes('browser')) return { icon: 'browser', bg: '#a7f3d0' };
  if (key.includes('bug') || key.includes('hunt')) return { icon: 'activity', bg: '#fed7aa' };
  if (key.includes('frontend')) return { icon: 'spark', bg: '#e9d5ff' };
  return { icon: 'workflow', bg: '#fef3c7' };
}

function webToolCardVisual(id: string): { icon: IconName; bg: string } {
  if (id === 'firecrawl') return { icon: 'search', bg: '#bae6fd' };
  return { icon: 'browser', bg: '#a7f3d0' };
}

function mcpCardVisual(name: string): { icon: IconName; bg: string } {
  const key = name.toLowerCase();
  if (key.includes('github')) return { icon: 'github', bg: '#bae6fd' };
  if (key.includes('file')) return { icon: 'folder', bg: '#fef3c7' };
  if (key.includes('slack')) return { icon: 'message', bg: '#fecdd3' };
  if (key.includes('postgres') || key.includes('pg')) return { icon: 'database', bg: '#a7f3d0' };
  if (key.includes('puppet') || key.includes('playwright')) return { icon: 'puppet', bg: '#fed7aa' };
  if (key.includes('memory')) return { icon: 'memoryChip', bg: '#e9d5ff' };
  if (key.includes('figma')) return { icon: 'layers', bg: '#e9d5ff' };
  if (key.includes('browser')) return { icon: 'browser', bg: '#bae6fd' };
  return { icon: 'panel', bg: '#bae6fd' };
}

function mcpStatusText(
  status: McpServerStatus | undefined,
  enabled: boolean,
  locale: Locale,
): { label: string; dot: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (!enabled || !status || status.status === 'disabled') {
    return { label: locale === 'zh' ? '已禁用' : 'Disabled', dot: '○', tone: 'muted' };
  }
  if (status.status === 'configured') {
    return { label: locale === 'zh' ? '已启用 · 待启动' : 'Enabled · Standby', dot: '●', tone: 'warn' };
  }
  if (status.status === 'running') {
    const tools = locale === 'zh' ? `${status.toolCount} 个工具` : `${status.toolCount} tools`;
    return { label: `${locale === 'zh' ? '运行中' : 'Running'} · ${tools}`, dot: '●', tone: 'ok' };
  }
  if (status.status === 'starting') {
    return { label: locale === 'zh' ? '启动中' : 'Starting', dot: '●', tone: 'warn' };
  }
  const label = status.status === 'dead'
    ? (locale === 'zh' ? '已崩溃' : 'Dead')
    : (locale === 'zh' ? '启动失败' : 'Failed');
  return { label, dot: '●', tone: 'danger' };
}
