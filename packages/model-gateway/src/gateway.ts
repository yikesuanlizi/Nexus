import {
  ModelConfig,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type AnthropicMessageRequest,
  type AnthropicMessageResponse,
  type AnthropicContentBlock,
  type AnthropicSSEEvent,
  type StreamEvent,
  type ChatMessage,
  type CacheStrategy,
  type ModelRequestOptions,
  type NormalizedUsage,
  type TokenEstimate,
  type ToolCall,
  type ToolDefinition,
  resolveBaseUrl,
  protocolFor,
} from './types.js';
import { getProvider, resolveApiKey } from './providers.js';

/** Core model gateway — unified interface over OpenAI-compatible + Anthropic APIs. */
export class ModelGateway {
  private config: ModelConfig;
  private baseUrl: string;
  private protocol: 'openai' | 'anthropic';
  private cacheStrategy: CacheStrategy;

  constructor(config: ModelConfig) {
    // Resolve provider entry for auto-config
    const providerEntry = getProvider(config.provider);
    const resolvedBaseUrl = config.baseUrl || providerEntry?.baseUrl || resolveBaseUrl(config);
    const resolvedApiKey = resolveApiKey(config.provider, config.apiKey);

    this.config = { ...config, baseUrl: resolvedBaseUrl, apiKey: resolvedApiKey };
    this.baseUrl = resolvedBaseUrl;
    this.protocol = providerEntry?.protocol ?? protocolFor(config.provider);
    this.cacheStrategy = resolveCacheStrategy(this.config, this.protocol);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Non-streaming chat completion. Works identically for both protocols. */
  async chat(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): Promise<ChatCompletionResponse> {
    if (this.protocol === 'anthropic') {
      return this.anthropicChat(req, options);
    }
    return this.openaiChat(req, options);
  }

  /** Streaming chat completion — unified StreamEvent for both protocols. */
  async *chatStream(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): AsyncGenerator<StreamEvent> {
    if (this.protocol === 'anthropic') {
      yield* this.anthropicChatStream(req, options);
    } else {
      yield* this.openaiChatStream(req, options);
    }
  }

  /** Test connectivity. */
  async healthCheck(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const url = this.protocol === 'anthropic'
        ? this.baseUrl.replace(/\/v1\/?$/, '') + '/v1/messages'
        : this.baseUrl.replace(/\/v1\/?$/, '') + '/v1/models';
      const headers: Record<string, string> = this.baseHeaders();
      if (this.protocol === 'anthropic') {
        // Minimal ping — Anthropic needs a real request, just HEAD is enough
        const resp = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(5000) });
        return { ok: resp.status < 500, models: [] };
      }
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const body = (await resp.json()) as { data?: Array<{ id: string }> };
      return { ok: true, models: body.data?.map((m) => m.id) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  // ─── OpenAI path ──────────────────────────────────────────────────────────

  private async openaiChat(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const body: ChatCompletionRequest = {
      ...req,
      model: this.config.model,
      max_tokens: req.max_tokens ?? this.config.maxTokens,
      temperature: req.temperature ?? this.config.temperature,
      top_p: req.top_p ?? this.config.topP,
      reasoning_effort: req.reasoning_effort ?? this.config.reasoningEffort,
      stream: false,
    };
    const resp = await this.openaiFetch(body, options);
    const json = await resp.json() as ChatCompletionResponse;
    return { ...json, usage: normalizeUsage(json.usage, this.cacheStrategy) };
  }

  private async *openaiChatStream(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): AsyncGenerator<StreamEvent> {
    const body: ChatCompletionRequest = {
      ...req,
      model: this.config.model,
      max_tokens: req.max_tokens ?? this.config.maxTokens,
      temperature: req.temperature ?? this.config.temperature,
      top_p: req.top_p ?? this.config.topP,
      reasoning_effort: req.reasoning_effort ?? this.config.reasoningEffort,
      stream: true,
    };
    const resp = await this.openaiFetch(body, options);
    const reader = resp.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: new Error('Response body is not readable') };
      return;
    }
    yield* parseOpenAIStream(reader, this.cacheStrategy);
  }

  private async openaiFetch(body: ChatCompletionRequest, options?: ModelRequestOptions): Promise<Response> {
    const url = `${this.baseUrl}/chat/completions`;
    const resp = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.baseHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    }, options);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI gateway error (${resp.status}): ${text.slice(0, 500)}`);
    }
    return resp;
  }

  // ─── Anthropic path ───────────────────────────────────────────────────────

  private async anthropicChat(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const anthroReq = convertToAnthropic(req, this.config, this.cacheStrategy);
    const resp = await this.anthropicFetch(anthroReq, options);
    const anthroResp = (await resp.json()) as AnthropicMessageResponse;
    return convertAnthropicResponse(anthroResp, this.config.model, this.cacheStrategy);
  }

  private async *anthropicChatStream(
    req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
    options?: ModelRequestOptions,
  ): AsyncGenerator<StreamEvent> {
    const anthroReq: AnthropicMessageRequest = {
      ...convertToAnthropic(req, this.config, this.cacheStrategy),
      stream: true,
    };
    const resp = await this.anthropicFetch(anthroReq, options);
    const reader = resp.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: new Error('Response body is not readable') };
      return;
    }
    yield* parseAnthropicStream(reader, this.cacheStrategy);
  }

  private async anthropicFetch(body: AnthropicMessageRequest, options?: ModelRequestOptions): Promise<Response> {
    const url = `${this.baseUrl}/messages`;
    const resp = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...this.baseHeaders(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    }, options);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic gateway error (${resp.status}): ${text.slice(0, 500)}`);
    }
    return resp;
  }

  private async fetchWithRetry(url: string, init: RequestInit, options?: ModelRequestOptions): Promise<Response> {
    const policy = {
      maxAttempts: Math.max(1, Math.floor(this.config.retry?.maxAttempts ?? 3)),
      initialDelayMs: Math.max(0, Math.floor(this.config.retry?.initialDelayMs ?? 300)),
      maxDelayMs: Math.max(0, Math.floor(this.config.retry?.maxDelayMs ?? 3_000)),
    };
    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        const response = await fetch(url, init);
        if (!isRetryableStatus(response.status) || attempt >= policy.maxAttempts) {
          return response;
        }
        lastError = new HttpRetryError(response.status);
      } catch (error) {
        lastError = error;
        if (!isRetryableFetchError(error) || attempt >= policy.maxAttempts) {
          throw error;
        }
      }
      const delayMs = backoffDelay(attempt, policy.initialDelayMs, policy.maxDelayMs);
      await options?.onRetry?.({
        attempt,
        maxAttempts: policy.maxAttempts,
        delayMs,
        status: lastError instanceof HttpRetryError ? lastError.status : undefined,
        error: lastError instanceof Error && !(lastError instanceof HttpRetryError) ? lastError.message : undefined,
      });
      await sleep(delayMs);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  // ─── Headers ──────────────────────────────────────────────────────────────

  private baseHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...this.config.extraHeaders };
    if (this.protocol === 'anthropic') {
      if (this.config.apiKey) h['x-api-key'] = this.config.apiKey;
    } else {
      if (this.config.apiKey) h['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }
}

class HttpRetryError extends Error {
  constructor(readonly status: number) {
    super(`retryable HTTP ${status}`);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  if (error instanceof Error) {
    return !/401|403|400|unauthorized|forbidden/i.test(error.message);
  }
  return true;
}

function backoffDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  if (initialDelayMs <= 0) return 0;
  return Math.min(maxDelayMs, initialDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function estimateChatTokens(messages: ChatMessage[]): TokenEstimate {
  let charCount = 0;
  let imageCount = 0;
  for (const message of messages) {
    charCount += message.role.length + 4;
    if (typeof message.content === 'string') {
      charCount += message.content.length;
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        charCount += part.text.length;
      } else if (part.type === 'image_url') {
        imageCount += 1;
        charCount += 85;
      }
    }
  }
  return {
    inputTokens: Math.max(1, Math.ceil(charCount / 4) + messages.length * 3 + imageCount * 85),
    messageCount: messages.length,
    imageCount,
    charCount,
  };
}

export function resolveCacheStrategy(
  config: Pick<ModelConfig, 'provider' | 'model' | 'cacheStrategy'>,
  protocol: 'openai' | 'anthropic' = protocolFor(config.provider),
): CacheStrategy {
  if (config.cacheStrategy && config.cacheStrategy !== 'auto') return config.cacheStrategy;
  const provider = config.provider.toLowerCase();
  const model = config.model.toLowerCase();
  if (provider.includes('deepseek') || model.includes('deepseek')) return 'deepseek-native';
  if (protocol === 'anthropic') return 'anthropic-cache-control';
  return 'openai-compatible';
}

export function normalizeUsage(raw: unknown, cacheStrategy?: CacheStrategy): NormalizedUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;
  const deepseekHit = numberField(usage.prompt_cache_hit_tokens);
  const deepseekMiss = numberField(usage.prompt_cache_miss_tokens);
  const promptTokens = deepseekHit || deepseekMiss
    ? deepseekHit + deepseekMiss
    : numberField(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = numberField(usage.completion_tokens ?? usage.output_tokens);
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details as Record<string, unknown>
    : {};
  const cachedTokens = deepseekHit
    || numberField(details.cached_tokens)
    || numberField(usage.cached_tokens)
    || numberField(usage.cache_read_input_tokens);
  const inferredStrategy = cacheStrategy ?? inferCacheStrategyFromUsage(usage);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: numberField(usage.total_tokens) || promptTokens + completionTokens,
    cached_tokens: cachedTokens,
    ...(inferredStrategy && inferredStrategy !== 'none' ? { cache_strategy: inferredStrategy } : {}),
  };
}

function inferCacheStrategyFromUsage(usage: Record<string, unknown>): CacheStrategy | undefined {
  if (numberField(usage.prompt_cache_hit_tokens) || numberField(usage.prompt_cache_miss_tokens)) return 'deepseek-native';
  if (numberField(usage.cache_read_input_tokens)) return 'anthropic-cache-control';
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details as Record<string, unknown>
    : {};
  if (numberField(details.cached_tokens) || numberField(usage.cached_tokens)) return 'openai-compatible';
  return undefined;
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

// ─── OpenAI → Anthropic Conversion ──────────────────────────────────────────

function convertToAnthropic(
  req: Omit<ChatCompletionRequest, 'model' | 'stream'>,
  config: ModelConfig,
  cacheStrategy: CacheStrategy = 'anthropic-cache-control',
): AnthropicMessageRequest {
  const messages = req.messages;
  let system: AnthropicMessageRequest['system'];

  // Extract system message
  const systemMsg = messages.find((m) => m.role === 'system');
  if (systemMsg) {
    const systemText = typeof systemMsg.content === 'string'
      ? systemMsg.content
      : systemMsg.content.map((c) => ('text' in c ? c.text : '')).join('\n');
    if (systemText) {
      system = cacheStrategy === 'anthropic-cache-control'
        ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
        : [{ type: 'text', text: systemText }];
    }
  }

  // Convert remaining messages
  const anthroMessages: AnthropicMessageRequest['messages'] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const blocks: AnthropicContentBlock[] = [];

    // Text content
    if (typeof msg.content === 'string') {
      blocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          blocks.push({
            type: 'text',
            text: `[Image: ${part.image_url.url}]`,
          });
        }
      }
    }

    // Tool calls (assistant message)
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    // Tool result (tool message)
    if (msg.role === 'tool' && msg.tool_call_id) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      blocks.push({
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: text,
      });
    }

    if (blocks.length === 0) continue;

    // Normalize role — Anthropic only allows 'user' | 'assistant'
    const role: 'user' | 'assistant' = msg.role === 'tool' ? 'user' : (msg.role as 'user' | 'assistant');

    // Merge consecutive same-role messages
    const last = anthroMessages[anthroMessages.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      anthroMessages.push({ role, content: blocks });
    }
  }

  if (cacheStrategy === 'anthropic-cache-control') {
    markLastUserTextBlockCacheable(anthroMessages);
  }

  // Convert tools
  const tools: AnthropicMessageRequest['tools'] = req.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: {
      type: 'object' as const,
      properties: (t.function.parameters as Record<string, unknown>)?.properties as Record<string, unknown> ?? {},
      required: (t.function.parameters as Record<string, unknown>)?.required as string[] | undefined,
    },
  }));

  return {
    model: config.model,
    system: system || undefined,
    messages: anthroMessages,
    tools,
    max_tokens: req.max_tokens ?? config.maxTokens ?? 8192,
    temperature: req.temperature ?? config.temperature,
    top_p: req.top_p ?? config.topP,
    stop_sequences: req.stop,
  };
}

function markLastUserTextBlockCacheable(messages: AnthropicMessageRequest['messages']): void {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== 'user') continue;
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = message.content[blockIndex];
      if (block.type !== 'text') continue;
      block.cache_control = { type: 'ephemeral' };
      return;
    }
  }
}

// ─── Anthropic → OpenAI Response Conversion ─────────────────────────────────
function convertAnthropicResponse(
  anthroResp: AnthropicMessageResponse,
  model: string,
  cacheStrategy: CacheStrategy,
): ChatCompletionResponse {
  const textBlocks = anthroResp.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;
  const toolUseBlocks = anthroResp.content.filter((b) => b.type === 'tool_use') as Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;

  const text = textBlocks.map((b) => b.text).join('\n');
  const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
    id: b.id,
    type: 'function' as const,
    function: {
      name: b.name,
      arguments: JSON.stringify(b.input),
    },
  }));

  return {
    id: anthroResp.id,
    object: 'chat.completion',
    created: Date.now(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: anthroResp.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      },
    ],
    usage: normalizeUsage(anthroResp.usage, cacheStrategy),
  };
}

// ─── Stream Parsers ─────────────────────────────────────────────────────────

async function* parseOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cacheStrategy: CacheStrategy,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { yield { type: 'done' }; continue; }

        try {
          const chunk = JSON.parse(data);
          for (const choice of chunk.choices ?? []) {
            const delta = choice.delta ?? {};
            if (delta.content) yield { type: 'delta', content: delta.content };
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                let entry = toolCalls.get(idx);
                if (!entry) { entry = { id: tc.id ?? '', name: '', args: '' }; toolCalls.set(idx, entry); }
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) { entry.name += tc.function.name; yield { type: 'tool_call_start', id: entry.id, name: entry.name }; }
                if (tc.function?.arguments) { entry.args += tc.function.arguments; yield { type: 'tool_call_delta', id: entry.id, arguments: entry.args }; }
              }
            }
            if (choice.finish_reason) {
              for (const [, tc] of toolCalls) {
                if (tc.name) yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: tc.args };
              }
              yield { type: 'done', usage: normalizeUsage(chunk.usage, cacheStrategy) };
            }
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
  } finally {
    reader.releaseLock();
  }
}

async function* parseAnthropicStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cacheStrategy: CacheStrategy,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
  let currentToolIndex = 0;
  let usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Anthropic SSE: "event: <type>" then "data: <json>"
        if (trimmed.startsWith('event: ')) continue;

        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const event = JSON.parse(data) as AnthropicSSEEvent;

          switch (event.type) {
            case 'message_start':
              if (event.message?.usage) usage = event.message.usage;
              break;

            case 'content_block_start': {
              const block = event.content_block;
              if (block?.type === 'tool_use') {
                const idx = currentToolIndex++;
                toolCalls.set(idx, { id: block.id, name: block.name, args: '' });
                yield { type: 'tool_call_start', id: block.id, name: block.name };
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (!delta) break;
              if (delta.type === 'text_delta' && delta.text) {
                yield { type: 'delta', content: delta.text };
              }
              if (delta.type === 'input_json_delta' && delta.partial_json) {
                // Find the current tool call being built
                const entry = toolCalls.get(currentToolIndex - 1);
                if (entry) {
                  entry.args += delta.partial_json;
                  yield { type: 'tool_call_delta', id: entry.id, arguments: entry.args };
                }
              }
              break;
            }

            case 'content_block_stop':
              // end of one content block
              break;

            case 'message_delta':
              if (event.usage) {
                usage = { ...(usage ?? { input_tokens: 0, output_tokens: 0 }), ...event.usage };
              }
              break;

            case 'message_stop':
              // Flush tool calls
              for (const [, tc] of toolCalls) {
                if (tc.name) {
                  yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: tc.args };
                }
              }
              yield {
                type: 'done',
                usage: normalizeUsage(usage, cacheStrategy),
              };
              break;

            case 'ping':
              break;
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
  } finally {
    reader.releaseLock();
  }
}
