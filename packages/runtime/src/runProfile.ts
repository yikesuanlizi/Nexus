import type { CompactOptions } from '@nexus/memory';

// 运行时配置风格：cache_first 偏爱保持 prompt 稳定以命中缓存；runtime_os 偏爱长对话可观测性与完整上下文
export type RunProfile = 'cache_first' | 'runtime_os';

// 规范化运行时 profile：非法值回退为 runtime_os
export function normalizeRunProfile(value: unknown): RunProfile {
  return value === 'cache_first' || value === 'runtime_os' ? value : 'runtime_os';
}

// 按 profile 返回自动压缩的阈值与策略：cache_first 更保守（更少压缩），runtime_os 更激进
export function compactionOptionsForRunProfile(profile: RunProfile): Pick<CompactOptions, 'softCompactRatio' | 'hardCompactRatio' | 'strategy'> {
  if (profile === 'cache_first') {
    return {
      softCompactRatio: 0.72,
      hardCompactRatio: 0.92,
      strategy: 'local',
    };
  }
  return {
    softCompactRatio: 0.5,
    hardCompactRatio: 0.8,
    strategy: 'llm',
  };
}
