import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('SSH profile removal confirmation', () => {
  it('opens the shared confirmation panel before issuing DELETE', () => {
    const source = readFileSync(join(here, 'SshProfilesPage.tsx'), 'utf-8');
    expect(source).toContain('setPendingDelete(profile)');
    expect(source).toContain('<ConfirmPanel');
    expect(source).toContain('onCancel={() => setPendingDelete(null)}');
    expect(source).toContain("cancel sends no DELETE request");
    expect(source).not.toContain('window.confirm');
  });
});
