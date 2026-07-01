import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('right pane sizing', () => {
  it('keeps only usability floor widths instead of narrow viewport-ratio clamps', () => {
    const source = readFileSync(join(here, 'shared', 'uiState.ts'), 'utf-8');

    expect(source).toContain('const RIGHT_PANE_MAIN_MIN = 220;');
    expect(source).toContain('const STANDARD_RIGHT_PANE_MIN = 220;');
    expect(source).toContain('const FILES_RIGHT_PANE_MIN = 260;');
    expect(source).toContain('rightPaneAvailableMax()');
    expect(source).toContain('calc(100vw - 240px)');
    expect(source).not.toContain('55vw');
    expect(source).not.toContain('62vw');
  });

  it('lets workflow projects resize below and above the old half-screen band', () => {
    const source = readFileSync(join(here, 'shared', 'uiState.ts'), 'utf-8');

    expect(source).toContain('const WORKFLOW_RIGHT_PANE_MIN = 300;');
    expect(source).toContain('defaultWorkflowPaneWidth');
    expect(source).toContain('clampRightPaneWidth(stored || defaultWorkflowPaneWidth(), WORKFLOW_RIGHT_PANE_MIN)');
    expect(source).toContain("const resizeMin = mode === 'workflow' ? WORKFLOW_RIGHT_PANE_MIN : rightPaneMinForTab(tab);");
    expect(source).toContain('minmax(${RIGHT_PANE_MAIN_MIN}px, 1fr) 7px minmax(${rightPaneMin}px, min(${width}px, calc(100vw - 240px)))');
    expect(source).not.toContain('workflowPaneWidthForTwoThirds');
  });
});
