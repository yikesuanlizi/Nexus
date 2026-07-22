// 设置面板：监控页（系统监控开关与三级限流策略说明）
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
      <div className="settingsInfoBlock">
        <p className="muted"><strong>{locale === 'zh' ? '三级限流策略' : 'Three-tier throttling'}</strong></p>
        <ul className="muted">
          <li><strong>{locale === 'zh' ? '轻度 (CPU > 85% 或 内存 > 82%)' : 'Light (CPU > 85% or mem > 82%)'}</strong>：{locale === 'zh' ? '并发批次限制为 ≤ 2，禁止新建子 agent' : 'parallel batches ≤ 2, no new sub-agents'}</li>
          <li><strong>{locale === 'zh' ? '中度 (CPU > 92% 或 内存 > 90%)' : 'Moderate (CPU > 92% or mem > 90%)'}</strong>：{locale === 'zh' ? '完全串行执行，禁止新建子 agent' : 'fully serial execution, no new sub-agents'}</li>
          <li><strong>{locale === 'zh' ? '重度 (CPU > 97% 或 内存 > 95% 或 磁盘 < 500MB)' : 'Severe (CPU > 97% or mem > 95% or disk < 500MB)'}</strong>：{locale === 'zh' ? '仅允许只读工具，完全串行，禁止新建子 agent' : 'readonly tools only, fully serial, no new sub-agents'}</li>
        </ul>
        <p className="muted">{locale === 'zh' ? '⚠ 开启后下次 agent 调用时生效。阈值与采样间隔可在配置文件中自定义。' : '⚠ Takes effect on the next agent call. Thresholds and sample interval can be customized in config.'}</p>
      </div>
    </section>
  );
}
