import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpsTaskInspector', () => {
  it('only exposes local test controls while the task can still execute', () => {
    const source = readFileSync(join(import.meta.dirname, 'OpsTaskInspector.tsx'), 'utf8');

    expect(source).toContain("const canRunLocalTest = task.spec.allowLocalTest && ['queued', 'running', 'paused', 'verifying', 'blocked'].includes(task.state)");
    expect(source).toContain('{canRunLocalTest ? (');
    expect(source).toContain("{task.spec.allowLocalTest ? (");
    expect(source).toContain('testRuns.length > 0');
  });
});
