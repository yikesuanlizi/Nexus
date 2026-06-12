import type { Locale } from '../config.js';
import type { AgentStageRow } from '../types.js';
import { AgentStagePanel } from './AgentStagePanel.js';
import { WorkspaceFilesPanel } from './WorkspaceFilesPanel.js';

export type RightPaneTab = 'status' | 'files';

export function RightPane({
  activeTab,
  agentStageRows,
  locale,
  workspaceRoot,
  onTabChange,
}: {
  activeTab: RightPaneTab;
  agentStageRows: AgentStageRow[];
  locale: Locale;
  workspaceRoot: string;
  onTabChange(tab: RightPaneTab): void;
}) {
  return (
    <aside className="eventPane">
      <div className="rightPaneTabs" role="tablist" aria-label={locale === 'zh' ? '右侧面板' : 'Right panel'}>
        <button className={activeTab === 'status' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'status'} onClick={() => onTabChange('status')}>
          {locale === 'zh' ? '状态' : 'Status'}
        </button>
        <button className={activeTab === 'files' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'files'} onClick={() => onTabChange('files')}>
          {locale === 'zh' ? '文件' : 'Files'}
        </button>
      </div>
      {activeTab === 'status'
        ? <AgentStagePanel locale={locale} rows={agentStageRows} />
        : <WorkspaceFilesPanel locale={locale} workspaceRoot={workspaceRoot} />}
    </aside>
  );
}
