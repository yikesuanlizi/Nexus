import type { RunConfig } from './config.js';
import type { McpConfig } from '../shared/types.js';

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
  themeMode: 'light',
  userAvatarId: 'asteroid',
  customUserAvatarDataUrl: '',
  locale: 'zh',
};

export const defaultMcps: McpConfig[] = [];

export function emptyMcp(): McpConfig {
  return { id: '', name: '', command: '', args: '', enabled: true };
}
