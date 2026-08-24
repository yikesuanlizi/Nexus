import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('OpsTaskAnchorCard', () => {
  it('provides a main-thread fallback for hidden inspector actions', () => {
    const source = readFileSync(join(import.meta.dirname, 'OpsTaskAnchorCard.tsx'), 'utf8');
    expect(source).toContain("onAction('confirm')");
    expect(source).toContain("onAction('reject_continue')");
    expect(source).toContain("onAction('update_scope')");
    expect(source).toContain("onAction('cancel')");
  });
});
