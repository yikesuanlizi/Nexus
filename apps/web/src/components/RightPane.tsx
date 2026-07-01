// 右侧面板：切换 Agent 状态与工作区文件列表
// Right pane: switches between Agent status and workspace file list

import type { Locale } from '../config/config.js';
import type { AgentStageRow, ThreadMeta } from '../shared/types.js';
import { AgentStagePanel } from './AgentStagePanel.js';
import { WorkspaceFilesPanel } from './WorkspaceFilesPanel.js';

export type RightPaneTab = 'status' | 'files';
// 右侧面板的 Tab 选项：Agent 状态或文件列表
// Right pane tab options: Agent status or file list

export function RightPane({
  activeTab,
  agentStageRows,
  activeThread,
  locale,
  workspaceRoot,
  onTabChange,
  onToggleMemoryExcluded,
}: {
  activeTab: RightPaneTab;
  agentStageRows: AgentStageRow[];
  activeThread?: ThreadMeta | null;
  locale: Locale;
  workspaceRoot: string;
  onTabChange(tab: RightPaneTab): void;
  onToggleMemoryExcluded?(excluded: boolean): void;
}) {
  const memoryExcluded = activeThread?.tags?.memoryExcluded === 'true';
  // 线程级"不提取记忆"开关
  // Per-thread "exclude from memory extraction" toggle

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
        ? (
          <>
            <AgentStagePanel locale={locale} rows={agentStageRows} />
            {activeThread && onToggleMemoryExcluded ? (
              <div className="rightPaneMemoryControl">
                <label className="toggle">
                  <input
                    checked={memoryExcluded}
                    onChange={(event) => onToggleMemoryExcluded(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{locale === 'zh' ? '此线程不生成记忆' : 'Exclude this thread from memory extraction'}</span>
                </label>
              </div>
            ) : null}
          </>
        )
        : <WorkspaceFilesPanel locale={locale} workspaceRoot={workspaceRoot} />}
    </aside>
  );
}
