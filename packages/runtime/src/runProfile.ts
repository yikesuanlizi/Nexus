import type { CompactOptions } from '@nexus/memory';

// 运行时配置风格：
// - cache_first 偏爱保持 prompt 稳定以命中缓存
// - runtime_os 偏爱长对话可观测性与完整上下文
// - harness 自主循环：更早压缩 + LLM 语义压缩，配合 HarnessContextManager 做四层裁切
export type RunProfile = 'cache_first' | 'runtime_os' | 'harness';

// 规范化运行时 profile：非法值回退为 runtime_os
export function normalizeRunProfile(value: unknown): RunProfile {
  return value === 'cache_first' || value === 'runtime_os' || value === 'harness' ? value : 'runtime_os';
}

// 按 profile 返回自动压缩的阈值与策略：
// - cache_first 更保守（更少压缩）
// - runtime_os 更激进
// - harness 更早压缩 + LLM 语义压缩（soft=0.4, hard=0.7）
export function compactionOptionsForRunProfile(profile: RunProfile): Pick<CompactOptions, 'softCompactRatio' | 'hardCompactRatio' | 'strategy'> {
  if (profile === 'cache_first') {
    return {
      softCompactRatio: 0.72,
      hardCompactRatio: 0.92,
      strategy: 'local',
    };
  }
  if (profile === 'harness') {
    return {
      softCompactRatio: 0.4,   // 更早压缩
      hardCompactRatio: 0.7,   // 更早硬压缩
      strategy: 'llm',         // LLM 语义压缩
    };
  }
  return {
    softCompactRatio: 0.5,
    hardCompactRatio: 0.8,
    strategy: 'llm',
  };
}
