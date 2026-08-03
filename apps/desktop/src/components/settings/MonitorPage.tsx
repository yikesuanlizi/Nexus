// 设置面板：性能页（系统监控限流开关）
import type React from 'react';
import type { Locale, RunConfig } from '../../config/config.js';

export interface MonitorPageProps {
  locale: Locale;
  config: RunConfig;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  markDirty: (field: string, dirty: boolean) => void;
  // P2.2 dirty 跟踪
  dirtyFields: Record<string, boolean>;
}

export function MonitorPage({ locale, config, setConfig, markDirty, dirtyFields }: MonitorPageProps) {
  const monitorDirty = dirtyFields.systemMonitorEnabled ? 'fieldDirty' : '';

  return (
    <section className="settingsSection" id="settings-performance">
      <h3>{locale === 'zh' ? '性能' : 'Performance'}</h3>
      <div className="formGrid modelSettingsList">
        <label className={`toggle ${monitorDirty}`}>
          <input
            type="checkbox"
            checked={config.systemMonitorEnabled === true}
            onChange={(event) => {
              setConfig((current) => ({ ...current, systemMonitorEnabled: event.target.checked }));
              markDirty('systemMonitorEnabled', true);
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
    </section>
  );
}
