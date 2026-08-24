// 设置面板：记忆页（长期/情景记忆开关与参数、记忆列表管理）
import React, { useState } from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import type { MemoryRecord } from '../../shared/types.js';
import { Icon } from '../Icon.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
import { SectionHeader } from './SectionHeader.js';

export interface MemoryPageProps {
  locale: Locale;
  config: RunConfig;
  memoryRecords: MemoryRecord[];
  memoryNotice: string;
  saveMemorySettings: (patch: Partial<RunConfig>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  exportMemories: () => Promise<void>;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

export function MemoryPage({
  locale,
  config,
  memoryRecords,
  memoryNotice,
  saveMemorySettings,
  deleteMemory,
  exportMemories,
}: MemoryPageProps) {
  const [memoryAdvancedExpanded, setMemoryAdvancedExpanded] = useState(false);

  function ToggleRow({
    checked,
    disabled,
    onChange,
    label,
    description,
  }: {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    description?: string;
  }) {
    return (
      <label className={`settingsToggleRow ${disabled ? 'disabled' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <div className="settingsToggleContent">
          <strong>{label}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        <span className="settingsToggleTrack" aria-hidden="true">
          <span className="settingsToggleThumb" />
        </span>
      </label>
    );
  }

  return (
    <section className="settingsSection" id="settings-memory">
      <SettingsPageHeader
        eyebrow={text(locale, '上下文', 'Context')}
        title={text(locale, '记忆', 'Memory')}
        actions={[
          {
            label: text(locale, '整理记忆', 'Organize memories'),
            title: text(locale, '导出记忆审计镜像', 'Export memory audit mirror'),
            onClick: () => void exportMemories(),
          },
        ]}
      />

      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '自动记忆', 'Auto memory')} />
        <div className="settingsToggleList">
          <ToggleRow
            checked={config.memoryEnabled}
            onChange={(checked) => void saveMemorySettings({ memoryEnabled: checked })}
            label={text(locale, '为此线程生成记忆', 'Generate memory for this thread')}
          />
          <ToggleRow
            checked={config.autoExtractMemories ?? true}
            disabled={!config.memoryEnabled}
            onChange={(checked) => void saveMemorySettings({ autoExtractMemories: checked })}
            label={text(locale, '自动提取事实', 'Auto-extract facts')}
          />
          <ToggleRow
            checked={config.useColdMemories}
            disabled={!config.memoryEnabled}
            onChange={(checked) => void saveMemorySettings({ useColdMemories: checked })}
            label={text(locale, '允许引用相关历史', 'Allow referencing related history')}
            description={text(locale, '生成回答时检索相关旧记忆', 'Retrieve relevant past memories when generating')}
          />
        </div>
      </div>

      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '记忆参数', 'Memory parameters')} />
        <div className="settingsFormGrid three">
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '最多参考条数', 'Inject limit')}</span>
            <input
              min={1}
              max={20}
              type="number"
              value={config.memoryInjectLimit}
              onChange={(event) => void saveMemorySettings({ memoryInjectLimit: Number(event.target.value) })}
            />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, 'Token 上限', 'Token budget')}</span>
            <input
              min={200}
              max={4000}
              step={100}
              type="number"
              value={config.memoryTokenBudget}
              onChange={(event) => void saveMemorySettings({ memoryTokenBudget: Number(event.target.value) })}
            />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '情景记忆', 'Episode memory')}</span>
            <span className={`settingsInlineToggle ${config.episodeMemoryEnabled ? 'on' : ''} ${!config.memoryEnabled ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={config.episodeMemoryEnabled}
                disabled={!config.memoryEnabled}
                onChange={(event) => void saveMemorySettings({ episodeMemoryEnabled: event.target.checked })}
              />
              <span className="settingsInlineToggleTrack" aria-hidden="true">
                <span className="settingsInlineToggleThumb" />
              </span>
            </span>
          </label>
        </div>

        <button
          className={`memoryAdvancedToggle ${memoryAdvancedExpanded ? 'expanded' : ''}`}
          type="button"
          onClick={() => setMemoryAdvancedExpanded((v) => !v)}
        >
          <Icon name="chevronDown" />
          {text(locale, '高级设置', 'Advanced settings')}
        </button>
        <div className={`memoryAdvancedPanel ${memoryAdvancedExpanded ? 'expanded' : ''}`}>
          <div className="settingsFormGrid three">
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '最多参考情景数', 'Episode inject limit')}</span>
              <input
                min={0}
                max={10}
                type="number"
                disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                value={config.episodeInjectLimit}
                onChange={(event) => void saveMemorySettings({ episodeInjectLimit: Number(event.target.value) })}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '情景 Token 上限', 'Episode token budget')}</span>
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
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '温记忆保存天数', 'Cold after days')}</span>
              <input
                min={1}
                max={365}
                type="number"
                disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                value={config.episodeColdAfterDays}
                onChange={(event) => void saveMemorySettings({ episodeColdAfterDays: Number(event.target.value) })}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '切换冷却回合数', 'Switch cooldown')}</span>
              <input
                min={0}
                max={20}
                type="number"
                disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                value={config.episodeSwitchCooldownTurns}
                onChange={(event) => void saveMemorySettings({ episodeSwitchCooldownTurns: Number(event.target.value) })}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '空闲封存分钟数', 'Seal idle minutes')}</span>
              <input
                min={1}
                max={1440}
                type="number"
                disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
                value={config.episodeSealIdleMinutes}
                onChange={(event) => void saveMemorySettings({ episodeSealIdleMinutes: Number(event.target.value) })}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{text(locale, '搜索候选数量', 'FTS candidates')}</span>
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
          <div className="settingsToggleList" style={{ marginTop: '14px' }}>
            <ToggleRow
              checked={config.episodeRerankEnabled ?? false}
              disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
              onChange={(checked) => void saveMemorySettings({ episodeRerankEnabled: checked })}
              label={text(locale, '候选重排序', 'Re-rank candidates')}
            />
          </div>
        </div>
      </div>

      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '最近记忆', 'Recent memories')} />
        {memoryNotice ? <p className="settingsNotice">{memoryNotice}</p> : null}
        {memoryRecords.length === 0 ? (
          <p className="accessPolicyEmpty">{text(locale, '暂无长期记忆。', 'No cold memories yet.')}</p>
        ) : (
          <div className="memoryRecordList">
            {memoryRecords.map((record) => (
              <article className="memoryRecordCard" key={record.id}>
                <div className="memoryRecordInfo">
                  <strong>{record.type}</strong>
                  <span>{record.text}</span>
                </div>
                <div className="memoryRecordActions">
                  <span className="settingsSectionHeaderChip">{text(locale, '使用', 'used')} {record.usageCount}</span>
                  <button className="textButton danger" type="button" onClick={() => void deleteMemory(record.id)}>
                    {text(locale, '删除', 'Delete')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
