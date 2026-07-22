// 设置面板：工具/插件中心页（recommended / mcp / skills / web 四个 tab）
import React, { useState } from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import type { ApiKeyState, McpConfig, McpServerStatus, ProviderEntry, SkillEntry, WebProviderPublicConfig } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { recommendedPluginCatalog, type RecommendedMcp, type RecommendedSkill } from '../../features/settings/pluginCatalog.js';
import { localizedSkillDescription } from '../../features/settings/skillDescriptions.js';
import { McpSection } from './McpSection.js';
import { pluginNavIcon, recommendedCardVisual, skillCardVisual, webToolCardVisual } from './shared.js';

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
  dirtyFields,
}: ToolsPageProps) {
  // 插件中心内部 tab 与搜索状态
  const [activePluginTab, setActivePluginTab] = useState<'recommended' | 'mcp' | 'skills' | 'web'>('recommended');
  const [pluginSearch, setPluginSearch] = useState('');

  const firecrawlMasked = webProviderState?.firecrawl.masked ?? '';
  const firecrawlHasPreview = /[.•·]/.test(firecrawlMasked);
  const firecrawlConfigured = Boolean(webProviderState?.firecrawl.configured && firecrawlHasPreview);
  const firecrawlEnabled = config.webProvider === 'firecrawl';

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
    },
    {
      id: 'mcp' as const,
      label: 'MCP',
      count: filteredMcps.length,
      total: mcps.length,
    },
    {
      id: 'skills' as const,
      label: t(locale, 'skills'),
      count: filteredSkills.length,
      total: skillsList.length,
    },
    {
      id: 'web' as const,
      label: locale === 'zh' ? '联网工具' : 'Web tools',
      count: webTools.length,
      total: 2,
    },
  ];
  const activePluginNav = pluginNavItems.find((item) => item.id === activePluginTab) ?? pluginNavItems[0];

  const skillsRootDirty = dirtyFields.skillsRoot ? 'fieldDirty' : '';

  return (
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
        <aside className="sidebar pluginTabs">
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
                  <label className={`pluginField ${skillsRootDirty}`}>
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
  );
}

// 抑制未使用类型告警（保留以便后续 P2.3 接线）
export type { RecommendedMcp, RecommendedSkill, ApiKeyState, ProviderEntry };
