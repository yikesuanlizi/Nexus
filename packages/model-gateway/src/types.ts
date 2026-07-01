// 引入协议层的多模态输入部件与重试策略
import type { InputPart, RetryPolicy } from '@nexus/protocol';

// ─── Model Provider Configuration ───────────────────────────────────────────
/** @deprecated Use string provider ids from the ProviderRegistry instead. */
// 旧版 provider 类型别名：保留只为兼容，推荐直接使用字符串
// 英文说明：Use string provider ids from the ProviderRegistry instead
export type ModelProviderKind = string;

// 单个模型配置：完整描述一次模型调用所需的全部参数
// 英文说明：ModelConfig describes the full set of parameters needed for a model call
export interface ModelConfig {
  /** Provider id (e.g. 'deepseek', 'openai', 'ollama'). */
  // 模型提供者 id（例如 'deepseek'、'openai'、'ollama'）
  provider: string;
  /** Base URL override — if empty, resolved from provider registry or env. */
  // 自定义 baseURL；为空时自动从 provider 注册表或环境变量解析
  baseUrl: string;
  /** Model name. */
  // 模型名（例如 gpt-4o、deepseek-chat）
  model: string;
  /** API key override — if empty, resolved from env var or config file. */
  // 显式 API key；为空时从环境变量或 ~/.nexus/config.json 解析
  apiKey?: string;
  /** 单次响应最大 token 数 */
  maxTokens?: number;
  /** 采样温度（0-2） */
  temperature?: number;
  /** 核采样参数 */
  topP?: number;
  /** 额外 HTTP header（如自定义网关需要的 token / project） */
  extraHeaders?: Record<string, string>;
  /** 请求超时（毫秒），默认 120000 */
  timeoutMs?: number;
  /** 自定义重试策略（部分覆盖默认） */
  retry?: Partial<RetryPolicy>;
  /** 缓存策略：auto 时按 provider/model 自动推断 */
  cacheStrategy?: CacheStrategy | 'auto';
  /** 推理努力程度（OpenAI o-series、DeepSeek R1 等） */
  reasoningEffort?: 'low' | 'medium' | 'high' | string;
}

// 缓存策略：deepseek-native（原生）/ openai-compatible（带缓存字段）/ anthropic-cache-control / none
export type CacheStrategy =
  | 'deepseek-native'
  | 'openai-compatible'
  | 'anthropic-cache-control'
  | 'none';

// 重试通知：让调用方在重试时拿到状态
export interface ModelRetryNotice {
  attempt: number;        // 当前第几次尝试
  maxAttempts: number;    // 最大尝试次数
  delayMs: number;        // 本次等待毫秒
  status?: number;        // 上次失败的 HTTP 状态码
  error?: string;         // 上次失败原因
}

// 模型请求选项
export interface ModelRequestOptions {
  signal?: AbortSignal;            // 取消信号
  onRetry?: (notice: ModelRetryNotice) => void | Promise<void>;  // 每次重试时回调
}

// 上下文 token 估算结果
export interface TokenEstimate {
  inputTokens: number;     // 估算的输入 token
  messageCount: number;    // 消息条数
  imageCount: number;      // 图片数
  charCount: number;       // 字符数
}

/** @deprecated Use ProviderRegistry instead. */
// 旧版默认 baseURL 表：保留只为兼容；推荐使用 providers.ts 的注册表
// 英文说明：Use ProviderRegistry instead of this hardcoded map
export const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
  openai_compatible: 'http://localhost:8080/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

/** Which API protocol the provider uses (falls back to 'openai'). */
// 判断 provider 使用哪种协议；只有 anthropic 走独立分支，其它都按 OpenAI 处理
// 英文说明：Anthropic providers use an alternate protocol; everything else falls back to OpenAI
export function protocolFor(provider: string): 'openai' | 'anthropic' {
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

// ─── Unified Message Types (OpenAI shape, converted for Anthropic internally) ─
// 统一消息类型：以 OpenAI 形态为基准，内部转换给 Anthropic
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MultimodalContent[];  // 文本或多模态内容
  name?: string;                          // 工具名（部分模型需要）
  tool_calls?: ToolCall[];                // assistant 的工具调用
  tool_call_id?: string;                  // tool 消息对应的工具调用 id
}

// 多模态内容：文本或图片
export type MultimodalContent = TextContent | ImageUrlContent;

// 文本片段
export interface TextContent {
  type: 'text';
  text: string;
}

// 图片 URL 片段
export interface ImageUrlContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

// 工具调用
export interface ToolCall {
  id: string;                                        // 工具调用 id
  type: 'function';
  function: { name: string; arguments: string };     // 工具名 + JSON 字符串参数
}

// 工具定义（发给模型）
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

// ─── OpenAI Request / Response ──────────────────────────────────────────────
// OpenAI Chat Completions 请求体
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

// 归一化后的用量：统一 OpenAI / Anthropic 字段
export interface NormalizedUsage {
  prompt_tokens: number;            // 输入 token
  completion_tokens: number;        // 输出 token
  total_tokens: number;             // 总 token
  cached_tokens?: number;           // 缓存命中 token
  cache_strategy?: Exclude<CacheStrategy, 'none'>;
}

// OpenAI Chat Completions 响应
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Choice[];
  usage?: NormalizedUsage;
}

// 单条回答选项
export interface Choice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ─── Anthropic Request / Response ───────────────────────────────────────────
// Anthropic Messages API 请求体
export interface AnthropicMessageRequest {
  model: string;
  system?: string | Array<AnthropicTextBlock>;  // system 提示，可为字符串或带 cache_control 的块
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

// Anthropic 单条消息：只允许 user/assistant 两种角色
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

// Anthropic 内容块：text / tool_use / tool_result 三种
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

// Anthropic 文本块，可带 cache_control 走 prompt cache
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

// Anthropic 工具定义：使用 input_schema 而非 parameters
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Anthropic 响应
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
    cache_read_input_tokens?: number;       // 缓存读 token
    cache_creation_input_tokens?: number;   // 缓存创建 token
  };
}

// ─── Anthropic Streaming SSE ────────────────────────────────────────────────
// Anthropic 流式 SSE 事件
export interface AnthropicSSEEvent {
  type:
    | 'message_start'        // 消息开始
    | 'content_block_start'  // 内容块开始
    | 'content_block_delta'  // 内容块增量
    | 'content_block_stop'   // 内容块结束
    | 'message_delta'        // 消息元信息增量（含 usage）
    | 'message_stop'         // 消息结束
    | 'ping';                // 心跳
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
// 统一流式事件：上层不必区分 OpenAI / Anthropic
export type StreamEvent =
  | { type: 'delta'; content: string }                                           // 文本增量
  | { type: 'tool_call_start'; id: string; name: string }                        // 工具调用开始
  | { type: 'tool_call_delta'; id: string; arguments: string }                   // 工具参数增量
  | { type: 'tool_call_end'; id: string; name: string; arguments: string }       // 工具调用结束
  | { type: 'done'; usage?: NormalizedUsage }                                    // 流式结束
  | { type: 'error'; error: Error };                                             // 错误

// ─── Helpers ────────────────────────────────────────────────────────────────
// 把协议层的 InputPart 转为统一多模态内容
export function inputPartsToContent(parts: InputPart[]): MultimodalContent[] {
  return parts.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image_url') {
      return { type: 'image_url', image_url: { url: part.image_url.url, detail: part.image_url.detail ?? 'auto' } };
    }
    return { type: 'image_url', image_url: { url: `file://${part.path}`, detail: 'auto' } };
  });
}

// 解析出最终生效的 baseURL：优先用配置，否则用旧版默认表
export function resolveBaseUrl(config: ModelConfig): string {
  return config.baseUrl || DEFAULT_BASE_URLS[config.provider];
}
