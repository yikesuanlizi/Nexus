import { getProvider } from './providers.js';
import type { ModelConfig } from './types.js';

export type ModelEndpointFormat =
  | 'chat_completions'
  | 'responses'
  | 'anthropic_messages'
  | 'custom_endpoint';

export type ModelTransportId =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages';

export type ToolHistoryMode =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_blocks';

export type ReasoningMode =
  | 'none'
  | 'deepseek_reasoning_content'
  | 'minimax_anthropic_thinking'
  | 'minimax_openai_reasoning_details'
  | 'anthropic_thinking'
  | 'openai_responses_items';

export type ProviderCacheMode =
  | 'none'
  | 'deepseek_native'
  | 'openai_prompt_details'
  | 'anthropic_cache_control';

export interface ProviderProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVars: string[];
  endpointFormat: ModelEndpointFormat;
  transport: ModelTransportId;
  toolHistoryMode: ToolHistoryMode;
  reasoningMode: ReasoningMode;
  cacheMode: ProviderCacheMode;
}

const KNOWN_PROFILES: Record<string, Omit<ProviderProfile, 'baseUrl' | 'apiKeyEnvVars'>> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    endpointFormat: 'responses',
    transport: 'openai_responses',
    toolHistoryMode: 'openai_responses',
    reasoningMode: 'openai_responses_items',
    cacheMode: 'openai_prompt_details',
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    endpointFormat: 'chat_completions',
    transport: 'openai_chat_completions',
    toolHistoryMode: 'openai_chat',
    reasoningMode: 'deepseek_reasoning_content',
    cacheMode: 'deepseek_native',
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    endpointFormat: 'anthropic_messages',
    transport: 'anthropic_messages',
    toolHistoryMode: 'anthropic_blocks',
    reasoningMode: 'anthropic_thinking',
    cacheMode: 'anthropic_cache_control',
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    endpointFormat: 'anthropic_messages',
    transport: 'anthropic_messages',
    toolHistoryMode: 'anthropic_blocks',
    reasoningMode: 'minimax_anthropic_thinking',
    cacheMode: 'anthropic_cache_control',
  },
};

export function getProviderProfile(providerId: string): ProviderProfile | undefined {
  const normalized = normalizeProviderId(providerId);
  const base = KNOWN_PROFILES[normalized];
  if (!base) return undefined;
  const provider = getProvider(normalized);
  return {
    ...base,
    baseUrl: provider?.baseUrl ?? '',
    apiKeyEnvVars: provider?.apiKeyEnvVar ? [provider.apiKeyEnvVar] : [],
  };
}

export function resolveProviderProfile(config: Pick<ModelConfig, 'provider' | 'baseUrl' | 'model'>): ProviderProfile {
  const known = getProviderProfile(config.provider);
  if (known) {
    return {
      ...known,
      baseUrl: config.baseUrl?.trim() || known.baseUrl,
    };
  }
  const provider = getProvider(config.provider);
  const baseUrl = config.baseUrl?.trim() || provider?.baseUrl || '';
  const providerName = config.provider.trim();
  const anthropic = provider?.protocol === 'anthropic';
  return {
    id: providerName || 'openai_compatible',
    displayName: provider?.name ?? (providerName || 'OpenAI-compatible'),
    baseUrl,
    apiKeyEnvVars: provider?.apiKeyEnvVar ? [provider.apiKeyEnvVar] : [],
    endpointFormat: anthropic ? 'anthropic_messages' : 'chat_completions',
    transport: anthropic ? 'anthropic_messages' : 'openai_chat_completions',
    toolHistoryMode: anthropic ? 'anthropic_blocks' : 'openai_chat',
    reasoningMode: 'none',
    cacheMode: anthropic ? 'anthropic_cache_control' : 'openai_prompt_details',
  };
}

function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === 'doubao') return 'volcengine';
  return normalized;
}
