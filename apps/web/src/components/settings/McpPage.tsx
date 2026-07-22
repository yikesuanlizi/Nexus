// 设置面板：MCP 配置页（在 ToolsPage 内作为「MCP」tab 内容）
import type { Locale } from '../../config/config.js';
import type { McpConfig, McpServerStatus } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { McpSection } from './McpSection.js';

export interface McpPageProps {
  locale: Locale;
  items: McpConfig[];
  statuses: McpServerStatus[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: McpConfig) => void;
  onRefresh: () => void;
  onToggleEnabled: (id: string) => void;
  hideHeader?: boolean;
}

// 包装 McpSection：作为独立 page 供 ToolsPage 内部嵌入
export function McpPage({
  locale,
  items,
  statuses,
  onAdd,
  onDelete,
  onEdit,
  onRefresh,
  onToggleEnabled,
  hideHeader = false,
}: McpPageProps) {
  return (
    <McpSection
      addLabel={t(locale, 'addMcp')}
      hideHeader={hideHeader}
      id="settings-mcp"
      items={items}
      locale={locale}
      statuses={statuses}
      onDelete={onDelete}
      onEdit={onEdit}
      onToggleEnabled={onToggleEnabled}
      onAdd={onAdd}
      onRefresh={onRefresh}
      title={t(locale, 'mcp')}
    />
  );
}
