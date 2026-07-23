import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('useRightPaneSizing', () => {
  it('keeps pane width stable across workbench tab changes', () => {
    const source = readFileSync(join(here, 'uiState.ts'), 'utf-8');

    expect(source).toContain("useRightPaneSizing(visible: boolean, mode: 'standard' | 'workflow' = 'standard')");
    expect(source).not.toContain('RightPaneTab');
    expect(source).not.toContain("tab === 'files'");
    expect(source).not.toContain('defaultFilesPaneWidth');
    expect(source).not.toContain('[mode, tab]');
  });
});
