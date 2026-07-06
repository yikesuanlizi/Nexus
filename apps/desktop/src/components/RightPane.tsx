import type { Locale } from '../config/config.js';
import type { AgentStageRow, ThreadMeta } from '../shared/types.js';
import { AgentStagePanel } from './AgentStagePanel.js';
import { WorkspaceFilesPanel, type ExternalPreviewRequest } from './WorkspaceFilesPanel.js';
import { Icon } from './Icon.js';

export type RightPaneTab = 'status' | 'files';

export function RightPane({
  activeTab,
  agentStageRows,
  activeThread,
  locale,
  workspaceRoot,
  onTabChange,
  onToggleMemoryExcluded,
  externalPreviewRequest,
}: {
  activeTab: RightPaneTab;
  agentStageRows: AgentStageRow[];
  activeThread?: ThreadMeta | null;
  locale: Locale;
  workspaceRoot: string;
  onTabChange(tab: RightPaneTab): void;
  onToggleMemoryExcluded?(excluded: boolean): void;
  /** 外部预览请求 — 从对话条目点击"预览"时传入，自动切换到 files Tab 并加载该文件 */
  // — Chinese: external preview request — auto-switches to files tab and loads the file
  externalPreviewRequest?: ExternalPreviewRequest | null;
}) {
  const memoryExcluded = activeThread?.tags?.memoryExcluded === 'true';
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
                  <span className="settingRow">
                    <span className="settingLabel">
                      {locale === 'zh' ? '此线程不生成记忆' : 'Exclude this thread from memory extraction'}
                      <span className="settingHelpIcon">
                        <Icon name="question" />
                      </span>
                    </span>
                    <span className="settingTooltip">
                      <strong>{locale === 'zh' ? '此线程不生成记忆' : 'Exclude this thread from memory extraction'}</strong>
                      {locale === 'zh'
                        ? '开启后，这个对话的内容不会被提取到长期记忆库里，对话时也不会参考旧记忆。但上下文太长时仍会自动压缩摘要（为了省 token）。'
                        : 'When enabled, this conversation won\'t be saved to long-term memory, and past memories won\'t be referenced. Auto-compaction still works to save tokens.'}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
          </>
        )
        : <WorkspaceFilesPanel locale={locale} workspaceRoot={workspaceRoot} externalPreviewRequest={externalPreviewRequest} />}
    </aside>
  );
}
