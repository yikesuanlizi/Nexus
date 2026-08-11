import { useState, type ComponentProps } from 'react';
import type { Locale } from '../../config/config.js';
import { Icon } from '../Icon.js';

export type PrimaryWorkbenchTab = 'activity' | 'agents';
export type UtilityWorkbenchTab = 'files' | 'browser';
export type WorkbenchTab = PrimaryWorkbenchTab | UtilityWorkbenchTab;

export function WorkbenchTabs({
  activeTab,
  onTabChange,
  openUtilityTabs,
  onOpenUtilityTab,
  onCloseUtilityTab,
  runningAgentCount,
  locale,
}: {
  activeTab: WorkbenchTab;
  onTabChange(tab: WorkbenchTab): void;
  openUtilityTabs: UtilityWorkbenchTab[];
  onOpenUtilityTab(tab: UtilityWorkbenchTab): void;
  onCloseUtilityTab(tab: UtilityWorkbenchTab): void;
  runningAgentCount: number;
  locale: Locale;
}) {
  const zh = locale === 'zh';
  const [utilityOpen, setUtilityOpen] = useState(false);
  const tabs: Array<{ id: PrimaryWorkbenchTab; icon: ComponentProps<typeof Icon>['name']; label: string; badge?: number }> = [
    { id: 'activity', icon: 'activity', label: zh ? '活动' : 'Activity' },
    { id: 'agents', icon: 'puppet', label: zh ? '智能体' : 'Agents', badge: runningAgentCount > 0 ? runningAgentCount : undefined },
  ];
  const utilityTabs: Array<{ id: UtilityWorkbenchTab; icon: ComponentProps<typeof Icon>['name']; label: string }> = [
    { id: 'browser', icon: 'browser', label: zh ? '浏览器' : 'Browser' },
    { id: 'files', icon: 'folder', label: zh ? '文件' : 'Files' },
  ];

  const selectUtilityTab = (tab: UtilityWorkbenchTab): void => {
    setUtilityOpen(false);
    onOpenUtilityTab(tab);
  };

  return (
    <div className="workbenchTabs" role="tablist" aria-label={zh ? '工作台' : 'Workbench'}>
      <div className="workbenchPrimaryTabs">
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
      <div className="workbenchUtilityTabs">
        {openUtilityTabs.map((tabId) => {
          const tab = utilityTabs.find((item) => item.id === tabId);
          if (!tab) return null;
          return (
            <div className={`workbenchDynamicTab${activeTab === tab.id ? ' active' : ''}`} key={tab.id}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </button>
              <button
                type="button"
                className="workbenchDynamicTabClose"
                aria-label={zh ? `关闭${tab.label}` : `Close ${tab.label}`}
                title={zh ? '关闭' : 'Close'}
                onClick={() => onCloseUtilityTab(tab.id)}
              >
                <Icon name="x" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={utilityOpen || utilityTabs.some((tab) => tab.id === activeTab) ? 'active' : ''}
          aria-label={zh ? '打开浏览器或文件' : 'Open browser or files'}
          aria-expanded={utilityOpen}
          title={zh ? '浏览器与文件' : 'Browser and files'}
          onClick={() => setUtilityOpen((open) => !open)}
        >
          <Icon name="plus" />
        </button>
        {utilityOpen ? (
          <div className="workbenchUtilityMenu" role="menu">
            {utilityTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="menuitem"
                onClick={() => selectUtilityTab(tab.id)}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
