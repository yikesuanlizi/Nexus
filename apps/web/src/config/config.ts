import type {
  AccessPolicyConfig,
  PermissionPresetId as ProtocolPermissionPresetId,
  ReasoningEffort as ProtocolReasoningEffort,
  RunProfile as ProtocolRunProfile,
  WebSearchMode as ProtocolWebSearchMode,
} from '@nexus/protocol';

export type PermissionPresetId = ProtocolPermissionPresetId;
export type Locale = 'zh' | 'en';
export type WebSearchMode = ProtocolWebSearchMode;
export type WebProviderMode = 'native_fetch' | 'firecrawl';
export type SecretSource = 'config' | 'env';
export type ReasoningEffort = ProtocolReasoningEffort;
export type ThemeMode = 'dark' | 'light' | 'system';
// 运行模式：缓存优先 | 长运行
// harness 不再是 RunProfile，已降级为 runtime 底座能力，旧值自动降级为 runtime_os
export type RunProfile = ProtocolRunProfile;
export type UserAvatarId = 'asteroid' | 'rocket' | 'owl' | 'crystal' | 'paper-plane' | 'fox' | 'lightning' | 'mushroom' | 'custom';

export interface RunConfig {
  workspaceRoot: string;
  provider: string;
  model: string;
  baseUrl: string;
  permissions: PermissionPresetId;
  accessPolicy: AccessPolicyConfig;
  dataDir: string;
  skillsRoot: string;
  webSearchMode: WebSearchMode;
  webProvider: WebProviderMode;
  webProviderKeySource: SecretSource;
  reasoningEffort: ReasoningEffort;
  maxIterations: number;
  maxActiveTasks: number;
  maxParallelReadonlyTools: number;
  maxSubagentDepth: number;
  modelContextTokens?: number;
  modelMaxOutputTokens?: number;
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
  /** Whether system monitor (CPU/memory/disk) throttling is enabled. */
  /** 中文：是否启用系统监控（CPU/内存/磁盘）限流 */
  systemMonitorEnabled: boolean;
  /** 仅控制 UI 面板可见性。 */
  monitorPanelVisible: boolean;
  systemMonitorSamplingEnabled: boolean;
  systemMonitorLogRecordingEnabled: boolean;
  systemMonitorGuardEnabled: boolean;
  systemMonitorThresholds: {
    cpuLight: number;
    cpuModerate: number;
    cpuSevere: number;
    memLight: number;
    memModerate: number;
    memSevere: number;
    diskSevereBytes: number;
  };
  maxConcurrency: number;
  toolTimeoutSeconds: number;
  memoryThresholdPercent: number;
  throttleNewTasks: boolean;
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
  'maxIterations',
  'maxActiveTasks',
  'maxParallelReadonlyTools',
  'maxSubagentDepth',
  'modelContextTokens',
  'modelMaxOutputTokens',
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
  'systemMonitorEnabled',
  'monitorPanelVisible',
  'systemMonitorSamplingEnabled',
  'systemMonitorLogRecordingEnabled',
  'systemMonitorGuardEnabled',
  'systemMonitorThresholds',
  'maxConcurrency',
  'toolTimeoutSeconds',
  'memoryThresholdPercent',
  'throttleNewTasks',
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
    systemMonitorEnabled: false,
    monitorPanelVisible: true,
    systemMonitorSamplingEnabled: false,
    systemMonitorLogRecordingEnabled: false,
    systemMonitorGuardEnabled: false,
    systemMonitorThresholds: {
      cpuLight: 85,
      cpuModerate: 92,
      cpuSevere: 97,
      memLight: 82,
      memModerate: 90,
      memSevere: 95,
      diskSevereBytes: 500 * 1024 * 1024,
    },
    maxIterations: 100,
    maxActiveTasks: 4,
    maxParallelReadonlyTools: 2,
    maxSubagentDepth: 1,
    maxConcurrency: 4,
    toolTimeoutSeconds: 120,
    memoryThresholdPercent: 85,
    throttleNewTasks: true,
    ...current,
    ...serverDefaults,
  } as RunConfig;
  if (current.maxActiveTasks === undefined && (current.maxConcurrency ?? serverDefaults?.maxConcurrency) !== undefined) {
    merged.maxActiveTasks = current.maxConcurrency ?? serverDefaults?.maxConcurrency ?? merged.maxActiveTasks;
  }
  for (const key of USER_FIELDS) {
    const value = current[key];
    if (value !== '' && value !== undefined) {
      (merged as Record<keyof RunConfig, RunConfig[keyof RunConfig]>)[key] = value;
    }
  }
  return merged;
}
