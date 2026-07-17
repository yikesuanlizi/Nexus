// 权限预设标识：只读 / 工作区默认 / 自主全访问
// Chinese translation: Permission preset IDs: read-only / workspace default / full-access mode.
export type PermissionPresetId = 'read_only' | 'workspace' | 'danger_full_access';
// 界面语言：中文 / 英文
// Chinese translation: UI language: Chinese / English.
export type Locale = 'zh' | 'en';
// 联网搜索模式：自动 / 始终开启 / 始终关闭
// Chinese translation: Web search mode: auto / always on / always off.
export type WebSearchMode = 'auto' | 'on' | 'off';
// 网页读取 provider：原生 fetch / Firecrawl
// Chinese translation: Web reading provider: native fetch / Firecrawl.
export type WebProviderMode = 'native_fetch' | 'firecrawl';
// API 密钥来源：项目配置文件 / 环境变量
// Chinese translation: API key source: project config / environment variable.
export type SecretSource = 'config' | 'env';
// 推理深度：快速 / 均衡 / 深度
// Chinese translation: Reasoning effort: low / balanced / deep.
export type ReasoningEffort = 'low' | 'medium' | 'high';
// 界面主题：深色 / 浅色 / 跟随系统
// Chinese translation: UI theme: dark / light / follow system.
export type ThemeMode = 'dark' | 'light' | 'system';
// 运行模式：缓存优先 / 长链路运行 / Harness 自主循环
// Chinese translation: Run profile: cache first / long-running OS / harness autonomous loop.
export type RunProfile = 'cache_first' | 'runtime_os' | 'harness';
// 用户头像预设 id，最后一个为自定义上传
// Chinese translation: User avatar preset IDs, the last one is for custom uploads.
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
  /** Whether system monitor (CPU/memory/disk) throttling is enabled. */
  /** 中文：是否启用系统监控（CPU/内存/磁盘）限流 */
  systemMonitorEnabled: boolean;
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
  'systemMonitorEnabled',
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
