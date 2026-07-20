import type { CompactOptions } from '@nexus/memory';

/**
 * RunProfile — 用户可选的运行模式。
 *
 * harness 不再是 RunProfile，已降级为 runtime 底座的约束/证据/验收层。
 * 旧配置里如果出现 'harness'，normalizeRunProfile 会自动降级为 'runtime_os'。
 *
 * 详见整顿计划：harness 是 runtime subsystem，不是 profile。
 */
export type RunProfile = 'cache_first' | 'runtime_os';

/**
 * 规范化 RunProfile。
 *
 * - 'cache_first' / 'runtime_os' 原样返回
 * - 旧值 'harness' 自动降级为 'runtime_os'（harness 不再是 profile）
 * - 其他未知值回退为 'runtime_os'
 *
 * 这样保证历史配置不会因为类型收紧而崩。
 */
export function normalizeRunProfile(value: unknown): RunProfile {
  if (value === 'cache_first' || value === 'runtime_os') return value;
  if (value === 'harness') return 'runtime_os';
  return 'runtime_os';
}

export function compactionOptionsForRunProfile(profile: RunProfile): Pick<CompactOptions, 'softCompactRatio' | 'hardCompactRatio' | 'strategy'> {
  if (profile === 'cache_first') {
    return {
      softCompactRatio: 0.72,
      hardCompactRatio: 0.92,
      strategy: 'local',
    };
  }
  // runtime_os：长运行策略，更早压缩，LLM 摘要
  // 注意：harness 不再是 profile，其原本的压缩参数已合并到 runtime_os
  return {
    softCompactRatio: 0.5,
    hardCompactRatio: 0.8,
    strategy: 'llm',
  };
}

export function contextBudgetForRunProfile(profile: RunProfile): number {
  if (profile === 'cache_first') return 6000;
  // runtime_os：长运行任务需要更大上下文预算
  // harness 原本的 10000 预算已并入 runtime_os
  return 8000;
}
