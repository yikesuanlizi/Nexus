import { afterEach, describe, expect, it } from 'vitest';
import { estimateChatTokens, ModelGateway, normalizeUsage, resolveCacheStrategy } from './gateway.js';
import { getProviderProfile, resolveProviderProfile } from './providerProfiles.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('estimateChatTokens', () => {
  it('estimates tokens before sending a request', () => {
    const estimate = estimateChatTokens([
      { role: 'system', content: '你是一个本地编程助手。' },
      { role: 'user', content: [
        { type: 'text', text: '请总结这个文件' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ] },
    ]);

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.messageCount).toBe(2);
    expect(estimate.imageCount).toBe(1);
  });
});

describe('normalizeUsage', () => {
  it('reads DeepSeek native prompt cache hit and miss fields first', () => {
    expect(normalizeUsage({
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
      completion_tokens: 12,
    }, 'deepseek-native')).toEqual({
      prompt_tokens: 100,
      completion_tokens: 12,
      total_tokens: 112,
      cached_tokens: 80,
      cache_strategy: 'deepseek-native',
    });
  });

  it('falls back to OpenAI cached_tokens details', () => {
    expect(normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 8,
      total_tokens: 108,
      prompt_tokens_details: { cached_tokens: 60 },
    }, 'openai-compatible')).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 8,
      cached_tokens: 60,
      cache_strategy: 'openai-compatible',
    });
  });

  it('falls back to Anthropic cache read input tokens', () => {
    expect(normalizeUsage({
      input_tokens: 90,
      output_tokens: 10,
      cache_read_input_tokens: 70,
    }, 'anthropic-cache-control')).toEqual({
      prompt_tokens: 90,
      completion_tokens: 10,
      total_tokens: 100,
      cached_tokens: 70,
      cache_strategy: 'anthropic-cache-control',
    });
  });
});

describe('resolveCacheStrategy', () => {
  it('uses DeepSeek native cache accounting for DeepSeek providers and models', () => {
    expect(resolveCacheStrategy({ provider: 'deepseek', model: 'deepseek-v4-pro' })).toBe('deepseek-native');
    expect(resolveCacheStrategy({ provider: 'openai_compatible', model: 'deepseek-chat' })).toBe('deepseek-native');
  });

  it('uses OpenAI-compatible cache accounting for compatible providers by default', () => {
    expect(resolveCacheStrategy({ provider: 'openai', model: 'gpt-5' })).toBe('openai-compatible');
    expect(resolveCacheStrategy({ provider: 'openai_compatible', model: 'qwen-plus' })).toBe('openai-compatible');
  });

  it('allows explicit cache strategy overrides including disabling cache accounting', () => {
    expect(resolveCacheStrategy({ provider: 'deepseek', model: 'deepseek-chat', cacheStrategy: 'openai-compatible' })).toBe('openai-compatible');
    expect(resolveCacheStrategy({ provider: 'deepseek', model: 'deepseek-chat', cacheStrategy: 'none' })).toBe('none');
  });
});

describe('provider profiles', () => {
  it('maps MiniMax to Anthropic Messages with MiniMax reasoning mode', () => {
    const profile = getProviderProfile('minimax');
    expect(profile).toMatchObject({
      id: 'minimax',
      endpointFormat: 'anthropic_messages',
      transport: 'anthropic_messages',
      reasoningMode: 'minimax_anthropic_thinking',
      toolHistoryMode: 'anthropic_blocks',
      cacheMode: 'anthropic_cache_control',
    });
  });

  it('maps DeepSeek to Chat Completions with native reasoning and cache modes', () => {
    const profile = getProviderProfile('deepseek');
    expect(profile).toMatchObject({
      id: 'deepseek',
      endpointFormat: 'chat_completions',
      transport: 'openai_chat_completions',
      reasoningMode: 'deepseek_reasoning_content',
      toolHistoryMode: 'openai_chat',
      cacheMode: 'deepseek_native',
    });
  });

  it('resolves unknown providers to generic OpenAI-compatible behavior', () => {
    const profile = resolveProviderProfile({
      provider: 'my_gateway',
      baseUrl: 'https://example.test/v1',
      model: 'custom-model',
    });
    expect(profile.id).toBe('my_gateway');
    expect(profile.endpointFormat).toBe('chat_completions');
    expect(profile.reasoningMode).toBe('none');
    expect(profile.toolHistoryMode).toBe('openai_chat');
  });
});

describe('ModelGateway retry policy', () => {
  it('normalizes provider, model, and baseUrl before selecting protocol and credentials', () => {
    const gateway = new ModelGateway({
      provider: ' minimax ',
      model: '\tMiniMax-M3 ',
      baseUrl: ' https://api.minimaxi.com/anthropic/v1 ',
    });

    expect((gateway as unknown as { protocol: string }).protocol).toBe('anthropic');
    expect((gateway as unknown as { config: { provider: string; model: string; baseUrl: string } }).config).toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M3',
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    });
  });

  it('adds Anthropic cache control to the last system block and final user message', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'msg-test',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 8 },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'anthropic',
      baseUrl: 'http://anthropic.test/v1',
      model: 'claude-test',
    });

    await gateway.chat({
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'user', content: 'hello' },
      ],
    });

    expect(requestBody).toMatchObject({
      system: [{ type: 'text', text: 'stable system', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
        },
      ],
    });
  });

  it('does not add Anthropic cache control when cache strategy is disabled', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'msg-test',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'anthropic',
      baseUrl: 'http://anthropic.test/v1',
      model: 'claude-test',
      cacheStrategy: 'none',
    });

    await gateway.chat({
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'user', content: 'hello' },
      ],
    });

    expect(JSON.stringify(requestBody)).not.toContain('cache_control');
  });

  it('retries retryable OpenAI-compatible failures and returns the successful response', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'openai_compatible',
      baseUrl: 'http://example.test/v1',
      model: 'test-model',
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
    });

    const retryNotices: Array<{ attempt: number; status?: number }> = [];
    const response = await gateway.chat(
      { messages: [{ role: 'user', content: 'hello' }] },
      { onRetry: (notice) => {
        retryNotices.push({ attempt: notice.attempt, status: notice.status });
      } },
    );

    expect(attempts).toBe(3);
    expect(retryNotices).toEqual([{ attempt: 1, status: 429 }, { attempt: 2, status: 429 }]);
    expect(response.choices[0]?.message.content).toBe('ok');
  });

  it('does not retry non-retryable authentication failures', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return new Response('unauthorized', { status: 401 });
    };

    const gateway = new ModelGateway({
      provider: 'openai_compatible',
      baseUrl: 'http://example.test/v1',
      model: 'test-model',
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
    });

    await expect(gateway.chat({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow('401');
    expect(attempts).toBe(1);
  });

  it('propagates caller abort signals into OpenAI-compatible fetch requests', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_url, init) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      controller.abort('stop requested');
      throw new DOMException('Aborted', 'AbortError');
    };

    const gateway = new ModelGateway({
      provider: 'openai_compatible',
      baseUrl: 'http://example.test/v1',
      model: 'test-model',
      retry: { maxAttempts: 1 },
    });

    await expect(gateway.chat(
      { messages: [{ role: 'user', content: 'hello' }] },
      { signal: controller.signal },
    )).rejects.toThrow('Aborted');

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
  });
});
