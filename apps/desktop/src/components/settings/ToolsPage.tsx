// 设置面板：工具/插件中心页（recommended / mcp / skills / web 四个 tab）
import React, { useState } from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import type { ApiKeyState, McpConfig, McpServerStatus, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { recommendedPluginCatalog, type RecommendedMcp, type RecommendedSkill } from '../../features/settings/pluginCatalog.js';
import { localizedSkillDescription } from '../../features/settings/skillDescriptions.js';
import { pluginNavIcon, recommendedCardVisual, skillCardVisual, webToolCardVisual } from './shared.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';

export interface ToolsPageProps {
  locale: Locale;
  // 配置
  config: RunConfig;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  // MCP
  mcps: McpConfig[];
  setMcps: React.Dispatch<React.SetStateAction<McpConfig[]>>;
  mcpStatuses: McpServerStatus[];
  refreshMcpStatus: (detail?: 'light' | 'full') => Promise<void>;
  openAddMcpPanel: () => void;
  openEditMcpPanel: (item: McpConfig) => void;
  // Skills
  skillsList: SkillEntry[];
  skillsRootDraft: string;
  setSkillsRootDraft: (value: string) => void;
  saveSkillsRoot: () => void;
  refreshSkills: (options?: { forceReload?: boolean }) => Promise<void>;
  deleteSkill: (name: string) => Promise<void>;
  installRecommendedSkill: (item: RecommendedSkill) => Promise<void>;
  addRecommendedMcp: (item: RecommendedMcp) => void;
  // 联网工具
  webProviderState: WebProviderPublicConfig | null;
  setFirecrawlDialogOpen: (open: boolean) => void;
  handleFirecrawlToggle: (nextEnabled: boolean) => Promise<void>;
  // 全局插件提示
  pluginNotice: string;
  setPluginNotice: (value: string) => void;
  // P2.2 dirty 跟踪
  dirtyFields: Record<string, boolean>;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

type PluginTab = 'recommended' | 'mcp' | 'skills' | 'web';

function isMcpOnline(status: McpServerStatus | undefined): boolean {
  return status?.status === 'running';
}

function countTools(mcpStatus: McpServerStatus | undefined): number {
  return mcpStatus?.tools?.length ?? 0;
}

export function ToolsPage({
  locale,
  config,
  setConfig,
  mcps,
  setMcps,
  mcpStatuses,
  refreshMcpStatus,
  openAddMcpPanel,
  openEditMcpPanel,
  skillsList,
  skillsRootDraft,
  setSkillsRootDraft,
  saveSkillsRoot,
  refreshSkills,
  deleteSkill,
  installRecommendedSkill,
  addRecommendedMcp,
  webProviderState,
  setFirecrawlDialogOpen,
  handleFirecrawlToggle,
  pluginNotice,
}: ToolsPageProps) {
  const [activeTab, setActiveTab] = useState<'recommended' | 'mcp' | 'skills' | 'web'>('recommended');
  const [search, setSearch] = useState('');

  const firecrawlMasked = webProviderState?.firecrawl.masked ?? '';
  const firecrawlHasPreview = /[.•·]/.test(firecrawlMasked);
  const firecrawlConfigured = Boolean(webProviderState?.firecrawl.configured && firecrawlHasPreview);
  const firecrawlEnabled = config.webProvider === 'firecrawl';

  const query = search.trim().toLowerCase();
  const filteredRecommended = recommendedPluginCatalog.filter((item) => {
    if (!query) return true;
    return [
      item.name,
      item.titleZh,
      item.titleEn,
      item.descriptionZh,
      item.descriptionEn,
      item.type,
    ].some((value) => value.toLowerCase().includes(query));
  });
  const filteredMcps = mcps.filter((item) => {
    if (!query) return true;
    return [item.name, item.command, item.args].some((value) => value.toLowerCase().includes(query));
  });
  const filteredSkills = skillsList.filter((skill) => {
    if (!query) return true;
    return [
      skill.name,
      localizedSkillDescription(skill, locale),
      skill.sourcePath ?? '',
    ].some((value) => value.toLowerCase().includes(query));
  });

  const onlineMcpCount = filteredMcps.filter((mcp) => {
    const status = mcpStatuses.find((s) => s.id === mcp.id);
    return isMcpOnline(status);
  }).length;

  const tabs = [
    { id: 'recommended' as const, label: text(locale, '推荐', 'Recommended'), count: filteredRecommended.length, total: recommendedPluginCatalog.length },
    { id: 'mcp' as const, label: 'MCP', count: filteredMcps.length, total: mcps.length },
    { id: 'skills' as const, label: t(locale, 'skills'), count: filteredSkills.length, total: skillsList.length },
    { id: 'web' as const, label: text(locale, '联网工具', 'Web tools'), count: 2, total: 2 },
  ];

  const activeTabItem = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  function handleToggleMcpEnabled(id: string) {
    setMcps((current) => current.map((item) => (
      item.id === id ? { ...item, enabled: !item.enabled } : item
    )));
  }

  function handleDeleteMcp(id: string) {
    setMcps((current) => current.filter((item) => item.id !== id));
  }

  function renderEmpty() {
    return <p className="pluginCatalogEmpty">{text(locale, '暂无内容', 'No items')}</p>;
  }

  return (
    <section className="settingsSection pluginCatalogShell" id="settings-plugins">
      <SettingsPageHeader
        eyebrow="EXTENSIONS"
        title={locale === 'zh' ? '插件中心' : 'Plugins'}
        actions={[
          {
            label: t(locale, 'refresh'),
            onClick: () => {
              void refreshMcpStatus('full');
              void refreshSkills({ forceReload: true });
            },
          },
          {
            label: t(locale, 'addMcp'),
            primary: true,
            onClick: openAddMcpPanel,
          },
        ]}
      />

      <div className="settingsSectionBlock pluginCatalogBlock">
        <div className="pluginCatalogToolbar">
          <div className="pluginCatalogTabs" role="tablist" aria-label={text(locale, '插件分类', 'Categories')}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon name={pluginNavIcon(tab.id)} />
                {tab.label}
                <span className="pluginCatalogTabCount">{tab.count}</span>
              </button>
            ))}
          </div>
          <input
            className="pluginSearchField"
            placeholder={text(locale, '搜索插件、MCP 或 Skill', 'Search plugins, MCP or Skill')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {pluginNotice ? <p className="settingsNotice">{pluginNotice}</p> : null}

        <div className="pluginCatalogPane">
          {activeTab === 'recommended' && (
            <div className="pluginCatalogSubpane" role="tabpanel">
              <div className="pluginCatalogSummary">
                <span>{text(locale, '按本机可用能力推荐，不会自动修改配置。', 'Recommended by local capabilities, will not auto-modify config.')}</span>
                <span>
                  <b>{filteredRecommended.length}</b> {text(locale, '个可安装扩展', 'installable extensions')}
                </span>
              </div>
              {filteredRecommended.length === 0 ? renderEmpty() : (
                <div className="pluginGrid">
                  {filteredRecommended.map((item) => {
                    const installed = item.type === 'skill'
                      ? skillsList.some((skill) => skill.name === item.name)
                      : mcps.some((mcp) => mcp.name === item.name);
                    const visual = recommendedCardVisual(item);
                    return (
                      <article className="pluginCard" key={item.id}>
                        <div className="pluginCardHead">
                          <span className="pluginCardIcon" style={{ background: visual.bg }}>
                            <Icon name={visual.icon} />
                          </span>
                          <b>{locale === 'zh' ? item.titleZh : item.titleEn}</b>
                        </div>
                        <p>{locale === 'zh' ? item.descriptionZh : item.descriptionEn}</p>
                        <div className="pluginCardFooter">
                          <div className="pluginCardMeta">
                            <span className="pluginTag">{item.type === 'skill' ? 'Skill' : 'MCP'}</span>
                            <span>{item.type === 'skill' ? text(locale, '本地', 'Local') : text(locale, '远程', 'Remote')}</span>
                          </div>
                          {installed ? (
                            <button className="settingsPageHeaderAction ghost" disabled type="button">
                              {text(locale, '已添加', 'Added')}
                            </button>
                          ) : item.type === 'skill' ? (
                            <button
                              className="settingsPageHeaderAction primary"
                              type="button"
                              onClick={() => void installRecommendedSkill(item)}
                            >
                              {text(locale, '安装', 'Install')}
                            </button>
                          ) : (
                            <button
                              className="settingsPageHeaderAction primary"
                              type="button"
                              onClick={() => addRecommendedMcp(item)}
                            >
                              {text(locale, '添加', 'Add')}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'mcp' && (
            <div className="pluginCatalogSubpane" role="tabpanel">
              <div className="pluginCatalogSummary">
                <span>{text(locale, '所有 MCP 的状态、命令、工具数量与启用开关都在这里。', 'All MCP status, commands, tool counts and enable switches.')}</span>
                <span>
                  <b>{onlineMcpCount} / {filteredMcps.length}</b> {text(locale, '在线', 'online')}
                </span>
              </div>
              {filteredMcps.length === 0 ? renderEmpty() : (
                <div className="pluginGrid">
                  {filteredMcps.map((mcp) => {
                    const status = mcpStatuses.find((s) => s.id === mcp.id);
                    const toolCount = countTools(status);
                    const isOnline = isMcpOnline(status);
                    return (
                      <article className="pluginCard" key={mcp.id}>
                        <div className="pluginCardHead">
                          <span className="pluginCardIcon">
                            <Icon name="panel" />
                          </span>
                          <b>{mcp.name}</b>
                        </div>
                        <p><code>{mcp.command} {mcp.args}</code></p>
                        <div className="pluginCardFooter">
                          <div className="pluginCardMeta">
                            {isOnline ? (
                              <span className="pluginTag ok">{toolCount} {text(locale, '个工具', 'tools')}</span>
                            ) : (
                              <span className="pluginTag">{text(locale, '已暂停', 'Paused')}</span>
                            )}
                          </div>
                          <div className="pluginCardActions">
                            <label className={`settingsToggleTrack mini ${mcp.enabled ? 'on' : ''}`} title={mcp.enabled ? text(locale, '已启用', 'Enabled') : text(locale, '已禁用', 'Disabled')}>
                              <input
                                type="checkbox"
                                checked={mcp.enabled}
                                onChange={() => handleToggleMcpEnabled(mcp.id)}
                              />
                              <span className="settingsToggleThumb" />
                            </label>
                            <button className="settingsPageHeaderAction ghost" type="button" onClick={() => openEditMcpPanel(mcp)}>
                              {t(locale, 'edit')}
                            </button>
                            <button className="textButton danger" type="button" onClick={() => handleDeleteMcp(mcp.id)}>
                              <Icon name="trash" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="pluginCatalogSubpane" role="tabpanel">
              <div className="pluginRowCard">
                <div className="pluginRowCardText">
                  <strong>{t(locale, 'skillsRoot')}</strong>
                  <span>{text(locale, '扫描并加载工作区中可用的技能定义。', 'Scan and load available skill definitions in the workspace.')}</span>
                </div>
                <div className="pluginRowCardActions">
                  <input
                    className="pluginRowCardInput"
                    value={skillsRootDraft}
                    onChange={(event) => setSkillsRootDraft(event.target.value)}
                  />
                  <button
                    className="settingsPageHeaderAction primary"
                    type="button"
                    onClick={saveSkillsRoot}
                    disabled={skillsRootDraft === config.skillsRoot}
                  >
                    {t(locale, 'saveSkillsRoot')}
                  </button>
                </div>
              </div>
              {filteredSkills.length === 0 ? (
                <p className="pluginCatalogEmpty">{t(locale, 'noSkills')}</p>
              ) : (
                <div className="pluginGrid">
                  {filteredSkills.map((skill) => {
                    const visual = skillCardVisual(skill.name);
                    return (
                      <article className="pluginCard" key={skill.sourcePath || skill.name}>
                        <div className="pluginCardHead">
                          <span className="pluginCardIcon" style={{ background: visual.bg }}>
                            <Icon name={visual.icon} />
                          </span>
                          <b>{skill.name}</b>
                        </div>
                        <p>{localizedSkillDescription(skill, locale)}</p>
                        <div className="pluginCardFooter">
                          <div className="pluginCardMeta">
                            <span className="pluginTag">Skill</span>
                            <span>{text(locale, '本地', 'Local')}</span>
                          </div>
                          <button
                            className="settingsPageHeaderAction ghost danger"
                            type="button"
                            aria-label={t(locale, 'remove')}
                            onClick={() => void deleteSkill(skill.name)}
                          >
                            {t(locale, 'remove')}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'web' && (
            <div className="pluginCatalogSubpane" role="tabpanel">
              <div className="pluginCatalogSummary">
                <span>{text(locale, '网页读取方式按任务选择，密钥状态不展示明文。', 'Choose web reading method per task; key status is masked.')}</span>
                <span>
                  <b>{firecrawlConfigured ? 1 : 0}</b> {text(locale, '个已配置', 'configured')}
                </span>
              </div>
              <div className="remoteColumns">
                <div className="cluster">
                  <div className="clusterHeader">
                    <div>
                      <h3>{text(locale, '本地读取', 'Local fetch')}</h3>
                    </div>
                    {!firecrawlEnabled ? <span className="settingsSectionHeaderChip">{text(locale, '默认', 'Default')}</span> : null}
                  </div>
                  <div className="clusterBody">
                    <div className="compactOption">
                      <div>
                        <strong>{text(locale, '在简单页面优先使用', 'Prefer on simple pages')}</strong>
                        <p>{text(locale, '将页面正文转为可读取文本。', 'Convert page body to readable text.')}</p>
                      </div>
                      <label className={`settingsToggleTrack mini ${!firecrawlEnabled ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!firecrawlEnabled}
                          onChange={() => void handleFirecrawlToggle(false)}
                        />
                        <span className="settingsToggleThumb" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="cluster">
                  <div className="clusterHeader">
                    <div>
                      <h3>Firecrawl</h3>
                    </div>
                    {firecrawlConfigured ? (
                      <span className="settingsSectionHeaderChip">{text(locale, '密钥已配置', 'Key configured')}</span>
                    ) : (
                      <span className="settingsSectionHeaderChip">{text(locale, '缺少密钥', 'Missing key')}</span>
                    )}
                  </div>
                  <div className="clusterBody">
                    <div className="compactOption">
                      <div>
                        <strong>{text(locale, '遇到动态页面时使用', 'Use on dynamic pages')}</strong>
                        <p>{text(locale, '通过专用 API 读取渲染后的内容。', 'Read rendered content via dedicated API.')}</p>
                      </div>
                      <label className={`settingsToggleTrack mini ${firecrawlEnabled ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={firecrawlEnabled}
                          onChange={(event) => void handleFirecrawlToggle(event.target.checked)}
                        />
                        <span className="settingsToggleThumb" />
                      </label>
                    </div>
                    <div className="clusterActionRow">
                      <button
                        className="settingsPageHeaderAction ghost"
                        type="button"
                        onClick={() => {
                          setConfig((current) => ({ ...current, webProviderKeySource: 'config' }));
                          setFirecrawlDialogOpen(true);
                        }}
                      >
                        {firecrawlConfigured ? text(locale, '管理密钥', 'Manage key') : text(locale, '填写密钥', 'Enter key')}
                      </button>
                      <button
                        className="settingsPageHeaderAction ghost"
                        type="button"
                        onClick={() => void refreshMcpStatus('light')}
                      >
                        {text(locale, '测试连接', 'Test connection')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// 抑制未使用类型告警（保留以便后续 P2.3 接线）
export type { RecommendedMcp, RecommendedSkill, ApiKeyState, ProviderEntry };
