import { describe, expect, it } from 'vitest';
import { compactionOptionsForModelContext } from './runProfile.js';

describe('compactionOptionsForModelContext', () => {
  it('uses the current model context window as the compaction max token budget', () => {
    expect(compactionOptionsForModelContext('runtime_os', 1_000_000)).toMatchObject({
      maxTokens: 1_000_000,
      softCompactRatio: 0.5,
      hardCompactRatio: 0.8,
    });
  });

  it('falls back to legacy default compact options when the model window is unknown', () => {
    expect(compactionOptionsForModelContext('runtime_os', undefined)).not.toHaveProperty('maxTokens');
  });
});
