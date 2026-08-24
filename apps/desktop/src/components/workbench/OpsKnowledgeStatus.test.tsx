import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('knowledge base removal confirmation', () => {
  it('uses the shared compact modal and leaves source files untouched', () => {
    const source = readFileSync(join(here, 'OpsKnowledgeStatus.tsx'), 'utf-8');
    expect(source).toContain('setPendingDelete(entry)');
    expect(source).toContain('<ConfirmPanel');
    expect(source).toContain('onCancel={() => setPendingDelete(null)}');
    expect(source).toContain('不删除原始文件');
    expect(source).toContain('cancel sends no DELETE request');
    expect(source).not.toContain('window.confirm');
  });
});
