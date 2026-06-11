import type { CompactOptions } from '@nexus/memory';

export type RunProfile = 'cache_first' | 'runtime_os';

export function normalizeRunProfile(value: unknown): RunProfile {
  return value === 'cache_first' || value === 'runtime_os' ? value : 'runtime_os';
}

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
