import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('useRightPaneSizing', () => {
  it('keeps activity and agents compact while files can use a wide preview pane', () => {
    const source = readFileSync(join(here, 'uiState.ts'), 'utf-8');

    expect(source).toContain("export type RightPaneSizingMode = 'standard' | 'files' | 'workflow'");
    expect(source).not.toContain('RightPaneTab');
    expect(source).toContain('function defaultStandardPaneWidth(): number');
    expect(source).toContain('return 348;');
    expect(source).toContain('function defaultFilesPaneWidth(): number');
    expect(source).toContain("localStorage.getItem('nexus.standardPaneWidth')");
    expect(source).toContain("localStorage.getItem('nexus.filesPaneWidth')");
    expect(source).not.toContain('[mode, tab]');
  });
});