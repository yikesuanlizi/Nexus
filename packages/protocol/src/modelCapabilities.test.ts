import { describe, expect, it } from 'vitest';
import { resolveModelCapabilities } from './modelCapabilities.js';

describe('resolveModelCapabilities', () => {
  it('uses explicit configured context tokens before model heuristics', () => {
    expect(resolveModelCapabilities({
      provider: 'minimax',
      model: 'MiniMax-M3',
      modelContextTokens: 128_000,
      modelMaxOutputTokens: 16_000,
    })).toMatchObject({
      contextTokens: 128_000,
      maxOutputTokens: 16_000,
      contextSource: 'configured',
      outputSource: 'configured',
    });
  });

  it('recognizes MiniMax M3 even when routed through OpenAI-compatible config', () => {
    expect(resolveModelCapabilities({
      provider: 'openai_compatible',
      model: 'MiniMax-M3',
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    })).toMatchObject({
      contextTokens: 1_000_000,
      contextSource: 'known-model',
      matchedRule: 'minimax-m3',
    });
  });

  it('recognizes DeepSeek V4 million-token models', () => {
    expect(resolveModelCapabilities({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })).toMatchObject({
      contextTokens: 1_000_000,
      maxOutputTokens: 384_000,
      matchedRule: 'deepseek-v4',
    });
  });

  it('recognizes GLM 4.7 through custom Gitee-compatible routing', () => {
    expect(resolveModelCapabilities({
      provider: 'openai_compatible',
      model: 'GLM-4.7-Flash',
      baseUrl: 'https://ai.gitee.com/v1',
    })).toMatchObject({
      contextTokens: 200_000,
      maxOutputTokens: 128_000,
      matchedRule: 'glm-4.7',
    });
  });

  it('leaves unknown local models unresolved instead of pretending a fixed window', () => {
    expect(resolveModelCapabilities({
      provider: 'ollama',
      model: 'some-local-model',
    })).toMatchObject({
      contextTokens: undefined,
      contextSource: 'unknown',
    });
  });
});
