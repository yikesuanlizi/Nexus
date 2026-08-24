import { isTerminalUtilityWorkbenchTab, type UtilityWorkbenchTab, type WorkbenchTab } from './WorkbenchTabs.js';

export const WORKBENCH_STATE_STORAGE_KEY = 'nexus.workbench.state.v1';

export interface PersistedWorkbenchState {
  activeTab: WorkbenchTab;
  openUtilityTabs: UtilityWorkbenchTab[];
}

const DEFAULT_STATE: PersistedWorkbenchState = {
  activeTab: 'activity',
  openUtilityTabs: [],
};

const LEGACY_TERMINAL_TAB: UtilityWorkbenchTab = 'terminal:legacy';

function normalizeUtilityTab(tab: unknown): UtilityWorkbenchTab | null {
  if (tab === 'files' || tab === 'browser') return tab;
  if (tab === 'terminal') return LEGACY_TERMINAL_TAB;
  return typeof tab === 'string' && isTerminalUtilityWorkbenchTab(tab) ? tab : null;
}

export function readStoredWorkbenchState(): PersistedWorkbenchState {
  try {
    const raw = localStorage.getItem(WORKBENCH_STATE_STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem('nexus.rightPane.tab');
      const activeTab = legacy === 'browser' || legacy === 'files' || legacy === 'agents' || legacy === 'activity' || legacy === 'ops'
        ? legacy
        : legacy === 'terminal'
          ? LEGACY_TERMINAL_TAB
        : 'activity';
      return {
        activeTab,
        openUtilityTabs: legacy === 'browser' || legacy === 'files' ? [legacy] : legacy === 'terminal' ? [LEGACY_TERMINAL_TAB] : [],
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkbenchState>;
    const openUtilityTabs = Array.isArray(parsed.openUtilityTabs)
      ? parsed.openUtilityTabs.map(normalizeUtilityTab).filter((tab): tab is UtilityWorkbenchTab => tab !== null)
      : [];
    const utilityActiveTab = normalizeUtilityTab(parsed.activeTab);
    const activeTab: WorkbenchTab = utilityActiveTab
      ?? (parsed.activeTab === 'agents' || parsed.activeTab === 'activity' || parsed.activeTab === 'ops' ? parsed.activeTab : 'activity');
    const normalizedTabs = [...new Set(openUtilityTabs)];
    if (utilityActiveTab && !normalizedTabs.includes(utilityActiveTab)) normalizedTabs.push(utilityActiveTab);
    return { activeTab, openUtilityTabs: normalizedTabs };
  } catch {
    return { ...DEFAULT_STATE, openUtilityTabs: [] };
  }
}

export function writeStoredWorkbenchState(state: PersistedWorkbenchState): void {
  try {
    localStorage.setItem(WORKBENCH_STATE_STORAGE_KEY, JSON.stringify({
      activeTab: state.activeTab,
      openUtilityTabs: [...new Set(state.openUtilityTabs)],
    }));
  } catch {
    // UI state persistence is best effort.
  }
}
