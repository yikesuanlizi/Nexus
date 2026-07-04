import React, { useEffect, useState } from 'react';
import { RUN_CONFIG_STORAGE_KEY, type Locale, type RunConfig, type SecretSource, type ThemeMode } from '../config/config.js';
import { Icon, type IconName } from './Icon.js';
import { DropdownSelect, type DropdownOption } from './DropdownSelect.js';
import { emptyMcp } from '../config/defaults.js';
import { formatTimestamp, t } from '../shared/i18n.js';
import { localizedSkillDescription } from '../features/settings/skillDescriptions.js';
import { recommendedPluginCatalog, type RecommendedMcp, type RecommendedSkill } from '../features/settings/pluginCatalog.js';
import { upsertById } from '../features/chat/threadItems.js';
import { CUSTOM_USER_AVATAR_ID, DEFAULT_USER_AVATAR_ID, USER_AVATAR_OPTIONS, UserAvatar, userAvatarLabel } from './UserAvatar.js';
import type { ApiKeyState, BotConfig, BotStatus, McpConfig, McpServerStatus, MemoryRecord, ModelPreset, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../shared/types.js';

interface AuthTokenPublic {
  id: string;
  name: string;
  role: 'admin' | 'tenant' | 'bot';
  tenantId: string;
  scopes: string[];
  tokenPrefix: string;
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
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
  saveWebProviderKey,
  clearWebProviderKey,
  consumePendingMcpDraft,
  webProviderState,
  showAdminControls = false,
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
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  saveWebProviderKey: (apiKey: string) => Promise<void>;
  clearWebProviderKey: () => Promise<void>;
  selectProvider: (providerId: string) => void;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  setOpen: (open: boolean) => void;
  consumePendingMcpDraft?: () => void;
  webProviderState: WebProviderPublicConfig | null;
  showAdminControls?: boolean;
  startDingtalkStream?: () => Promise<{ ok?: boolean; error?: string }>;
  stopDingtalkStream?: () => Promise<void>;
  testDingtalkMessage?: (conversationId: string, conversationType: 'dm' | 'group', text?: string) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [skillsRootDraft, setSkillsRootDraft] = useState(config.skillsRoot);
  const [botDraft, setBotDraft] = useState<BotConfig>(botConfig ?? defaultBotConfig);
  const [weixinNotice, setWeixinNotice] = useState('');
  const [dingtalkNotice, setDingtalkNotice] = useState('');
  const [dingtalkTestConvId, setDingtalkTestConvId] = useState('');
  const [dingtalkTestConvType, setDingtalkTestConvType] = useState<'dm' | 'group'>('dm');
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
  const [modelKeySource, setModelKeySource] = useState<SecretSource>('env');
  const [showSavedModelKey, setShowSavedModelKey] = useState(false);
  const [authTokens, setAuthTokens] = useState<AuthTokenPublic[]>([]);
  const [authTokenNotice, setAuthTokenNotice] = useState('');
  const [adminBootstrapToken, setAdminBootstrapToken] = useState('');
  const [newAuthToken, setNewAuthToken] = useState({
    name: '',
    role: 'tenant' as 'admin' | 'tenant' | 'bot',
    tenantId: 'tenantA',
    scopes: '*',
  });
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
    { id: 'presets', label: t(locale, 'modelPresets') },
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

  function patchWeixin(patch: Partial<BotConfig['weixin']>) {
    setBotDraft((current) => ({
      ...current,
      weixin: { ...current.weixin, ...patch },
    }));
  }

  async function saveWeixinConfig() {
    await saveBotConfig(botDraft);
    setWeixinNotice(locale === 'zh' ? '远程助手配置已保存。' : 'Remote assistant config saved.');
  }

  function patchDingtalk(patch: Partial<BotConfig['dingtalk']>) {
    setBotDraft((current) => ({
      ...current,
      dingtalk: { ...current.dingtalk, ...patch },
    }));
  }

  async function saveDingtalkConfig() {
    await saveBotConfig(botDraft);
    setDingtalkNotice(locale === 'zh' ? '钉钉机器人配置已保存。' : 'DingTalk bot config saved.');
  }

  function patchDwsCli(patch: Partial<BotConfig['dwsCli']>) {
    setBotDraft((current) => ({
      ...current,
      dwsCli: { ...current.dwsCli, ...patch },
    }));
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
        scopes: newAuthToken.scopes.split(',').map((scope) => scope.trim()).filter(Boolean),
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
          episodeRerankEnabled: next.episodeRerankEnabled,
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
                  <span>{locale === 'zh' ? '热记忆来自当前运行，温记忆来自线程压缩，冷记忆来自持久记录' : 'Hot memory is runtime state, warm memory is thread summary, cold memory is persistent records'}</span>
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
                  <span>{locale === 'zh' ? '启用记忆系统' : 'Enable memory'}</span>
                </label>
                <label className="toggle">
                  <input
                    checked={config.autoExtractMemories}
                    disabled={!config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ autoExtractMemories: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{locale === 'zh' ? '自动提取冷记忆' : 'Auto extract cold memories'}</span>
                </label>
                <label className="toggle">
                  <input
                    checked={config.useColdMemories}
                    disabled={!config.memoryEnabled}
                    onChange={(event) => void saveMemorySettings({ useColdMemories: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{locale === 'zh' ? '运行时使用冷记忆' : 'Use cold memories at runtime'}</span>
                </label>
                <label>
                  {locale === 'zh' ? '注入数量' : 'Inject limit'}
                  <input
                    min={1}
                    max={20}
                    type="number"
                    value={config.memoryInjectLimit}
                    onChange={(event) => void saveMemorySettings({ memoryInjectLimit: Number(event.target.value) })}
                  />
                </label>
                <label>
                  {locale === 'zh' ? 'Token 预算' : 'Token budget'}
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
                  <h4>{locale === 'zh' ? '情景记忆' : 'Episode memory'}</h4>
                  <span>{locale === 'zh' ? '基于任务片段的温记忆注入' : 'Warm memory injection based on task episodes'}</span>
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
                  <span>{locale === 'zh' ? '启用情景记忆' : 'Enable episode memory'}</span>
                </label>
                <label className="toggle">
                  <input
                    checked={config.episodeRerankEnabled}
                    disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                    onChange={(event) => void saveMemorySettings({ episodeRerankEnabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{locale === 'zh' ? '启用重排序' : 'Enable reranking'}</span>
                </label>
                <label>
                  {locale === 'zh' ? '注入数量' : 'Inject limit'}
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
                  {locale === 'zh' ? 'Token 预算' : 'Token budget'}
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
                  {locale === 'zh' ? '切换冷却回合' : 'Switch cooldown turns'}
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
                  {locale === 'zh' ? '封存空闲分钟' : 'Seal idle minutes'}
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
                  {locale === 'zh' ? '冷却后天数' : 'Cold after days'}
                  <input
                    min={1}
                    max={365}
                    type="number"
                    disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                    value={config.episodeColdAfterDays}
                    onChange={(event) => void saveMemorySettings({ episodeColdAfterDays: Number(event.target.value) })}
                  />
                </label>
                <label>
                  {locale === 'zh' ? '全文候选数量' : 'FTS candidate limit'}
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
              {memoryNotice ? <p className="emptyHint">{memoryNotice}</p> : null}
              {memoryRecords.length === 0 ? (
                <p className="emptyHint">{locale === 'zh' ? '暂无冷记忆。' : 'No cold memories yet.'}</p>
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

            {false && activeSection === 'skills' ? (
            <section className="settingsSection" id="settings-skills">
              <div className="presetHeader">
                <div>
                  <h3>{t(locale, 'skills')}</h3>
                  <span>{t(locale, 'installedSkills')} · {skillsList.length}</span>
                </div>
                <button className="textButton" onClick={() => void refreshSkills({ forceReload: true })}>{t(locale, 'refresh')}</button>
              </div>
              <div className="inlineSaveRow">
                <label>
                  {t(locale, 'skillsRoot')}
                  <input value={skillsRootDraft} onChange={(event) => setSkillsRootDraft(event.target.value)} />
                </label>
                <button className="solidButton" onClick={saveSkillsRoot} disabled={skillsRootDraft === config.skillsRoot}>
                  {t(locale, 'saveSkillsRoot')}
                </button>
              </div>
              {skillsList.length === 0 ? (
                <p className="emptyHint">{t(locale, 'noSkills')}</p>
              ) : (
                <div className="skillsList">
                  {skillsList.map((skill) => (
                    <article className="skillItem" key={skill.sourcePath || skill.name}>
                      <div>
                        <strong>{skill.name}</strong>
                        <span>{localizedSkillDescription(skill, locale)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            ) : null}

            {false && activeSection === 'mcp' ? (
            <McpSection
              addLabel={t(locale, 'addMcp')}
              id="settings-mcp"
              items={mcps}
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
                    <span>{botStatus?.weixin?.bridge === 'online'
                      ? (locale === 'zh' ? '桥接在线' : 'Bridge online')
                      : (locale === 'zh' ? '桥接未连接' : 'Bridge offline')}</span>
                  </div>
                  <span className={`botBadge ${botStatus?.weixin?.connected ? 'ok' : 'muted'}`}>
                    {botStatus?.weixin?.connected
                      ? (locale === 'zh' ? '已登录' : 'Signed in')
                      : (locale === 'zh' ? '未登录' : 'Not signed in')}
                  </span>
                </div>

                <label className="toggle botToggle">
                  <input
                    type="checkbox"
                    checked={botDraft.weixin.enabled}
                    onChange={(event) => patchWeixin({ enabled: event.target.checked })}
                  />
                  <span>{locale === 'zh' ? '启用微信远程助手' : 'Enable WeChat remote assistant'}</span>
                </label>

                <div className="botFormGrid">
                  <label>
                    {locale === 'zh' ? 'Bridge RPC 地址' : 'Bridge RPC URL'}
                    <input value={botDraft.weixin.bridgeUrl} onChange={(event) => patchWeixin({ bridgeUrl: event.target.value })} />
                  </label>
                  <div className="botReadonlyField">
                    <span>{locale === 'zh' ? '账号' : 'Account'}</span>
                    <strong>{botDraft.weixin.accountId || (locale === 'zh' ? '未登录' : 'Not signed in')}</strong>
                  </div>
                </div>

                <div className="botActionRow">
                  <button className="solidButton" onClick={() => void saveWeixinConfig()}>
                    {locale === 'zh' ? '保存配置' : 'Save config'}
                  </button>
                </div>

                {weixinNotice || botStatus?.weixin?.error ? (
                  <p className="botNotice">{weixinNotice || botStatus?.weixin?.error}</p>
                ) : null}
              </div>

              {/* 钉钉机器人面板 */}
              <div className="dingtalkBotPanel">
                <div className="weixinBotHeader">
                  <div>
                    <strong>{locale === 'zh' ? '钉钉机器人' : 'DingTalk Bot'}</strong>
                    <span>
                      {botStatus?.dingtalk?.streamRunning
                        ? (locale === 'zh' ? 'Stream 已连接' : 'Stream connected')
                        : botStatus?.dingtalk?.configured
                          ? (locale === 'zh' ? '已配置未连接' : 'Configured, not connected')
                          : (locale === 'zh' ? '未配置' : 'Not configured')}
                    </span>
                  </div>
                  <span className={`botBadge ${botStatus?.dingtalk?.streamRunning ? 'ok' : botStatus?.dingtalk?.configured ? 'warn' : 'muted'}`}>
                    {botStatus?.dingtalk?.streamRunning
                      ? (locale === 'zh' ? '在线' : 'Online')
                      : botStatus?.dingtalk?.configured
                        ? (locale === 'zh' ? '待连接' : 'Awaiting')
                        : (locale === 'zh' ? '离线' : 'Offline')}
                  </span>
                </div>

                <label className="toggle botToggle">
                  <input
                    type="checkbox"
                    checked={botDraft.dingtalk.enabled}
                    onChange={(event) => patchDingtalk({ enabled: event.target.checked })}
                  />
                  <span>{locale === 'zh' ? '启用钉钉机器人' : 'Enable DingTalk bot'}</span>
                </label>

                <div className="botFormGrid">
                  <label>
                    {locale === 'zh' ? '连接模式' : 'Connection mode'}
                    <select
                      value={botDraft.dingtalk.connectionMode}
                      onChange={(event) => patchDingtalk({ connectionMode: event.target.value as 'stream' | 'webhook' })}
                    >
                      <option value="stream">{locale === 'zh' ? 'Stream Push（无需公网）' : 'Stream Push (no public IP)'}</option>
                      <option value="webhook">{locale === 'zh' ? 'Webhook（需公网回调）' : 'Webhook (public callback)'}</option>
                    </select>
                  </label>
                  <label>
                    {locale === 'zh' ? 'Robot Code（可选）' : 'Robot Code (optional)'}
                    <input value={botDraft.dingtalk.robotCode} onChange={(event) => patchDingtalk({ robotCode: event.target.value })} placeholder="robotCode 或留空使用 Client ID" />
                  </label>
                  <label>
                    Client ID (AppKey)
                    <input value={botDraft.dingtalk.clientId} onChange={(event) => patchDingtalk({ clientId: event.target.value })} placeholder="dingxxxxxxxxxx" />
                  </label>
                  <label>
                    Client Secret (AppSecret)
                    <input type="password" value={botDraft.dingtalk.clientSecret} onChange={(event) => patchDingtalk({ clientSecret: event.target.value })} placeholder="••••••••" />
                  </label>
                  <label>
                    {locale === 'zh' ? 'AI 卡片模板 ID（可选）' : 'AI Card template ID (optional)'}
                    <input value={botDraft.dingtalk.cardTemplateId} onChange={(event) => patchDingtalk({ cardTemplateId: event.target.value })} />
                  </label>
                  <label>
                    {locale === 'zh' ? '目标群名称' : 'Target group name'}
                    <input
                      value={botDraft.dingtalk.targetGroupName}
                      onChange={(event) => patchDingtalk({ targetGroupName: event.target.value })}
                      placeholder={locale === 'zh' ? '例如：打完我去打DD·' : 'e.g. Team group'}
                    />
                  </label>
                  <label className="botFullWidth">
                    {locale === 'zh' ? '目标群会话 ID / openConversationId' : 'Target group conversation ID / openConversationId'}
                    <input
                      value={botDraft.dingtalk.targetGroupConversationId}
                      onChange={(event) => patchDingtalk({ targetGroupConversationId: event.target.value })}
                      placeholder="cidxxxx 或 openConversationId"
                    />
                  </label>
                  <label>
                    {locale === 'zh' ? 'Webhook 签名密钥（Webhook 模式）' : 'Webhook secret (webhook mode)'}
                    <input type="password" value={botDraft.dingtalk.webhookSecret} onChange={(event) => patchDingtalk({ webhookSecret: event.target.value })} />
                  </label>
                  {botStatus?.dingtalk?.lastDetectedGroupConversationId ? (
                    <p className="botNotice botFullWidth">
                      {locale === 'zh'
                        ? `最近检测到群 ID：${botStatus.dingtalk.lastDetectedGroupConversationId}`
                        : `Last detected group ID: ${botStatus.dingtalk.lastDetectedGroupConversationId}`}
                    </p>
                  ) : null}
                  <label className="botFullWidth">
                    {locale === 'zh' ? '白名单用户 staffId（逗号分隔，留空表示所有用户可访问）' : 'Allowed staffIds (comma-separated; empty = open to all)'}
                    <input
                      value={botDraft.dingtalk.allowedUsers.join(',')}
                      onChange={(event) => patchDingtalk({ allowedUsers: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder="manager123,dev456"
                    />
                  </label>
                  <label className="toggle botToggle inlineToggle">
                    <input
                      type="checkbox"
                      checked={botDraft.dingtalk.autoStart}
                      onChange={(event) => patchDingtalk({ autoStart: event.target.checked })}
                    />
                    <span>{locale === 'zh' ? '服务启动时自动连接' : 'Auto-connect on startup'}</span>
                  </label>
                </div>

                <div className="botActionRow">
                  <button className="solidButton" onClick={() => void saveDingtalkConfig()}>
                    {locale === 'zh' ? '保存配置' : 'Save config'}
                  </button>
                  {botDraft.dingtalk.enabled && botDraft.dingtalk.clientId && botDraft.dingtalk.clientSecret ? (
                    <>
                      {botStatus?.dingtalk?.streamRunning ? (
                        <button className="outlineButton" onClick={() => void handleStopDingtalk()}>
                          {locale === 'zh' ? '断开 Stream' : 'Disconnect stream'}
                        </button>
                      ) : (
                        <button className="solidButton" onClick={() => void handleStartDingtalk()}>
                          {locale === 'zh' ? '启动 Stream' : 'Start stream'}
                        </button>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="botTestRow">
                  <input
                    className="botTestInput"
                    placeholder={locale === 'zh' ? '测试：conversationId' : 'Test: conversationId'}
                    value={dingtalkTestConvId}
                    onChange={(event) => setDingtalkTestConvId(event.target.value)}
                  />
                  <select value={dingtalkTestConvType} onChange={(event) => setDingtalkTestConvType(event.target.value as 'dm' | 'group')}>
                    <option value="dm">{locale === 'zh' ? '单聊' : 'DM'}</option>
                    <option value="group">{locale === 'zh' ? '群聊' : 'Group'}</option>
                  </select>
                  <button className="outlineButton" onClick={() => void handleTestDingtalk()}>
                    {locale === 'zh' ? '发送测试消息' : 'Send test'}
                  </button>
                </div>

                {dingtalkNotice || botStatus?.dingtalk?.error ? (
                  <p className="botNotice">{dingtalkNotice || botStatus?.dingtalk?.error}</p>
                ) : null}
              </div>

              {/* 钉钉 CLI (dws) 面板 */}
              {botConfig?.dingtalk?.enabled ? (
              <div className="dingtalkBotPanel">
                <div className="weixinBotHeader">
                  <div>
                    <strong>{locale === 'zh' ? '钉钉 CLI (dws)' : 'DingTalk CLI (dws)'}</strong>
                    <span>{locale === 'zh' ? '与机器人搭配使用，Agent 通过 CLI 操作钉钉企业数据' : 'Works alongside the bot; Agent operates DingTalk enterprise data via CLI'}</span>
                  </div>
                </div>

                <label className="toggle botToggle">
                  <input
                    type="checkbox"
                    checked={botDraft.dwsCli.enabled}
                    onChange={(event) => patchDwsCli({ enabled: event.target.checked })}
                  />
                  <span>{locale === 'zh' ? '启用 dws CLI' : 'Enable dws CLI'}</span>
                </label>

                <div className="botFormGrid">
                  <label className="botFullWidth">
                    {locale === 'zh' ? 'dws 可执行文件路径' : 'dws binary path'}
                    <input
                      value={botDraft.dwsCli.binaryPath}
                      onChange={(event) => patchDwsCli({ binaryPath: event.target.value })}
                      placeholder="/usr/local/bin/dws"
                    />
                  </label>
                  <label>
                    Client ID (AppKey)
                    <input value={botDraft.dwsCli.clientId} onChange={(event) => patchDwsCli({ clientId: event.target.value })} placeholder="dingxxxxxxxxxx" />
                  </label>
                  <label>
                    Client Secret (AppSecret)
                    <input type="password" value={botDraft.dwsCli.clientSecret} onChange={(event) => patchDwsCli({ clientSecret: event.target.value })} placeholder="••••••••" />
                  </label>
                </div>

                <div className="botActionRow">
                  <button className="solidButton" onClick={() => void saveDwsCliConfig()}>
                    {locale === 'zh' ? '保存配置' : 'Save config'}
                  </button>
                </div>

                {dingtalkNotice ? (
                  <p className="botNotice">{dingtalkNotice}</p>
                ) : null}
              </div>
              ) : null}

              <div className="remoteBotGrid compactBots">
                {[
                  [locale === 'zh' ? '飞书' : 'Feishu', botDraft.feishu.enabled],
                  ['QQ', botDraft.qq.enabled],
                ].map(([name, enabled]) => (
                  <article className="remoteBotCard" key={String(name)}>
                    <strong>{name}</strong>
                    <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
                    <small>{enabled ? (locale === 'zh' ? '已预留' : 'Reserved') : (locale === 'zh' ? '待接入' : 'Pending')}</small>
                  </article>
                ))}
              </div>
            </section>
            ) : null}

            {activeSection === 'admin' ? (
            <section className="settingsSection" id="settings-admin">
              <div className="presetHeader">
                <div>
                  <h3>{locale === 'zh' ? 'Token 管理' : 'Token management'}</h3>
                  <span>{locale === 'zh' ? '创建、轮换和删除租户/机器人/管理员 Token' : 'Create, rotate, and delete tenant, bot, and admin tokens'}</span>
                </div>
                <button className="textButton" onClick={() => void refreshAuthTokens()}>{t(locale, 'refresh')}</button>
              </div>
              <div className="formGrid">
                <label>
                  Bootstrap Token
                  <input type="password" value={adminBootstrapToken} onChange={(event) => setAdminBootstrapToken(event.target.value)} />
                </label>
                <label>
                  {t(locale, 'name')}
                  <input value={newAuthToken.name} onChange={(event) => setNewAuthToken({ ...newAuthToken, name: event.target.value })} />
                </label>
                <label>
                  Role
                  <select value={newAuthToken.role} onChange={(event) => setNewAuthToken({ ...newAuthToken, role: event.target.value as 'admin' | 'tenant' | 'bot' })}>
                    <option value="tenant">tenant</option>
                    <option value="bot">bot</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label>
                  Tenant
                  <input value={newAuthToken.tenantId} onChange={(event) => setNewAuthToken({ ...newAuthToken, tenantId: event.target.value })} />
                </label>
                <label>
                  Scopes
                  <input value={newAuthToken.scopes} onChange={(event) => setNewAuthToken({ ...newAuthToken, scopes: event.target.value })} />
                </label>
              </div>
              <div className="botActionRow">
                <button className="solidButton" onClick={() => void createAuthToken()}>
                  {locale === 'zh' ? '创建 Token' : 'Create token'}
                </button>
              </div>
              {authTokenNotice ? <p className="botNotice">{authTokenNotice}</p> : null}
              <div className="mcpList">
                {authTokens.map((token) => (
                  <article className="mcpItem" key={token.id}>
                    <div>
                      <strong>{token.name || token.id}</strong>
                      <span>{token.role} · {token.tenantId} · {token.tokenPrefix}... · {token.enabled ? 'enabled' : 'disabled'}</span>
                    </div>
                    <div className="mcpActions">
                      <button className="textButton" onClick={() => void rotateAuthToken(token.id)}>{locale === 'zh' ? '轮换' : 'Rotate'}</button>
                      <button className="textButton danger" onClick={() => void deleteAuthToken(token.id)}>{locale === 'zh' ? '删除' : 'Delete'}</button>
                    </div>
                  </article>
                ))}
              </div>
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
