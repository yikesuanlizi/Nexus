import React, { useEffect, useState } from 'react';
import type { Locale, RunConfig, RunProfile, ThemeMode, WebSearchMode } from '../config.js';
import { Icon } from './Icon.js';
import { emptyMcp } from '../defaults.js';
import { formatTimestamp, t } from '../i18n.js';
import { localizedSkillDescription } from '../skillDescriptions.js';
import { upsertById } from '../threadItems.js';
import type { ApiKeyState, BotConfig, BotStatus, McpConfig, McpServerStatus, ModelPreset, ProviderEntry, SkillEntry } from '../types.js';

const defaultBotConfig: BotConfig = {
  weixin: {
    enabled: false,
    bridgeUrl: 'http://127.0.0.1:18790/api/v1/admin/rpc',
    accountId: '',
    activeThreadId: '',
  },
  feishu: { enabled: false },
  dingtalk: { enabled: false },
  qq: { enabled: false },
};

export function SettingsDrawer({
  applyModelPreset,
  botConfig,
  botStatus,
  clearProviderKey,
  config,
  deleteModelPreset,
  keyStates,
  locale,
  mcps,
  mcpStatuses,
  modelPresets,
  providers,
  pendingMcpDraft,
  saveModelPreset,
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
  consumePendingMcpDraft,
}: {
  applyModelPreset: (preset: ModelPreset) => void;
  botConfig: BotConfig | null;
  botStatus: BotStatus | null;
  clearProviderKey: (providerId: string) => Promise<void>;
  config: RunConfig;
  deleteModelPreset: (id: string) => Promise<void>;
  keyStates: ApiKeyState[];
  locale: Locale;
  mcps: McpConfig[];
  mcpStatuses: McpServerStatus[];
  modelPresets: ModelPreset[];
  pendingMcpDraft?: McpConfig | null;
  providers: ProviderEntry[];
  skillsList: SkillEntry[];
  refreshSkills: () => Promise<void>;
  refreshMcpStatus: () => Promise<void>;
  refreshBotStatus: () => Promise<void>;
  saveModelPreset: () => Promise<void>;
  saveBotConfig: (config: BotConfig) => Promise<void>;
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  selectProvider: (providerId: string) => void;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  setOpen: (open: boolean) => void;
  consumePendingMcpDraft?: () => void;
}) {
  const [skillsRootDraft, setSkillsRootDraft] = useState(config.skillsRoot);
  const [botDraft, setBotDraft] = useState<BotConfig>(botConfig ?? defaultBotConfig);
  const [weixinNotice, setWeixinNotice] = useState('');
  const [mcpDraft, setMcpDraft] = useState<McpConfig>(emptyMcp());
  const [editingMcpId, setEditingMcpId] = useState('');
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [activeSection, setActiveSection] = useState('agent');
  const selectedProvider = providers.find((provider) => provider.id === config.provider);
  const selectedKeyState = keyStates.find((state) => state.providerId === config.provider);
  const mcpPanelTitle = editingMcpId ? t(locale, 'editMcp') : t(locale, 'addMcp');
  const settingsTabs = [
    { id: 'agent', label: t(locale, 'agentSettings') },
    { id: 'presets', label: t(locale, 'modelPresets') },
    { id: 'plugins', label: locale === 'zh' ? '插件中心' : 'Plugins' },
    { id: 'skills', label: t(locale, 'skills') },
    { id: 'mcp', label: t(locale, 'mcp') },
    { id: 'remote', label: locale === 'zh' ? '远程助手' : 'Remote bots' },
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

  function saveMcp() {
    if (!mcpDraft.name.trim() || !mcpDraft.command.trim()) return;
    setMcps((current) => upsertById(current, { ...mcpDraft, id: editingMcpId || crypto.randomUUID() }));
    closeMcpPanel();
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

          <div className="settingsContent">
            {activeSection === 'agent' ? (
            <section className="settingsSection settingsHero" id="settings-agent">
              <h3>{t(locale, 'agentSettings')}</h3>
              <div className="formGrid">
                <label>
                  {t(locale, 'provider')}
                  <select value={config.provider} onChange={(event) => selectProvider(event.target.value)}>
                    <ProviderOptions providers={providers} locale={locale} />
                  </select>
                </label>
                <label>
                  {t(locale, 'model')}
                  <input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} />
                </label>
                <label>
                  {t(locale, 'baseUrl')}
                  <input placeholder="provider default" value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
                </label>
                <label>
                  {t(locale, 'language')}
                  <select value={config.locale} onChange={(event) => setConfig({ ...config, locale: event.target.value as Locale })}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  {locale === 'zh' ? '外观' : 'Theme'}
                  <select value={config.themeMode} onChange={(event) => setConfig({ ...config, themeMode: event.target.value as ThemeMode })}>
                    <option value="dark">{locale === 'zh' ? '深色' : 'Dark'}</option>
                    <option value="light">{locale === 'zh' ? '浅色' : 'Light'}</option>
                    <option value="system">{locale === 'zh' ? '跟随系统' : 'System'}</option>
                  </select>
                </label>
                <label>
                  {t(locale, 'webSearch')}
                  <select value={config.webSearchMode} onChange={(event) => setConfig({ ...config, webSearchMode: event.target.value as WebSearchMode })}>
                    <option value="auto">{t(locale, 'webSearchAuto')}</option>
                    <option value="on">{t(locale, 'webSearchOn')}</option>
                    <option value="off">{t(locale, 'webSearchOff')}</option>
                  </select>
                </label>
                <label className="wideField">
                  {locale === 'zh' ? '运行模式' : 'Run profile'}
                  <select value={config.runProfile} onChange={(event) => setConfig({ ...config, runProfile: event.target.value as RunProfile })}>
                    <option value="cache_first">{locale === 'zh' ? '缓存优先' : 'Cache first'}</option>
                    <option value="runtime_os">{locale === 'zh' ? '长运行' : 'Long-running'}</option>
                  </select>
                </label>
              </div>
              <div className="runProfileInfoGrid">
                <div className={config.runProfile === 'cache_first' ? 'active' : ''}>
                  <strong>{locale === 'zh' ? '缓存优先' : 'Cache first'}</strong>
                  <span>
                    {locale === 'zh'
                      ? '保持 system prompt、Skills 和工具 schema 稳定，尽量延迟自动压缩，提高 DeepSeek / OpenAI 兼容模型的缓存命中。适合连续问答、阅读项目和成本敏感任务；编码也可使用，但上下文接近极限时仍会自动压缩。'
                      : 'Keeps the system prompt, Skills, and tool schemas stable, delaying automatic compaction to improve DeepSeek/OpenAI-compatible cache hits. Good for continuous chat, project reading, and cost-sensitive work; coding can use it too, but it still compacts near the context limit.'}
                  </span>
                </div>
                <div className={config.runProfile === 'runtime_os' ? 'active' : ''}>
                  <strong>{locale === 'zh' ? '长运行' : 'Long-running'}</strong>
                  <span>
                    {locale === 'zh'
                      ? '使用 Nexus Runtime OS 策略，优先保证长任务、多智能体、工具调用、上下文压缩、检查点和中断恢复可追踪。适合代码修改、复杂任务和多 Agent 协作；缓存命中会因压缩和运行状态变化而波动。'
                      : 'Uses the Nexus Runtime OS strategy for traceable long tasks, multi-agent work, tool calls, context compaction, checkpoints, and interruption recovery. Best for code changes and complex tasks; cache hits may fluctuate when compaction or runtime state changes.'}
                  </span>
                </div>
              </div>
              <div className="providerCard">
                <div>
                  <strong>{selectedProvider?.name ?? config.provider}</strong>
                  <span>{selectedProvider?.description ?? ''}</span>
                </div>
                <code>{selectedProvider?.baseUrl ?? config.baseUrl}</code>
                {selectedProvider?.isLocal ? (
                  <small className="ok">{t(locale, 'noKeyNeeded')}</small>
                ) : (
                  <div className="keyBox">
                    <small className={selectedKeyState?.configured ? 'ok' : 'warn'}>
                      {selectedKeyState?.configured
                        ? `${t(locale, 'keyConfigured')} (${selectedKeyState.source === 'env' ? t(locale, 'keySourceEnv') : t(locale, 'keySourceConfig')}) ${selectedKeyState.masked ?? ''}`
                        : `${t(locale, 'keyMissing')}: ${selectedProvider?.apiKeyEnvVar ?? ''}`}
                    </small>
                    <div className="keyActions">
                      <input
                        placeholder={selectedProvider?.apiKeyEnvVar || t(locale, 'apiKey')}
                        value={apiKeyDraft}
                        onChange={(event) => setApiKeyDraft(event.target.value)}
                        type="password"
                      />
                      <button
                        className="solidButton"
                        onClick={() => {
                          if (!apiKeyDraft.trim()) return;
                          void saveProviderKey(config.provider, apiKeyDraft.trim()).then(() => setApiKeyDraft(''));
                        }}
                      >
                        {t(locale, 'saveKey')}
                      </button>
                      <button className="textButton" onClick={() => void clearProviderKey(config.provider)}>
                        {t(locale, 'clearKey')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
            ) : null}

            {activeSection === 'presets' ? (
            <section className="settingsSection" id="settings-presets">
              <div className="presetHeader">
                <div>
                  <h3>{t(locale, 'modelPresets')}</h3>
                  <span>{selectedProvider?.name ?? config.provider} · {config.model}</span>
                </div>
                <button className="solidButton" onClick={() => void saveModelPreset()}>
                  {t(locale, 'saveModelPreset')}
                </button>
              </div>
              {modelPresets.length === 0 ? (
                <p className="emptyHint">{t(locale, 'noModelPresets')}</p>
              ) : (
                <div className="presetList">
                  {modelPresets.map((preset) => {
                    const presetProvider = providers.find((provider) => provider.id === preset.config.provider);
                    return (
                      <article className="presetItem" key={preset.id}>
                        <div>
                          <strong>{preset.name}</strong>
                          <span>
                            {presetProvider?.name ?? preset.config.provider ?? ''} · {preset.config.model ?? ''} · {formatTimestamp(preset.updatedAt, locale)}
                          </span>
                        </div>
                        <button className="textButton" onClick={() => applyModelPreset(preset)}>
                          {t(locale, 'applyPreset')}
                        </button>
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
            <section className="settingsSection pluginHub" id="settings-plugins">
              <div className="presetHeader">
                <div>
                  <h3>{locale === 'zh' ? '插件中心' : 'Plugin Hub'}</h3>
                  <span>{locale === 'zh' ? '统一管理 Skills、MCP 和远程助手' : 'Manage Skills, MCP, and remote bots together'}</span>
                </div>
              </div>
              <div className="pluginCards">
                <button className="pluginCard" onClick={() => setActiveSection('skills')} type="button">
                  <strong>{t(locale, 'skills')}</strong>
                  <span>{locale === 'zh' ? `${skillsList.length} 个已安装技能` : `${skillsList.length} installed skills`}</span>
                </button>
                <button className="pluginCard" onClick={() => setActiveSection('mcp')} type="button">
                  <strong>{t(locale, 'mcp')}</strong>
                  <span>{locale === 'zh' ? `${mcps.filter((item) => item.enabled).length}/${mcps.length} 个已启用` : `${mcps.filter((item) => item.enabled).length}/${mcps.length} enabled`}</span>
                </button>
                <button className="pluginCard" onClick={() => setActiveSection('remote')} type="button">
                  <strong>{locale === 'zh' ? '远程助手' : 'Remote bots'}</strong>
                  <span>{locale === 'zh' ? '飞书 / 微信 / QQ / 钉钉' : 'Feishu / WeChat / QQ / DingTalk'}</span>
                </button>
              </div>
            </section>
            ) : null}

            {activeSection === 'skills' ? (
            <section className="settingsSection" id="settings-skills">
              <div className="presetHeader">
                <div>
                  <h3>{t(locale, 'skills')}</h3>
                  <span>{t(locale, 'installedSkills')} · {skillsList.length}</span>
                </div>
                <button className="textButton" onClick={() => void refreshSkills()}>{t(locale, 'refresh')}</button>
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

            {activeSection === 'mcp' ? (
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
              onRefresh={() => void refreshMcpStatus()}
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
                      ? (locale === 'zh' ? '已绑定' : 'Connected')
                      : (locale === 'zh' ? '未绑定' : 'Not connected')}
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
                    <strong>{botDraft.weixin.accountId || (locale === 'zh' ? '未绑定' : 'Not connected')}</strong>
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

              <div className="remoteBotGrid compactBots">
                {[
                  [locale === 'zh' ? '飞书' : 'Feishu', botDraft.feishu.enabled],
                  [locale === 'zh' ? '钉钉' : 'DingTalk', botDraft.dingtalk.enabled],
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
          </div>
        </div>
      </aside>

      {mcpPanelOpen ? (
        <div className="dialogLayer" role="presentation" onMouseDown={closeMcpPanel}>
          <section
            className="appDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-panel-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="dialogHeader">
              <h2 id="mcp-panel-title">{mcpPanelTitle}</h2>
              <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={closeMcpPanel}>
                <Icon name="x" />
              </button>
            </header>
            <div className="mcpPanelForm">
              <label>
                {t(locale, 'name')}
                <input value={mcpDraft.name} onChange={(event) => setMcpDraft({ ...mcpDraft, name: event.target.value })} />
              </label>
              <label>
                {t(locale, 'command')}
                <input value={mcpDraft.command} onChange={(event) => setMcpDraft({ ...mcpDraft, command: event.target.value })} />
              </label>
              <label>
                {t(locale, 'args')}
                <input value={mcpDraft.args} onChange={(event) => setMcpDraft({ ...mcpDraft, args: event.target.value })} />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={mcpDraft.enabled}
                  onChange={(event) => setMcpDraft({ ...mcpDraft, enabled: event.target.checked })}
                />
                <span>{t(locale, 'enabled')}</span>
              </label>
            </div>
            <div className="dialogActions">
              <button className="textButton" onClick={closeMcpPanel}>{t(locale, 'cancel')}</button>
              <button className="solidButton" onClick={saveMcp}>{t(locale, 'save')}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ProviderOptions({ providers, locale }: { providers: ProviderEntry[]; locale: Locale }) {
  const local = providers.filter((provider) => provider.isLocal && provider.id !== 'openai_compatible');
  const generic = providers.filter((provider) => provider.id === 'openai_compatible');
  const chinaIds = new Set(['deepseek', 'zhipu', 'kimi', 'qwen', 'baidu', 'volcengine', 'siliconflow']);
  const china = providers.filter((provider) => chinaIds.has(provider.id));
  const global = providers.filter((provider) => !provider.isLocal && !chinaIds.has(provider.id));

  return (
    <>
      <optgroup label={t(locale, 'localProvider')}>
        {local.map((provider) => (
          <option value={provider.id} key={provider.id}>
            {provider.name} - {provider.baseUrl.replace(/^https?:\/\//, '')}
          </option>
        ))}
      </optgroup>
      <optgroup label={t(locale, 'remoteChina')}>
        {china.map((provider) => (
          <option value={provider.id} key={provider.id}>
            {provider.name} - {provider.apiKeyEnvVar}
          </option>
        ))}
      </optgroup>
      <optgroup label={t(locale, 'remoteGlobal')}>
        {global.map((provider) => (
          <option value={provider.id} key={provider.id}>
            {provider.name} - {provider.apiKeyEnvVar}
          </option>
        ))}
      </optgroup>
      <optgroup label={t(locale, 'genericProvider')}>
        {generic.map((provider) => (
          <option value={provider.id} key={provider.id}>
            {provider.name} - {provider.baseUrl.replace(/^https?:\/\//, '')}
          </option>
        ))}
      </optgroup>
    </>
  );
}

function McpSection({
  addLabel,
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
      <div className="presetHeader">
        <h3>{title}</h3>
        <div className="headerActions">
          <button className="textButton" onClick={onRefresh}>{t(locale, 'refresh')}</button>
          <button className="solidButton" onClick={onAdd}>{addLabel}</button>
        </div>
      </div>
      <div className="crudList">
        {items.map((item) => {
          const status = statusById.get(item.id);
          const statusText = mcpStatusText(status, item.enabled, locale);
          return (
            <article className="crudItem" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{`${item.command} ${item.args}`}</span>
              </div>
              <span className={`mcpRuntimeStatus ${statusText.tone}`} title={status?.error ?? status?.stderr ?? ''}>
                <span aria-hidden="true">{statusText.dot}</span>
                {statusText.label}
              </span>
              <button
                className={item.enabled ? 'mcpToggle enabled' : 'mcpToggle'}
                onClick={() => onToggleEnabled(item.id)}
                title={item.enabled ? t(locale, 'enabled') : 'Off'}
              >
                {item.enabled ? t(locale, 'enabled') : 'Off'}
              </button>
              <button className="textButton" onClick={() => onEdit(item)}>{t(locale, 'edit')}</button>
              <button className="iconButton danger" title={t(locale, 'remove')} aria-label={t(locale, 'remove')} onClick={() => onDelete(item.id)}>
                <Icon name="trash" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function mcpStatusText(
  status: McpServerStatus | undefined,
  enabled: boolean,
  locale: Locale,
): { label: string; dot: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (!enabled || !status || status.status === 'disabled') {
    return { label: locale === 'zh' ? '已禁用' : 'Disabled', dot: '○', tone: 'muted' };
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
  return { label: status.error ? `${label} · ${status.error}` : label, dot: '●', tone: 'danger' };
}
