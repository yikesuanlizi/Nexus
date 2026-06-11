import type { InputPart, RetryPolicy } from '@nexus/protocol';

// ─── Model Provider Configuration ───────────────────────────────────────────
/** @deprecated Use string provider ids from the ProviderRegistry instead. */
export type ModelProviderKind = string;

export interface ModelConfig {
  /** Provider id (e.g. 'deepseek', 'openai', 'ollama'). */
  provider: string;
  /** Base URL override — if empty, resolved from provider registry or env. */
  baseUrl: string;
  /** Model name. */
  model: string;
  /** API key override — if empty, resolved from env var or config file. */
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  cacheStrategy?: CacheStrategy | 'auto';
  reasoningEffort?: 'low' | 'medium' | 'high' | string;
}

export type CacheStrategy =
  | 'deepseek-native'
  | 'openai-compatible'
  | 'anthropic-cache-control'
  | 'none';

export interface ModelRetryNotice {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  error?: string;
}

export interface ModelRequestOptions {
  onRetry?: (notice: ModelRetryNotice) => void | Promise<void>;
}

export interface TokenEstimate {
  inputTokens: number;
  messageCount: number;
  imageCount: number;
  charCount: number;
}

/** @deprecated Use ProviderRegistry instead. */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
  openai_compatible: 'http://localhost:8080/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

/** Which API protocol the provider uses (falls back to 'openai'). */
export function protocolFor(provider: string): 'openai' | 'anthropic' {
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

// ─── Unified Message Types (OpenAI shape, converted for Anthropic internally) ─
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MultimodalContent[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type MultimodalContent = TextContent | ImageUrlContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageUrlContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

// ─── OpenAI Request / Response ──────────────────────────────────────────────
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning_effort?: 'low' | 'medium' | 'high' | string;
  stream?: boolean;
  stop?: string[];
}

export interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  cache_strategy?: Exclude<CacheStrategy, 'none'>;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Choice[];
  usage?: NormalizedUsage;
}

export interface Choice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ─── Anthropic Request / Response ───────────────────────────────────────────
export interface AnthropicMessageRequest {
  model: string;
  system?: string | Array<AnthropicTextBlock>;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ─── Anthropic Streaming SSE ────────────────────────────────────────────────
export interface AnthropicSSEEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
    | 'ping';
  message?: AnthropicMessageResponse;
  content_block?: AnthropicContentBlock;
  index?: number;
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ─── Unified Stream Event ───────────────────────────────────────────────────
export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: string }
  | { type: 'done'; usage?: NormalizedUsage }
  | { type: 'error'; error: Error };

// ─── Helpers ────────────────────────────────────────────────────────────────
export function inputPartsToContent(parts: InputPart[]): MultimodalContent[] {
  return parts.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image_url') {
      return { type: 'image_url', image_url: { url: part.image_url.url, detail: part.image_url.detail ?? 'auto' } };
    }
    return { type: 'image_url', image_url: { url: `file://${part.path}`, detail: 'auto' } };
  });
}

export function resolveBaseUrl(config: ModelConfig): string {
  return config.baseUrl || DEFAULT_BASE_URLS[config.provider];
}
