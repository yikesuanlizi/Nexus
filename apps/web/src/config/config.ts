export type PermissionPresetId = 'read_only' | 'workspace' | 'danger_full_access';
export type Locale = 'zh' | 'en';
export type WebSearchMode = 'auto' | 'on' | 'off';
export type WebProviderMode = 'native_fetch' | 'firecrawl';
export type SecretSource = 'config' | 'env';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ThemeMode = 'dark' | 'light' | 'system';
export type RunProfile = 'cache_first' | 'runtime_os';
export type UserAvatarId = 'asteroid' | 'rocket' | 'owl' | 'crystal' | 'paper-plane' | 'fox' | 'lightning' | 'mushroom' | 'custom';

export interface RunConfig {
  workspaceRoot: string;
  provider: string;
  model: string;
  baseUrl: string;
  permissions: PermissionPresetId;
  dataDir: string;
  skillsRoot: string;
  webSearchMode: WebSearchMode;
  webProvider: WebProviderMode;
  webProviderKeySource: SecretSource;
  reasoningEffort: ReasoningEffort;
  runProfile: RunProfile;
  memoryEnabled: boolean;
  autoExtractMemories: boolean;
  useColdMemories: boolean;
  memoryInjectLimit: number;
  memoryTokenBudget: number;
  episodeMemoryEnabled: boolean;
  episodeInjectLimit: number;
  episodeTokenBudget: number;
  episodeSwitchCooldownTurns: number;
  episodeSealIdleMinutes: number;
  episodeColdAfterDays: number;
  episodeFtsCandidateLimit: number;
  episodeRerankEnabled: boolean;
  themeMode: ThemeMode;
  userAvatarId: UserAvatarId;
  customUserAvatarDataUrl: string;
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
  'webProvider',
  'webProviderKeySource',
  'reasoningEffort',
  'runProfile',
  'memoryEnabled',
  'autoExtractMemories',
  'useColdMemories',
  'memoryInjectLimit',
  'memoryTokenBudget',
  'episodeMemoryEnabled',
  'episodeInjectLimit',
  'episodeTokenBudget',
  'episodeSwitchCooldownTurns',
  'episodeSealIdleMinutes',
  'episodeColdAfterDays',
  'episodeFtsCandidateLimit',
  'episodeRerankEnabled',
  'themeMode',
  'userAvatarId',
  'customUserAvatarDataUrl',
];

export function mergeRunConfigDefaults(
  serverDefaults: Partial<RunConfig> | undefined,
  current: Partial<RunConfig>,
): RunConfig {
  const merged = {
    memoryEnabled: true,
    autoExtractMemories: true,
    useColdMemories: true,
    memoryInjectLimit: 6,
    memoryTokenBudget: 1200,
    episodeMemoryEnabled: true,
    episodeInjectLimit: 2,
    episodeTokenBudget: 800,
    episodeSwitchCooldownTurns: 2,
    episodeSealIdleMinutes: 20,
    episodeColdAfterDays: 7,
    episodeFtsCandidateLimit: 40,
    episodeRerankEnabled: false,
    ...current,
    ...serverDefaults,
  } as RunConfig;
  for (const key of USER_FIELDS) {
    const value = current[key];
    if (value !== '' && value !== undefined) {
      (merged as Record<keyof RunConfig, RunConfig[keyof RunConfig]>)[key] = value;
    }
  }
  return merged;
}
