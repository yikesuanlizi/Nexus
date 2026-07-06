import type { RunConfig } from './config.js';
import type { McpConfig } from '../shared/types.js';

// 默认运行配置（首次启动或配置缺失时使用）
// Chinese translation: Default runtime config (used on first launch or when settings are missing).
export const defaultConfig: RunConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  baseUrl: '',
  workspaceRoot: '',
  permissions: 'workspace',
  dataDir: '',
  skillsRoot: '',
  webSearchMode: 'auto',
  webProvider: 'native_fetch',
  webProviderKeySource: 'config',
  reasoningEffort: 'medium',
  runProfile: 'runtime_os',
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
  themeMode: 'light',
  userAvatarId: 'asteroid',
  customUserAvatarDataUrl: '',
  locale: 'zh',
};

// 默认 MCP 列表，为空表示初始不启用任何 MCP server
// Chinese translation: Default MCP list. Empty means no MCP server is initially enabled.
export const defaultMcps: McpConfig[] = [];

// 返回一个空的 MCP 配置对象，通常用于新增 MCP 的表单初始值
// Chinese translation: Returns an empty MCP configuration object, usually used as the initial form value for adding a new MCP.
export function emptyMcp(): McpConfig {
  return { id: '', name: '', command: '', args: '', enabled: true };
}
