import { z } from 'zod';

export type PermissionPresetId = 'read_only' | 'workspace' | 'danger_full_access';
export type WebSearchMode = 'auto' | 'on' | 'off';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type RunProfile = 'cache_first' | 'runtime_os';
export type ApiMode = 'chat' | 'responses' | 'completion';
export type ReasoningMode = 'disabled' | 'auto' | 'adaptive' | 'enabled';

export interface ThreadRunConfigOverrides {
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  permissions?: PermissionPresetId;
  webSearchMode?: WebSearchMode;
  reasoningEffort?: ReasoningEffort;
  runProfile?: RunProfile;
}

export const THREAD_RUN_CONFIG_KEYS = [
  'workspaceRoot',
  'provider',
  'model',
  'baseUrl',
  'permissions',
  'webSearchMode',
  'reasoningEffort',
  'runProfile',
] as const;

export type ThreadRunConfigKey = typeof THREAD_RUN_CONFIG_KEYS[number];

export interface ThreadConfigUpdate {
  set?: ThreadRunConfigOverrides;
  unset?: ThreadRunConfigKey[];
}

const threadRunConfigOverridesSchemaLegacy = z.object({
  workspaceRoot: z.string().trim().min(1).optional(),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  baseUrl: z.string().optional(),
  permissions: z.enum(['read_only', 'workspace', 'danger_full_access']).optional(),
  webSearchMode: z.enum(['auto', 'on', 'off']).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  runProfile: z.enum(['cache_first', 'runtime_os']).optional(),
}).strict();

export const threadConfigUpdateSchema = z.object({
  set: threadRunConfigOverridesSchemaLegacy.optional(),
  unset: z.array(z.enum(THREAD_RUN_CONFIG_KEYS)).max(THREAD_RUN_CONFIG_KEYS.length).optional(),
}).strict().superRefine((value, context) => {
  if (!value.set && !value.unset?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'set or unset is required' });
  }
  for (const key of value.unset ?? []) {
    if (value.set && key in value.set) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `cannot set and unset ${key}` });
    }
  }
});

export function threadRunConfigOverridesFrom(input: Record<string, unknown>): ThreadRunConfigOverrides {
  const result: ThreadRunConfigOverrides = {};
  for (const key of THREAD_RUN_CONFIG_KEYS) {
    const value = input[key];
    if (typeof value === 'string') {
      (result as Record<string, string>)[key] = value.trim();
    }
  }
  return result;
}

export interface ModelPresetConfig {
  provider: string;
  model: string;
  baseUrl: string;
}

export function modelPresetConfigFrom(input: Record<string, unknown>): ModelPresetConfig {
  const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  if (!provider || !model) {
    throw new Error('provider and model are required');
  }
  return { provider, model, baseUrl };
}

// ─── Explicit Configuration Scopes (for P0 Task 3 refactoring) ──────────────

export const threadOnlyRunConfigKeys = ['themeMode', 'themePrimaryColor'] as const;

export type ThreadOnlyRunConfigKey = typeof threadOnlyRunConfigKeys[number];

export const GlobalRunConfigDefaultsSchema = z.object({
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o'),
  baseUrl: z.string().default(''),
  apiMode: z.enum(['chat', 'responses', 'completion']).default('chat'),
  reasoningMode: z.enum(['disabled', 'auto', 'adaptive', 'enabled']).default('auto'),
  thinking: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0.7),
  webSearchMode: z.enum(['auto', 'on', 'off']).default('auto'),
  webSearchMaxResults: z.number().int().min(1).max(20).default(5),
  maxSteps: z.number().int().min(1).max(100).default(25),
  planMode: z.enum(['disabled', 'on', 'auto']).default('auto'),
  includeMemory: z.boolean().default(true),
  modelContextTokens: z.number().int().positive().optional(),
  modelMaxOutputTokens: z.number().int().positive().optional(),
  customBaseUrl: z.string().default(''),
  customApiKey: z.string().default(''),
}).strip();

export type GlobalRunConfigDefaults = z.infer<typeof GlobalRunConfigDefaultsSchema>;

export const AppearanceConfigSchema = z.object({
  themeMode: z.enum(['light', 'dark', 'auto']).default('auto'),
  themePrimaryColor: z.string().default('6366f1'),
}).strip();

export type AppearanceConfig = z.infer<typeof AppearanceConfigSchema>;

export const NewThreadDefaultsConfigSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  baseUrl: z.string().optional(),
}).strip();

export type NewThreadDefaultsConfig = z.infer<typeof NewThreadDefaultsConfigSchema>;

export const ThreadModelOverridesSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  baseUrl: z.string().optional(),
}).strip();

export type ThreadModelOverrides = z.infer<typeof ThreadModelOverridesSchema>;

export const EMPTY_THREAD_MODEL_OVERRIDES: ThreadModelOverrides = {};

export interface ResolvedRunConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiMode: ApiMode;
  reasoningMode: ReasoningMode;
  thinking: boolean;
  temperature: number;
  webSearchMode: WebSearchMode;
  webSearchMaxResults: number;
  maxSteps: number;
  planMode: 'disabled' | 'on' | 'auto';
  includeMemory: boolean;
  modelContextTokens?: number;
  modelMaxOutputTokens?: number;
  customBaseUrl: string;
  customApiKey: string;
}

export interface CompositeConfigSnapshot {
  globalDefaults: GlobalRunConfigDefaults;
  appearance: AppearanceConfig;
  newThreadDefaults: NewThreadDefaultsConfig;
  activeThreadOverrides: ThreadModelOverrides;
}

const CompositeConfigSnapshotSchema = z.object({
  globalDefaults: GlobalRunConfigDefaultsSchema.default({}),
  appearance: AppearanceConfigSchema.default({}),
  newThreadDefaults: NewThreadDefaultsConfigSchema.default({}),
  activeThreadOverrides: ThreadModelOverridesSchema.default({}),
}).strip();

export function activeRunConfig(composite: CompositeConfigSnapshot): ResolvedRunConfig {
  const { globalDefaults, activeThreadOverrides } = composite;
  return {
    provider: activeThreadOverrides.provider ?? globalDefaults.provider,
    model: activeThreadOverrides.model ?? globalDefaults.model,
    baseUrl: activeThreadOverrides.baseUrl ?? globalDefaults.baseUrl,
    apiMode: globalDefaults.apiMode,
    reasoningMode: globalDefaults.reasoningMode,
    thinking: globalDefaults.thinking,
    temperature: globalDefaults.temperature,
    webSearchMode: globalDefaults.webSearchMode,
    webSearchMaxResults: globalDefaults.webSearchMaxResults,
    maxSteps: globalDefaults.maxSteps,
    planMode: globalDefaults.planMode,
    includeMemory: globalDefaults.includeMemory,
    modelContextTokens: globalDefaults.modelContextTokens,
    modelMaxOutputTokens: globalDefaults.modelMaxOutputTokens,
    customBaseUrl: globalDefaults.customBaseUrl,
    customApiKey: globalDefaults.customApiKey,
  };
}

export function parseCompositeConfigSnapshot(input: unknown): CompositeConfigSnapshot {
  return CompositeConfigSnapshotSchema.parse(input);
}

export const defaultGlobalRunConfigDefaults: GlobalRunConfigDefaults = GlobalRunConfigDefaultsSchema.parse({});
export const defaultAppearanceConfig: AppearanceConfig = AppearanceConfigSchema.parse({});
export const defaultNewThreadDefaultsConfig: NewThreadDefaultsConfig = NewThreadDefaultsConfigSchema.parse({});
export const defaultCompositeConfigSnapshot: CompositeConfigSnapshot = {
  globalDefaults: defaultGlobalRunConfigDefaults,
  appearance: defaultAppearanceConfig,
  newThreadDefaults: defaultNewThreadDefaultsConfig,
  activeThreadOverrides: EMPTY_THREAD_MODEL_OVERRIDES,
};
