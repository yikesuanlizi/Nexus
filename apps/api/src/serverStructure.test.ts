import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server module structure', () => {
  it('keeps server.ts focused on routing and shared wiring', () => {
    const source = readFileSync(join(process.cwd(), 'apps/api/src/server.ts'), 'utf-8');
    expect(source.split('\n').length).toBeLessThanOrEqual(790);
    expect(source).toContain('handleCompactThread');
  });

  it('creates workflow project shells without requiring a saved workflow definition', () => {
    const source = readFileSync(join(process.cwd(), 'apps/api/src/server.ts'), 'utf-8');
    expect(source).toContain('workflowProject?: boolean');
    expect(source).toContain("body.workflowProject ? { workflowProject: 'true' } : {}");
  });
});
