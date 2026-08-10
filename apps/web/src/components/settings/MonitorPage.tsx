// 设置面板：监控页（系统监控限流开关与运行控制）
import React from 'react';
import type { Locale, RunConfig } from '../../config/config.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
import { SectionHeader } from './SectionHeader.js';

export interface MonitorPageProps {
  locale: Locale;
  config: RunConfig;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  markDirty: (field: string, dirty: boolean) => void;
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
  function updateConfigField<K extends keyof RunConfig>(field: K, value: RunConfig[K]) {
    setConfig((current) => ({ ...current, [field]: value }));
    markDirty(String(field), true);
  }

  return (
    <section className="settingsSection" id="settings-monitor">
      <SettingsPageHeader
        eyebrow="RUNTIME"
        title={text(locale, '监控', 'Monitor')}
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
              value={config.maxConcurrency ?? 4}
              onChange={(event) => updateConfigField('maxConcurrency', Number(event.target.value))}
            />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{text(locale, '单次工具超时', 'Tool timeout')}</span>
            <div className="settingsInputWithSuffix">
              <input
                type="number"
                min={10}
                max={600}
                value={config.toolTimeoutSeconds ?? 120}
                onChange={(event) => updateConfigField('toolTimeoutSeconds', Number(event.target.value))}
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
                value={config.memoryThresholdPercent ?? 85}
                onChange={(event) => updateConfigField('memoryThresholdPercent', Number(event.target.value))}
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
            onChange={(checked) => updateConfigField('systemMonitorEnabled', checked)}
            label={text(locale, '启用系统监控跟踪', 'Enable system monitor tracking')}
          />
          <ToggleRow
            checked={config.throttleNewTasks ?? true}
            disabled={!config.systemMonitorEnabled}
            onChange={(checked) => updateConfigField('throttleNewTasks', checked)}
            label={text(locale, '达到阈值后暂停新子任务', 'Pause new subtasks after threshold')}
          />
        </div>
      </div>
    </section>
  );
}
