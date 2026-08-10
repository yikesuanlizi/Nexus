// 设置面板：记忆页（长期/情景记忆开关与参数、记忆列表管理）
import React, { useState } from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import type { MemoryRecord } from '../../shared/types.js';
import { Icon } from '../Icon.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';

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

export function MemoryPage({
  locale,
  config,
  memoryRecords,
  memoryNotice,
  saveMemorySettings,
  deleteMemory,
  exportMemories,
}: MemoryPageProps) {
  // 高级面板展开状态仅在本页内使用
  const [memoryAdvancedExpanded, setMemoryAdvancedExpanded] = useState(false);

  return (
    <section className="settingsSection" id="settings-memory">
      <SettingsPageHeader
        eyebrow="CONTEXT"
        title={text(locale, '记忆', 'Memory')}
        actions={[
          {
            label: text(locale, '整理记忆', 'Export audit mirror'),
            onClick: () => void exportMemories(),
          },
        ]}
      />
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
        <ToggleRow
          checked={config.autoExtractMemories}
          disabled={!config.memoryEnabled}
          onChange={(checked) => void saveMemorySettings({ autoExtractMemories: checked })}
          label={locale === 'zh' ? '自动保存长期记忆' : 'Auto extract cold memories'}
          description={locale === 'zh' ? '对话结束后自动提炼有价值的知识点和偏好。' : 'Automatically extract valuable facts and preferences after conversation.'}
        />
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
          <ToggleRow
            checked={config.episodeRerankEnabled}
            disabled={!config.memoryEnabled || !config.episodeMemoryEnabled}
            onChange={(checked) => void saveMemorySettings({ episodeRerankEnabled: checked })}
            label={locale === 'zh' ? '启用重排序' : 'Enable rerank'}
            description={locale === 'zh' ? '对候选情景进行二次排序以提升匹配精度。' : 'Re-rank candidate episodes for better matching accuracy.'}
          />
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
  );
}
