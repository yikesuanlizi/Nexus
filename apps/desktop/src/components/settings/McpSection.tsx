// 设置面板：MCP 配置列表（独立 McpSection 复用组件）
import type { Locale } from '../../config/config.js';
import type { McpConfig, McpServerStatus } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { mcpCardVisual, mcpStatusText } from './shared.js';

export interface McpSectionProps {
  addLabel: string;
  hideHeader?: boolean;
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
}

export function McpSection({
  addLabel,
  hideHeader = false,
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
}: McpSectionProps) {
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  return (
    <section className="settingsSection" id={id}>
      {!hideHeader ? (
        <div className="section-header">
          <div>
            <h2 className="section-title">{title}</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={onRefresh}>{t(locale, 'refresh')}</button>
            <button className="btn btn-primary" onClick={onAdd}>{addLabel}</button>
          </div>
        </div>
      ) : null}
      <div className="cards">
        {items.map((item) => {
          const status = statusById.get(item.id);
          const statusText = mcpStatusText(status, item.enabled, locale);
          const commandLine = item.args.trim() ? `${item.command} ${item.args}` : item.command;
          const visual = mcpCardVisual(item.name);

          let statusClass = 'offline';
          if (statusText.tone === 'ok') statusClass = 'online';
          if (statusText.tone === 'warn') statusClass = 'warning';
          if (statusText.tone === 'danger') statusClass = 'error';

          const isOnline = statusClass === 'online';

          return (
            <div className="card" key={item.id} onClick={() => onEdit(item)}>
              <div className="card-head">
                <div className="icon" style={{ background: visual.bg }}>
                  <Icon name={visual.icon} />
                </div>
                <div className="card-info">
                  <div className="card-title">
                    {item.name}
                    <span className={`status-dot ${statusClass}`} title={statusText.label + (status?.error ? `: ${status.error}` : '')}></span>
                  </div>
                  <div className="card-desc" title={commandLine}>{commandLine}</div>
                </div>
              </div>
              <div className="card-foot" onClick={(e) => e.stopPropagation()}>
                <div className="card-meta">
                  <span className="tag">Local</span>
                  {isOnline ? `${status?.toolCount ?? 0} ${locale === 'zh' ? '个工具' : 'tools'}` : statusText.label}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn btn-danger"
                    title={t(locale, 'remove')}
                    aria-label={t(locale, 'remove')}
                    onClick={() => onDelete(item.id)}
                    type="button"
                  >
                    <Icon name="trash" />
                  </button>
                  <div
                    className={`mcpToggle toggle ${item.enabled ? 'on' : ''}`}
                    onClick={() => onToggleEnabled(item.id)}
                    title={item.enabled ? t(locale, 'enabled') : 'Off'}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
