import type { CompactOptions } from '@nexus/memory';

export type RunProfile = 'cache_first' | 'runtime_os' | 'harness';

export function normalizeRunProfile(value: unknown): RunProfile {
  return value === 'cache_first' || value === 'runtime_os' || value === 'harness' ? value : 'runtime_os';
}

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
      softCompactRatio: 0.4,
      hardCompactRatio: 0.7,
      strategy: 'llm',
    };
  }
  return {
    softCompactRatio: 0.5,
    hardCompactRatio: 0.8,
    strategy: 'llm',
  };
}

export function contextBudgetForRunProfile(profile: RunProfile): number {
  if (profile === 'cache_first') return 6000;
  if (profile === 'harness') return 10000;
  return 8000;
}
