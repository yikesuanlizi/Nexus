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

function text(locale: Locale, zh: string, en: string): string { return locale === 'zh' ? zh : en; }

function ToggleRow({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className={`settingsToggleRow ${disabled ? 'disabled' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    <div className="settingsToggleContent"><strong>{label}</strong></div>
    <span className={`settingsToggleTrack${checked ? ' on' : ''}`} aria-hidden="true"><span className="settingsToggleThumb" /></span>
  </label>;
}

const thresholdLabels = {
  cpuLight: ['CPU 提醒', 'CPU notice'],
  cpuModerate: ['CPU 限制', 'CPU limit'],
  cpuSevere: ['CPU 严重', 'CPU severe'],
  memLight: ['内存提醒', 'Memory notice'],
  memModerate: ['内存限制', 'Memory limit'],
  memSevere: ['内存严重', 'Memory severe'],
} as const;

export function MonitorPage({ locale, config, setConfig, markDirty, onSave }: MonitorPageProps) {
  function update<K extends keyof RunConfig>(field: K, value: RunConfig[K]) { setConfig((current) => ({ ...current, [field]: value })); markDirty(String(field), true); }
  return <section className="settingsSection" id="settings-monitor">
    <SettingsPageHeader eyebrow={text(locale, '运行时', 'Runtime')} title={text(locale, '监控', 'Monitor')} />
    <div className="settingsSectionBlock"><SectionHeader title={text(locale, '监控策略', 'Monitoring policy')} /><div className="settingsToggleList">
      <ToggleRow checked={config.monitorPanelVisible !== false} onChange={(value) => update('monitorPanelVisible', value)} label={text(locale, '监控面板显示', 'Monitor panel')} />
      <ToggleRow checked={config.systemMonitorSamplingEnabled === true} onChange={(value) => update('systemMonitorSamplingEnabled', value)} label={text(locale, '系统性能采样', 'System performance sampling')} />
      <ToggleRow checked={config.systemMonitorLogRecordingEnabled === true} onChange={(value) => update('systemMonitorLogRecordingEnabled', value)} label={text(locale, '运行日志记录', 'Runtime log recording')} />
      <ToggleRow checked={config.systemMonitorGuardEnabled === true} disabled={!config.systemMonitorSamplingEnabled} onChange={(value) => update('systemMonitorGuardEnabled', value)} label={text(locale, '性能阈值保护', 'Performance threshold guard')} />
    </div></div>
    <div className="settingsSectionBlock"><SectionHeader title={text(locale, '阈值', 'Thresholds')} /><div className="settingsFormGrid three">
      {(['cpuLight', 'cpuModerate', 'cpuSevere', 'memLight', 'memModerate', 'memSevere'] as const).map((field) => <label className="settingsField" key={field}><span className="settingsFieldLabel">{text(locale, thresholdLabels[field][0], thresholdLabels[field][1])}</span><div className="settingsInputWithSuffix"><input type="number" min={1} max={100} value={config.systemMonitorThresholds[field]} onChange={(e) => update('systemMonitorThresholds', { ...config.systemMonitorThresholds, [field]: Number(e.target.value) })} /><span className="settingsInputSuffix">%</span></div></label>)}
    </div><div className="settingsThresholdActions"><button type="button" className="solidButton settingsThresholdSave" onClick={() => onSave?.()}>{text(locale, '保存监控设置', 'Save monitor settings')}</button></div></div>
  </section>;
}
