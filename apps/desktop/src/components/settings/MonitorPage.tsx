// 设置面板：性能页（系统监控限流开关与运行控制）
import React from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
import { SectionHeader } from './SectionHeader.js';

export interface MonitorPageProps {
  locale: Locale;
  config: RunConfig;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  markDirty: (field: string, dirty: boolean) => void;
  // P2.2 dirty 跟踪
  dirtyFields: Record<string, boolean>;
  onSave?: () => void;
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

export function MonitorPage({ locale, config, setConfig, markDirty, onSave }: MonitorPageProps) {
  function updateField<K extends keyof RunConfig>(field: K, value: RunConfig[K]) {
    setConfig((current) => ({ ...current, [field]: value }));
    markDirty(field as string, true);
  }

  function updateSystemMonitorEnabled(enabled: boolean) {
    updateField('systemMonitorEnabled', enabled);
  }

  return (
    <section className="settingsSection" id="settings-monitor">
      <SettingsPageHeader
        eyebrow="RUNTIME"
        title={text(locale, '监控', 'Monitor')}
        description={text(locale, '本地运行的并发、资源保护和详细监控策略。', 'Local concurrency, resource protection and detailed monitoring policies.')}
        actions={[
          {
            label: text(locale, '保存监控设置', 'Save monitor'),
            primary: true,
            onClick: () => onSave?.(),
          },
        ]}
      />

      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '运行控制', 'Runtime control')} />
        <div className="settingsFormGrid three">
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '最大并发', 'Max concurrency')}</span>
            <input
              type="number"
              min={1}
              max={32}
              value={config.maxConcurrency}
              onChange={(event) => updateField('maxConcurrency', Number(event.target.value))}
            />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '单次工具超时', 'Tool timeout')}</span>
            <div className="settingsInputWithSuffix">
              <input
                type="number"
                min={10}
                max={600}
                value={config.toolTimeoutSeconds}
                onChange={(event) => updateField('toolTimeoutSeconds', Number(event.target.value))}
              />
              <span className="settingsInputSuffix">s</span>
            </div>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '内存阈值', 'Memory threshold')}</span>
            <div className="settingsInputWithSuffix">
              <input
                type="number"
                min={10}
                max={100}
                value={config.memoryThresholdPercent}
                onChange={(event) => updateField('memoryThresholdPercent', Number(event.target.value))}
              />
              <span className="settingsInputSuffix">%</span>
            </div>
          </label>
        </div>
      </div>

      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '资源保护', 'Resource guard')} />
        <div className="settingsToggleList">
          <ToggleRow
            checked={config.systemMonitorEnabled === true}
            onChange={updateSystemMonitorEnabled}
            label={text(locale, '启用系统监控跟踪', 'Enable system monitor tracking')}
            description={text(locale, '收集执行时的 CPU、内存和缓存指标。', 'Collect CPU, memory and cache metrics during runs.')}
          />
          <ToggleRow
            checked={config.throttleNewTasks}
            disabled={!config.systemMonitorEnabled}
            onChange={(checked) => updateField('throttleNewTasks', checked)}
            label={text(locale, '达到阈值后暂停新子任务', 'Pause new subtasks after threshold')}
            description={text(locale, '已运行任务继续完成，直到资源恢复。', 'Running tasks continue until resources recover.')}
          />
        </div>
      </div>
    </section>
  );
}
