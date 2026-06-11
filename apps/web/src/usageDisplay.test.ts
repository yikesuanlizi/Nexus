import { describe, expect, it } from 'vitest';
import { formatCacheDiagnostics, formatCompactionPressure, formatThreadTokenSummary, formatTokenSummary } from './usageDisplay.js';

describe('formatTokenSummary', () => {
  it('shows cached input tokens and hit rate in Chinese', () => {
    expect(formatTokenSummary({
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 0,
    }, 'zh')).toBe('Token：输入 100，缓存 80，命中率 80%，输出 20');
  });

  it('names DeepSeek cache hits when the usage carries a DeepSeek strategy', () => {
    expect(formatTokenSummary({
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      cacheStrategy: 'deepseek-native',
    }, 'zh')).toBe('Token：输入 100，DeepSeek 缓存 80，命中率 80%，输出 20');
  });

  it('keeps English token text compact', () => {
    expect(formatTokenSummary({
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
    }, 'en')).toBe('Tokens: input 50, cache 0, hit 0%, output 10');
  });

  it('separates latest turn cache hit rate from cumulative usage', () => {
    expect(formatThreadTokenSummary({
      threadId: 'thread-1',
      turns: [
        {
          turnId: 'turn-1',
          timestamp: '2026-06-11T00:00:00.000Z',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 50,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            cacheStrategy: 'deepseek-native',
          },
        },
        {
          turnId: 'turn-2',
          timestamp: '2026-06-11T00:01:00.000Z',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 90,
            outputTokens: 12,
            reasoningOutputTokens: 0,
            cacheStrategy: 'deepseek-native',
          },
        },
      ],
      total: {
        inputTokens: 200,
        cachedInputTokens: 140,
        outputTokens: 22,
        reasoningOutputTokens: 0,
        cacheStrategy: 'deepseek-native',
      },
      updatedAt: '2026-06-11T00:01:00.000Z',
    }, 'zh')).toBe('Token：本轮 输入 100，DeepSeek 缓存 90，命中率 90%，输出 12；累计 输入 200，缓存 140，命中率 70%，输出 22');
  });

  it('formats cache diagnostics without exposing long hashes', () => {
    expect(formatCacheDiagnostics({
      stable: false,
      reasons: ['system', 'tools'],
      shape: { prefixHash: 'abcdef1234567890' },
    }, 'zh')).toBe('缓存前缀变化：system、tools · abcdef12');
  });

  it('formats soft compaction pressure as a warning', () => {
    expect(formatCompactionPressure({
      status: 'soft',
      estimatedTokens: 600,
      hardThreshold: 800,
    }, 'zh')).toBe('上下文接近压缩阈值：600/800');
  });
});
