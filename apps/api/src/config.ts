import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Locale } from '@nexus/i18n';
import type { PermissionPreset } from '@nexus/sandbox';
import type { ThreadId } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { MCP_SERVERS_KEY, normalizeMcpServers, type McpServerConfig } from './mcp.js';

export type WebSearchMode = 'auto' | 'on' | 'off';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type RunProfile = 'cache_first' | 'runtime_os';

export interface AgentRunConfig {
  workspaceRoot: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** Permission preset id: 'read_only' | 'workspace' | 'danger_full_access'. */
  permissions: PermissionPreset['id'];
  dataDir: string;
  /** Single user-level directory containing skill subdirectories with SKILL.md. */
  skillsRoot: string;
  /** Controls when the future web_search extension should be exposed to a turn. */
  webSearchMode: WebSearchMode;
  /** Simplified reasoning effort selector shown in the composer. */
  reasoningEffort: ReasoningEffort;
  /** Runtime trade-off profile: cache hit stability or long-running traceability. */
  runProfile: RunProfile;
  locale?: Locale;
}

export interface TurnRequest {
  input: string;
  modeInstruction?: string;
  config?: Partial<AgentRunConfig>;
  images?: Array<{ name: string; dataUrl: string }>;
}

export interface ApiKeyState {
  providerId: string;
  envVar: string;
  configured: boolean;
  source: 'env' | 'config' | null;
  masked: string | null;
}

export interface ModelPreset {
  id: string;
  name: string;
  config: Partial<AgentRunConfig>;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_RUN_CONFIG_KEY = 'runConfig.default';
export const MODEL_PRESETS_KEY = 'modelPresets';

export const defaultConfig: AgentRunConfig = {
  workspaceRoot: process.cwd(),
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  baseUrl: '',
  permissions: 'workspace',
  dataDir: path.join(process.cwd(), '.nexus'),
  skillsRoot: path.join(os.homedir(), '.nexus', 'skills'),
  webSearchMode: 'auto',
  reasoningEffort: 'medium',
  runProfile: 'runtime_os',
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
  if (!['low', 'medium', 'high'].includes(merged.reasoningEffort)) {
    merged.reasoningEffort = defaultConfig.reasoningEffort;
  }
  if (!['cache_first', 'runtime_os'].includes(merged.runProfile)) {
    merged.runProfile = defaultConfig.runProfile;
  }
  return merged;
}

export function publicRunConfig(config: AgentRunConfig): AgentRunConfig {
  const { apiKey: _apiKey, ...publicConfig } = config;
  return publicConfig;
}

export function createConfigRepository(store: ThreadStore) {
  function modelPresetConfig(config: Partial<AgentRunConfig>): Partial<AgentRunConfig> {
    const next: Partial<AgentRunConfig> = {};
    if (config.provider !== undefined) next.provider = config.provider;
    if (config.model !== undefined) next.model = config.model;
    if (config.baseUrl !== undefined) next.baseUrl = config.baseUrl;
    if (config.permissions !== undefined) next.permissions = config.permissions;
    if (config.webSearchMode !== undefined) next.webSearchMode = config.webSearchMode;
    if (config.reasoningEffort !== undefined) next.reasoningEffort = config.reasoningEffort;
    if (config.runProfile !== undefined) next.runProfile = config.runProfile;
    if (config.locale !== undefined) next.locale = config.locale;
    return next;
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
      return config;
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
      tags: { ...thread.tags, runConfig: JSON.stringify(threadConfig) },
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
