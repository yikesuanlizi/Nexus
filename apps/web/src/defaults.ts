import type { RunConfig } from './config.js';
import type { McpConfig } from './types.js';

export const defaultConfig: RunConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  baseUrl: '',
  workspaceRoot: '',
  permissions: 'workspace',
  dataDir: '',
  skillsRoot: '',
  webSearchMode: 'auto',
  reasoningEffort: 'medium',
  runProfile: 'runtime_os',
  themeMode: 'dark',
  locale: 'zh',
};

export const defaultMcps: McpConfig[] = [];

export function emptyMcp(): McpConfig {
  return { id: '', name: '', command: '', args: '', enabled: true };
}
