import { afterEach, describe, expect, it } from 'vitest';
import {
  convertOpenAIResponseForTest,
  estimateChatTokens,
  ModelGateway,
  normalizeUsage,
  resolveCacheStrategy,
} from './gateway.js';
import { getProviderProfile, resolveProviderProfile } from './providerProfiles.js';
import {
  buildAnthropicToolHistory,
  buildOpenAiChatToolHistory,
  type ProviderAssistantFrame,
} from './providerFrames.js';

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

  it('normalizes OpenAI-compatible usage from the first choice when top-level usage is missing', () => {
    const response = convertOpenAIResponseForTest({
      id: 'cmpl_choice_usage',
      object: 'chat.completion',
      created: 1,
      model: 'kimi-k3',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
      }],
    });

    expect(response.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      cached_tokens: 0,
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
  it('maps OpenAI to Chat Completions until Responses transport is implemented', () => {
    const profile = getProviderProfile('openai');
    expect(profile).toMatchObject({
      id: 'openai',
      endpointFormat: 'chat_completions',
      transport: 'openai_chat_completions',
      reasoningMode: 'none',
      toolHistoryMode: 'openai_chat',
      cacheMode: 'openai_prompt_details',
    });
  });

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

  it('has explicit OpenAI-compatible profiles for supported remote adapters', () => {
    const providerIds = [
      'gemini',
      'mistral',
      'perplexity',
      'xai',
      'qwen',
      'zhipu',
      'kimi',
      'volcengine',
      'baidu',
      'siliconflow',
      'groq',
      'together',
      'openrouter',
    ];

    for (const providerId of providerIds) {
      expect(getProviderProfile(providerId)).toMatchObject({
        id: providerId,
        endpointFormat: 'chat_completions',
        transport: 'openai_chat_completions',
        reasoningMode: 'none',
        toolHistoryMode: 'openai_chat',
        cacheMode: 'openai_prompt_details',
      });
    }
  });

  it('normalizes provider aliases before resolving profiles', () => {
    expect(getProviderProfile('google')).toMatchObject({
      id: 'gemini',
      displayName: 'Google Gemini',
    });
    expect(getProviderProfile('grok')).toMatchObject({
      id: 'xai',
      displayName: 'xAI',
    });
    expect(getProviderProfile('moonshot')).toMatchObject({
      id: 'kimi',
      displayName: 'Kimi (Moonshot)',
    });
    expect(getProviderProfile('dashscope')).toMatchObject({
      id: 'qwen',
      displayName: '通义千问 (Qwen)',
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

describe('provider frames', () => {
  it('replays OpenAI chat tool calls without text placeholders', () => {
    const frame: ProviderAssistantFrame = {
      format: 'openai_chat',
      content: null,
      toolCalls: [{
        id: 'call_read_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
      }],
    };
    const messages = buildOpenAiChatToolHistory(frame, [{
      modelToolCallId: 'call_read_1',
      output: 'file text',
    }]);
    expect(JSON.stringify(messages)).not.toContain('[Tool');
    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: frame.toolCalls,
      },
      {
        role: 'tool',
        tool_call_id: 'call_read_1',
        content: 'file text',
      },
    ]);
  });

  it('replays Anthropic tool_use and tool_result blocks without text placeholders', () => {
    const frame: ProviderAssistantFrame = {
      format: 'anthropic_messages',
      contentBlocks: [{
        type: 'tool_use',
        id: 'toolu_1',
        name: 'read_file',
        input: { path: 'a.txt' },
      }],
    };
    const messages = buildAnthropicToolHistory(frame, [{
      modelToolCallId: 'toolu_1',
      output: 'file text',
    }]);
    expect(JSON.stringify(messages)).not.toContain('[Tool');
    expect(messages).toEqual([
      {
        role: 'assistant',
        content: frame.contentBlocks,
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'file text',
        }],
      },
    ]);
  });
});

describe('MiniMax and DeepSeek provider behavior', () => {
  it('adds MiniMax Anthropic diagnostics without switching to OpenAI placeholders', () => {
    const gateway = new ModelGateway({
      provider: 'minimax',
      model: 'MiniMax-M3',
      baseUrl: '',
      apiKey: 'test',
    });

    expect((gateway as unknown as { profile: { endpointFormat: string; reasoningMode: string } }).profile).toMatchObject({
      endpointFormat: 'anthropic_messages',
      reasoningMode: 'minimax_anthropic_thinking',
    });
  });

  it('sends MiniMax M3 through Anthropic-compatible messages with bearer auth and adaptive thinking', async () => {
    let requestUrl = '';
    let requestHeaders: Headers | undefined;
    let requestBody: unknown;
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'msg_minimax',
        type: 'message',
        role: 'assistant',
        model: 'MiniMax-M3',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      apiKey: 'minimax-key',
      model: 'MiniMax-M3',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestUrl).toBe('https://api.minimaxi.com/anthropic/v1/messages');
    expect(requestHeaders?.get('Authorization')).toBe('Bearer minimax-key');
    expect(requestHeaders?.has('x-api-key')).toBe(false);
    expect(requestBody).toMatchObject({
      model: 'MiniMax-M3',
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
        },
      ],
    });
  });

  it('does not send Anthropic tool_result blocks after an intervening user message', async () => {
    let requestBody: { messages?: Array<{ role: string; content: unknown[] }> } = {};
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'msg_anthropic',
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
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-key',
      model: 'claude-test',
    });

    await gateway.chat({
      messages: [
        {
          role: 'assistant',
          content: '',
          providerFrame: {
            format: 'anthropic_messages',
            contentBlocks: [{ type: 'tool_use', id: 'toolu_read_1', name: 'read_file', input: { path: 'a.txt' } }],
          },
        },
        { role: 'user', content: '新的用户消息插入了工具结果之前' },
        { role: 'tool', tool_call_id: 'toolu_read_1', content: 'file text' },
        { role: 'user', content: '继续' },
      ],
    });

    expect(JSON.stringify(requestBody.messages)).not.toContain('tool_result');
  });

  it('streams MiniMax thinking blocks as reasoning deltas instead of assistant text', async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          'event: message_start',
          'data: {"type":"message_start","message":{"id":"msg_minimax_stream","type":"message","role":"assistant","model":"MiniMax-M3","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig"}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"need a tool"}}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"final"}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n')));
        controller.close();
      },
    }));

    const gateway = new ModelGateway({
      provider: 'minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      apiKey: 'test',
      model: 'MiniMax-M3',
    });

    const events = [];
    for await (const event of gateway.chatStream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'reasoning_delta', content: 'need a tool' });
    expect(events).toContainEqual({ type: 'delta', content: 'final' });
    expect(events).not.toContainEqual({ type: 'delta', content: 'need a tool' });
  });

  it('preserves DeepSeek reasoning_content in normalized OpenAI responses', () => {
    const response = convertOpenAIResponseForTest({
      id: 'cmpl_1',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'answer',
          reasoning_content: 'private reasoning summary',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_cache_hit_tokens: 10,
        prompt_cache_miss_tokens: 30,
        completion_tokens: 5,
      },
    }, 'deepseek-native');
    expect(response.choices[0].message.reasoning_content).toBe('private reasoning summary');
    expect(response.usage).toMatchObject({
      prompt_tokens: 40,
      completion_tokens: 5,
      cached_tokens: 10,
      cache_strategy: 'deepseek-native',
    });
  });

  it('sends DeepSeek thinking controls in provider-native request shape', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_deepseek',
        object: 'chat.completion',
        created: 1,
        model: 'deepseek-v4-pro',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 2, completion_tokens: 3 },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.test',
      apiKey: 'test',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'xhigh',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: {
        type: 'enabled',
        reasoning_effort: 'max',
      },
    });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
  });

  it('adds OpenRouter app attribution headers while preserving caller overrides', async () => {
    let requestHeaders: Headers | undefined;
    globalThis.fetch = async (_url, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        id: 'cmpl_openrouter',
        object: 'chat.completion',
        created: 1,
        model: 'openai/gpt-5.2',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      model: 'openai/gpt-5.2',
      extraHeaders: { 'X-OpenRouter-Title': 'User Title' },
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestHeaders?.get('HTTP-Referer')).toBe('https://github.com/nexus-agent/nexus');
    expect(requestHeaders?.get('X-OpenRouter-Title')).toBe('User Title');
    expect(requestHeaders?.get('X-OpenRouter-Categories')).toBe('productivity,developer-tools,local-first');
  });

  it('sends Mistral parallel tool call control in the official chat request shape', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_mistral',
        object: 'chat.completion',
        created: 1,
        model: 'mistral-large-latest',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: 'mistral-key',
      model: 'mistral-large-latest',
    });

    await gateway.chat({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look up data',
          parameters: { type: 'object', properties: {} },
        },
      }],
    });

    expect(requestBody).toMatchObject({ parallel_tool_calls: true });
  });

  it('normalizes Kimi reasoning effort to official low/high/max values', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_kimi',
        object: 'chat.completion',
        created: 1,
        model: 'kimi-k3',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      apiKey: 'kimi-key',
      model: 'kimi-k3',
      reasoningEffort: 'xhigh',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({ reasoning_effort: 'max' });
    expect(requestBody).not.toHaveProperty('thinking');
  });

  it('maps Qwen reasoning effort to DashScope enable_thinking instead of OpenAI reasoning_effort', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_qwen',
        object: 'chat.completion',
        created: 1,
        model: 'qwen3-coder-plus',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'dashscope-key',
      model: 'qwen3-coder-plus',
      reasoningEffort: 'high',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({ enable_thinking: true });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
    expect(requestBody).not.toHaveProperty('thinking');
  });

  it('disables Qwen thinking for explicit low or disabled reasoning effort', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_qwen',
        object: 'chat.completion',
        created: 1,
        model: 'qwen3-coder-plus',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'dashscope-key',
      model: 'qwen3-coder-plus',
      reasoningEffort: 'disabled',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({ enable_thinking: false });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
  });

  it('uses GLM thinking controls and streaming tool-call flag for Zhipu models that support them', async () => {
    let requestBody: unknown;
    const encoder = new TextEncoder();
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }));
    };

    const gateway = new ModelGateway({
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'glm-key',
      model: 'glm-4.6',
      reasoningEffort: 'high',
    });

    const events = [];
    for await (const event of gateway.chatStream({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look up data',
          parameters: { type: 'object', properties: {} },
        },
      }],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'done' });
    expect(requestBody).toMatchObject({
      thinking: { type: 'enabled', clear_thinking: true },
      tool_stream: true,
    });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
  });

  it('keeps GLM-5.2 reasoning_effort while using GLM thinking controls', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_glm',
        object: 'chat.completion',
        created: 1,
        model: 'glm-5.2',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'glm-key',
      model: 'glm-5.2',
      reasoningEffort: 'xhigh',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({
      thinking: { type: 'enabled', clear_thinking: true },
      reasoning_effort: 'xhigh',
    });
  });

  it('routes DeepSeek models on Ark through DeepSeek native thinking controls', async () => {
    let requestBody: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'cmpl_ark_deepseek',
        object: 'chat.completion',
        created: 1,
        model: 'deepseek-v4-pro',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }));
    };

    const gateway = new ModelGateway({
      provider: 'volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-key',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'xhigh',
    });

    await gateway.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(requestBody).toMatchObject({
      thinking: {
        type: 'enabled',
        reasoning_effort: 'max',
      },
    });
    expect(requestBody).not.toHaveProperty('reasoning_effort');
  });

  it('streams DeepSeek reasoning_content as reasoning deltas instead of assistant text', async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        [
          'data: {"choices":[{"delta":{"reasoning_content":"plan first"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"answer"}}]}',
          '',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_cache_hit_tokens":2,"prompt_cache_miss_tokens":3,"completion_tokens":4}}',
          '',
          'data: [DONE]',
          '',
        ].forEach((line) => controller.enqueue(encoder.encode(`${line}\n`)));
        controller.close();
      },
    }));

    const gateway = new ModelGateway({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.test',
      apiKey: 'test',
      model: 'deepseek-v4-pro',
    });

    const events = [];
    for await (const event of gateway.chatStream({ messages: [{ role: 'user', content: 'hello' }] })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'reasoning_delta', content: 'plan first' });
    expect(events).toContainEqual({ type: 'delta', content: 'answer' });
    expect(events).not.toContainEqual({ type: 'delta', content: 'plan first' });
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
