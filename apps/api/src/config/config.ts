import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Locale } from '@nexus/i18n';
import {
  DEFAULT_EPISODE_MEMORY_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  normalizeEpisodeMemorySettings,
  normalizeMemorySettings,
} from '@nexus/memory';
import type { PermissionPreset } from '@nexus/sandbox';
import type { ThreadId } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { MCP_SERVERS_KEY, normalizeMcpServers, type McpServerConfig } from './mcp.js';

// 网页搜索模式：自动 | 开启 | 关闭 — Chinese: web search mode
export type WebSearchMode = 'auto' | 'on' | 'off';
// 网页提供者模式：原生 fetch | firecrawl — Chinese: web provider mode
export type WebProviderMode = 'native_fetch' | 'firecrawl';
// 密钥来源：项目配置 | 环境变量 — Chinese: secret source
export type SecretSource = 'config' | 'env';
// 推理力度：低 | 中 | 高 — Chinese: reasoning effort
export type ReasoningEffort = 'low' | 'medium' | 'high';
// 界面主题：深色 | 浅色 | 跟随系统 — Chinese: UI theme mode
export type ThemeMode = 'dark' | 'light' | 'system';
// 运行模式：缓存优先 | 运行时操作系统 — Chinese: run profile
export type RunProfile = 'cache_first' | 'runtime_os';

// Codex 风格的子 Agent 角色档案（以 agent_type 为键） — Chinese: agent role profiles
export type AgentRoleProfiles = Record<string, {
  description?: string;
  instructions?: string;
  systemPrompt?: string;
  skills?: string[];
  allowedSkills?: string[];
  allowedTools?: string[];
  blockedTools?: string[];
  serviceTier?: string;
  maxSubagents?: number;
  maxSubagentDepth?: number;
}>;

export interface AgentRunConfig {
  workspaceRoot: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** Permission preset id: 'read_only' | 'workspace' | 'danger_full_access'. */
  /** 中文：权限预设 id */
  permissions: PermissionPreset['id'];
  dataDir: string;
  /** Single user-level directory containing skill subdirectories with SKILL.md. */
  /** 中文：存放 SKILL.md 子目录的根目录 */
  skillsRoot: string;
  /** Controls when the future web_search extension should be exposed to a turn. */
  /** 中文：控制何时在一个回合中暴露 web_search 扩展 */
  webSearchMode: WebSearchMode;
  /** Which web reader/search backend should power the model-visible web_search tool. */
  /** 中文：作为模型可见 web_search 工具的后端 */
  webProvider: WebProviderMode;
  /** Firecrawl key source: project settings database or system environment. */
  /** 中文：Firecrawl 密钥来源 — 项目配置或系统环境变量 */
  webProviderKeySource: SecretSource;
  /** Simplified reasoning effort selector shown in the composer. */
  /** 中文：在 composer 中展示的简化推理力度选项 */
  reasoningEffort: ReasoningEffort;
  /** Runtime trade-off profile: cache hit stability or long-running traceability. */
  /** 中文：运行时折中方案 — 缓存命中稳定性或长期可追溯 */
  runProfile: RunProfile;
  /** Codex-style subagent role profiles keyed by agent_type. */
  /** 中文：以 agent_type 为键的 Codex 风格子 Agent 角色档案 */
  agentRoles?: AgentRoleProfiles;
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
  locale?: Locale;
}

export interface TurnRequest {
  input: string;
  modeInstruction?: string;
  config?: Partial<AgentRunConfig>;
  images?: Array<{ name: string; dataUrl: string }>;
}

// API 密钥状态 — Chinese: api key state
export interface ApiKeyState {
  providerId: string;
  envVar: string;
  configured: boolean;
  source: 'env' | 'config' | null;
  masked: string | null;
}

// 模型预设 — Chinese: model preset
export interface ModelPreset {
  id: string;
  name: string;
  config: Partial<AgentRunConfig>;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_RUN_CONFIG_KEY = 'runConfig.default';
export const MODEL_PRESETS_KEY = 'modelPresets';
export const WEB_PROVIDER_SECRETS_KEY = 'webProvider.secrets.v1';

export interface WebProviderSecrets {
  firecrawlApiKey?: string;
}

export interface PublicWebProviderConfig {
  firecrawl: {
    configured: boolean;
    source: SecretSource | null;
    masked: string | null;
    envVar: 'FIRECRAWL_API_KEY';
  };
}

export interface WebProviderRuntimeConfig {
  provider: WebProviderMode;
  firecrawl: { apiKey?: string; baseUrl?: string };
  source: SecretSource | null;
}

export const defaultConfig: AgentRunConfig = {
  workspaceRoot: process.cwd(),
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  baseUrl: '',
  permissions: 'workspace',
  dataDir: path.join(process.cwd(), '.nexus'),
  skillsRoot: path.join(os.homedir(), '.nexus', 'skills'),
  webSearchMode: 'auto',
  webProvider: 'native_fetch',
  webProviderKeySource: 'config',
  reasoningEffort: 'medium',
  runProfile: 'runtime_os',
  themeMode: 'light',
  agentRoles: {},
  memoryEnabled: DEFAULT_MEMORY_SETTINGS.memoryEnabled,
  autoExtractMemories: DEFAULT_MEMORY_SETTINGS.autoExtractMemories,
  useColdMemories: DEFAULT_MEMORY_SETTINGS.useColdMemories,
  memoryInjectLimit: DEFAULT_MEMORY_SETTINGS.memoryInjectLimit,
  memoryTokenBudget: DEFAULT_MEMORY_SETTINGS.memoryTokenBudget,
  episodeMemoryEnabled: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeMemoryEnabled,
  episodeInjectLimit: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeInjectLimit,
  episodeTokenBudget: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeTokenBudget,
  episodeSwitchCooldownTurns: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeSwitchCooldownTurns,
  episodeSealIdleMinutes: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeSealIdleMinutes,
  episodeColdAfterDays: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeColdAfterDays,
  episodeFtsCandidateLimit: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeFtsCandidateLimit,
  episodeRerankEnabled: DEFAULT_EPISODE_MEMORY_SETTINGS.episodeRerankEnabled,
};

export function hiddenChatWorkspaceRoot(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'chat-workspace');
}

export function resolveConfig(patch: Partial<AgentRunConfig> = {}): AgentRunConfig {
  const merged = { ...defaultConfig, ...patch };
  merged.workspaceRoot = path.resolve(merged.workspaceRoot);
  merged.dataDir = path.resolve(merged.dataDir);
  if (!merged.skillsRoot) {
    merged.skillsRoot = defaultConfig.skillsRoot;
  }
  merged.skillsRoot = path.resolve(merged.skillsRoot);
  if (!['auto', 'on', 'off'].includes(merged.webSearchMode)) {
    merged.webSearchMode = defaultConfig.webSearchMode;
  }
  if (!['native_fetch', 'firecrawl'].includes(merged.webProvider)) {
    merged.webProvider = defaultConfig.webProvider;
  }
  if (!['config', 'env'].includes(merged.webProviderKeySource)) {
    merged.webProviderKeySource = defaultConfig.webProviderKeySource;
  }
  if (!['low', 'medium', 'high'].includes(merged.reasoningEffort)) {
    merged.reasoningEffort = defaultConfig.reasoningEffort;
  }
  if (!['cache_first', 'runtime_os'].includes(merged.runProfile)) {
    merged.runProfile = defaultConfig.runProfile;
  }
  if (!['dark', 'light', 'system'].includes(merged.themeMode)) {
    merged.themeMode = defaultConfig.themeMode;
  }
  if (!merged.agentRoles || typeof merged.agentRoles !== 'object' || Array.isArray(merged.agentRoles)) {
    merged.agentRoles = {};
  }
  const memory = normalizeMemorySettings({
    memoryEnabled: merged.memoryEnabled,
    autoExtractMemories: merged.autoExtractMemories,
    useColdMemories: merged.useColdMemories,
    memoryInjectLimit: merged.memoryInjectLimit,
    memoryTokenBudget: merged.memoryTokenBudget,
  });
  merged.memoryEnabled = memory.memoryEnabled;
  merged.autoExtractMemories = memory.autoExtractMemories;
  merged.useColdMemories = memory.useColdMemories;
  merged.memoryInjectLimit = memory.memoryInjectLimit;
  merged.memoryTokenBudget = memory.memoryTokenBudget;
  const episode = normalizeEpisodeMemorySettings({
    episodeMemoryEnabled: merged.episodeMemoryEnabled,
    episodeInjectLimit: merged.episodeInjectLimit,
    episodeTokenBudget: merged.episodeTokenBudget,
    episodeSwitchCooldownTurns: merged.episodeSwitchCooldownTurns,
    episodeSealIdleMinutes: merged.episodeSealIdleMinutes,
    episodeColdAfterDays: merged.episodeColdAfterDays,
    episodeFtsCandidateLimit: merged.episodeFtsCandidateLimit,
    episodeRerankEnabled: merged.episodeRerankEnabled,
  });
  merged.episodeMemoryEnabled = episode.episodeMemoryEnabled;
  merged.episodeInjectLimit = episode.episodeInjectLimit;
  merged.episodeTokenBudget = episode.episodeTokenBudget;
  merged.episodeSwitchCooldownTurns = episode.episodeSwitchCooldownTurns;
  merged.episodeSealIdleMinutes = episode.episodeSealIdleMinutes;
  merged.episodeColdAfterDays = episode.episodeColdAfterDays;
  merged.episodeFtsCandidateLimit = episode.episodeFtsCandidateLimit;
  merged.episodeRerankEnabled = episode.episodeRerankEnabled;
  return merged;
}

export function publicRunConfig(config: AgentRunConfig): AgentRunConfig {
  const { apiKey: _apiKey, ...publicConfig } = config;
  return publicConfig;
}

export function resolveWebProviderRuntimeConfig(
  config: Partial<Pick<AgentRunConfig, 'webProvider' | 'webProviderKeySource'>>,
  secrets: WebProviderSecrets = {},
  env: Partial<Pick<NodeJS.ProcessEnv, 'FIRECRAWL_API_KEY' | 'FIRECRAWL_BASE_URL'>> = process.env,
): WebProviderRuntimeConfig {
  const resolved = resolveConfig(config);
  const provider = resolved.webProvider;
  const source = provider === 'firecrawl' ? resolved.webProviderKeySource : null;
  const apiKey = source === 'env' ? env.FIRECRAWL_API_KEY : secrets.firecrawlApiKey;
  return {
    provider,
    firecrawl: {
      apiKey,
      baseUrl: env.FIRECRAWL_BASE_URL,
    },
    source,
  };
}

export function publicWebProviderConfig(
  secrets: WebProviderSecrets = {},
  env: Partial<Pick<NodeJS.ProcessEnv, 'FIRECRAWL_API_KEY'>> = process.env,
): PublicWebProviderConfig {
  const configKey = secrets.firecrawlApiKey?.trim();
  const envKey = env.FIRECRAWL_API_KEY?.trim();
  const source: SecretSource | null = configKey ? 'config' : envKey ? 'env' : null;
  const key = configKey || envKey || '';
  return {
    firecrawl: {
      configured: Boolean(key),
      source,
      masked: key ? maskSecret(key) : null,
      envVar: 'FIRECRAWL_API_KEY',
    },
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function createConfigRepository(store: ThreadStore) {
  function modelPresetConfig(config: Partial<AgentRunConfig>): Partial<AgentRunConfig> {
    const next: Partial<AgentRunConfig> = {};
    if (config.provider !== undefined) next.provider = config.provider;
    if (config.model !== undefined) next.model = config.model;
    if (config.baseUrl !== undefined) next.baseUrl = config.baseUrl;
    if (config.permissions !== undefined) next.permissions = config.permissions;
    if (config.webSearchMode !== undefined) next.webSearchMode = config.webSearchMode;
    if (config.webProvider !== undefined) next.webProvider = config.webProvider;
    if (config.webProviderKeySource !== undefined) next.webProviderKeySource = config.webProviderKeySource;
    if (config.reasoningEffort !== undefined) next.reasoningEffort = config.reasoningEffort;
    if (config.runProfile !== undefined) next.runProfile = config.runProfile;
    if (config.memoryEnabled !== undefined) next.memoryEnabled = config.memoryEnabled;
    if (config.autoExtractMemories !== undefined) next.autoExtractMemories = config.autoExtractMemories;
    if (config.useColdMemories !== undefined) next.useColdMemories = config.useColdMemories;
    if (config.memoryInjectLimit !== undefined) next.memoryInjectLimit = config.memoryInjectLimit;
    if (config.memoryTokenBudget !== undefined) next.memoryTokenBudget = config.memoryTokenBudget;
    if (config.episodeMemoryEnabled !== undefined) next.episodeMemoryEnabled = config.episodeMemoryEnabled;
    if (config.episodeInjectLimit !== undefined) next.episodeInjectLimit = config.episodeInjectLimit;
    if (config.episodeTokenBudget !== undefined) next.episodeTokenBudget = config.episodeTokenBudget;
    if (config.episodeSwitchCooldownTurns !== undefined) next.episodeSwitchCooldownTurns = config.episodeSwitchCooldownTurns;
    if (config.episodeSealIdleMinutes !== undefined) next.episodeSealIdleMinutes = config.episodeSealIdleMinutes;
    if (config.episodeColdAfterDays !== undefined) next.episodeColdAfterDays = config.episodeColdAfterDays;
    if (config.episodeFtsCandidateLimit !== undefined) next.episodeFtsCandidateLimit = config.episodeFtsCandidateLimit;
    if (config.episodeRerankEnabled !== undefined) next.episodeRerankEnabled = config.episodeRerankEnabled;
    if (config.locale !== undefined) next.locale = config.locale;
    return next;
  }

  function stripThreadOnlyGlobalAppearance(config: Partial<AgentRunConfig>): Partial<AgentRunConfig> {
    const { themeMode: _themeMode, ...threadConfig } = config;
    return threadConfig;
  }

  function modelPresetName(config: Partial<AgentRunConfig>): string {
    return [config.provider, config.model].filter(Boolean).join(' / ') || 'Model preset';
  }

  async function listModelPresets(): Promise<ModelPreset[]> {
    const stored = await store.getSetting<ModelPreset[]>(MODEL_PRESETS_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  async function upsertModelPreset(input: {
    id?: string;
    name?: string;
    config?: Partial<AgentRunConfig>;
  }): Promise<{ preset: ModelPreset; presets: ModelPreset[] }> {
    const effectiveConfig = resolveConfig({ ...await getDefaultRunConfig(), ...(input.config ?? {}) });
    const safeConfig = modelPresetConfig(publicRunConfig(effectiveConfig));
    const presets = await listModelPresets();
    const id = input.id?.trim() || randomUUID();
    const existing = presets.find((preset) => preset.id === id);
    const now = new Date().toISOString();
    const preset: ModelPreset = {
      id,
      name: input.name?.trim() || existing?.name || modelPresetName(safeConfig),
      config: safeConfig,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing
      ? presets.map((item) => (item.id === id ? preset : item))
      : [preset, ...presets];
    await store.setSetting(MODEL_PRESETS_KEY, next);
    return { preset, presets: next };
  }

  async function deleteModelPreset(id: string): Promise<ModelPreset[]> {
    const presets = await listModelPresets();
    const next = presets.filter((preset) => preset.id !== id);
    await store.setSetting(MODEL_PRESETS_KEY, next);
    return next;
  }

  async function listMcpServers(): Promise<McpServerConfig[]> {
    return normalizeMcpServers(await store.getSetting<unknown>(MCP_SERVERS_KEY));
  }

  async function saveMcpServers(servers: unknown): Promise<McpServerConfig[]> {
    const next = normalizeMcpServers(servers);
    await store.setSetting(MCP_SERVERS_KEY, next);
    return next;
  }

  async function getDefaultRunConfig(): Promise<AgentRunConfig> {
    const stored = await store.getSetting<Partial<AgentRunConfig>>(DEFAULT_RUN_CONFIG_KEY);
    return resolveConfig(stored ?? {});
  }

  async function saveDefaultRunConfig(configPatch: Partial<AgentRunConfig>): Promise<AgentRunConfig> {
    const current = await getDefaultRunConfig();
    const next = resolveConfig({ ...current, ...configPatch });
    await store.setSetting(DEFAULT_RUN_CONFIG_KEY, publicRunConfig(next));
    return next;
  }

  function readThreadRunConfig(thread: { tags?: Record<string, string> }): Partial<AgentRunConfig> | null {
    const raw = thread.tags?.runConfig;
    if (!raw) return null;
    try {
      const { skillsRoot: _skillsRoot, ...config } = JSON.parse(raw) as Partial<AgentRunConfig>;
      return stripThreadOnlyGlobalAppearance(config);
    } catch {
      return null;
    }
  }

  function isPlainChatThread(thread: { tags?: Record<string, string> } | null): boolean {
    return thread?.tags?.conversationKind === 'chat';
  }

  function applyThreadKindRuntimeWorkspace(config: AgentRunConfig, thread: { tags?: Record<string, string> } | null): AgentRunConfig {
    if (!isPlainChatThread(thread)) return config;
    return { ...config, workspaceRoot: hiddenChatWorkspaceRoot(config.dataDir) };
  }

  function publicThreadRunConfig(config: AgentRunConfig, thread: { tags?: Record<string, string> } | null): AgentRunConfig {
    const publicConfig = publicRunConfig(config);
    return isPlainChatThread(thread) ? { ...publicConfig, workspaceRoot: '' } : publicConfig;
  }

  async function getThreadRunConfig(threadId: ThreadId): Promise<AgentRunConfig> {
    const thread = await store.getThread(threadId);
    const threadConfig = thread ? readThreadRunConfig(thread) : null;
    const base = await getDefaultRunConfig();
    return applyThreadKindRuntimeWorkspace(resolveConfig({ ...base, ...(threadConfig ?? {}) }), thread);
  }

  async function saveThreadRunConfig(
    threadId: ThreadId,
    configPatch: Partial<AgentRunConfig>,
  ): Promise<AgentRunConfig> {
    const thread = await store.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    const current = { ...await getDefaultRunConfig(), ...(readThreadRunConfig(thread) ?? {}) };
    const safePatch = isPlainChatThread(thread) && configPatch.workspaceRoot === ''
      ? { ...configPatch, workspaceRoot: current.workspaceRoot }
      : configPatch;
    const next = applyThreadKindRuntimeWorkspace(resolveConfig({ ...current, ...safePatch }), thread);
    const { skillsRoot: _skillsRoot, ...threadConfig } = publicRunConfig(next);
    await store.updateThreadMetadata(threadId, {
      tags: { ...thread.tags, runConfig: JSON.stringify(stripThreadOnlyGlobalAppearance(threadConfig)) },
    });
    return next;
  }

  return {
    deleteModelPreset,
    getDefaultRunConfig,
    getThreadRunConfig,
    listMcpServers,
    listModelPresets,
    saveDefaultRunConfig,
    saveMcpServers,
    saveThreadRunConfig,
    publicThreadRunConfig,
    upsertModelPreset,
  };
}
