import type { Locale } from '../../config/config.js';
import { Icon } from '../Icon.js';

export type WorkbenchTab = 'activity' | 'agents' | 'files' | 'terminal';

export function WorkbenchTabs({
  activeTab,
  onTabChange,
  runningAgentCount,
  locale,
}: {
  activeTab: WorkbenchTab;
  onTabChange(tab: WorkbenchTab): void;
  runningAgentCount: number;
  locale: Locale;
}) {
  const zh = locale === 'zh';
  const tabs: Array<{ id: WorkbenchTab; icon: React.ComponentProps<typeof Icon>['name']; label: string; badge?: number }> = [
    { id: 'activity', icon: 'pulse', label: zh ? '活动' : 'Activity' },
    { id: 'agents', icon: 'agentGroup', label: zh ? '智能体' : 'Agents', badge: runningAgentCount > 0 ? runningAgentCount : undefined },
    { id: 'files', icon: 'folderOpen', label: zh ? '文件' : 'Files' },
    { id: 'terminal', icon: 'terminal', label: zh ? '终端' : 'Terminal' },
  ];

  return (
    <div className="workbenchTabs" role="tablist" aria-label={zh ? '工作台' : 'Workbench'}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className={activeTab === tab.id ? 'active' : ''}
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
          {tab.badge != null ? <span className="workbenchTabBadge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
