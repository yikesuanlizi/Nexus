export type PermissionPresetId = 'read_only' | 'workspace' | 'danger_full_access';
export type Locale = 'zh' | 'en';
export type WebSearchMode = 'auto' | 'on' | 'off';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ThemeMode = 'dark' | 'light' | 'system';

export interface RunConfig {
  workspaceRoot: string;
  provider: string;
  model: string;
  baseUrl: string;
  permissions: PermissionPresetId;
  dataDir: string;
  skillsRoot: string;
  webSearchMode: WebSearchMode;
  reasoningEffort: ReasoningEffort;
  themeMode: ThemeMode;
  locale: Locale;
}

export const RUN_CONFIG_STORAGE_KEY = 'nexus.config';

const USER_FIELDS: Array<keyof RunConfig> = [
  'provider',
  'model',
  'baseUrl',
  'permissions',
  'locale',
  'workspaceRoot',
  'dataDir',
  'skillsRoot',
  'webSearchMode',
  'reasoningEffort',
  'themeMode',
];

export function mergeRunConfigDefaults(
  serverDefaults: Partial<RunConfig> | undefined,
  current: RunConfig,
): RunConfig {
  const merged = { ...current, ...serverDefaults };
  for (const key of USER_FIELDS) {
    const value = current[key];
    if (value !== '' && value !== undefined) {
      (merged as Record<keyof RunConfig, string>)[key] = value;
    }
  }
  return merged;
}
