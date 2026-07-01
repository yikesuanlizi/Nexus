import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('workspace files layout', () => {
  it('stretches the preview card to the full right-pane height', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');
    const bodyStyles = styles.slice(styles.indexOf('.workspaceFileBody {'), styles.indexOf('.workspaceFileTreePane,'));
    const previewPaneStyles = styles.slice(styles.indexOf('.workspacePreviewPane {'), styles.indexOf('.workspaceFileSearch'));
    const noTabsStyles = styles.slice(styles.indexOf('.workspacePreviewPane.noPreviewTabs'), styles.indexOf('.workspacePreviewTabs'));
    const previewStart = styles.indexOf('.workspacePreview {', styles.indexOf('.workspaceFileRow:hover'));
    const previewStyles = styles.slice(previewStart, styles.indexOf('.workspacePreviewPane.noPreviewTabs', previewStart));

    expect(bodyStyles).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(bodyStyles).toContain('align-items: stretch;');
    expect(previewPaneStyles).toContain('align-content: stretch;');
    expect(previewPaneStyles).toContain('height: 100%;');
    expect(noTabsStyles).toContain('grid-template-rows: minmax(0,1fr);');
    expect(previewStyles).toContain('align-self: stretch;');
    expect(previewStyles).toContain('min-height: 100%;');
    expect(noTabsStyles).toContain('display: flex;');
    expect(noTabsStyles).toContain('flex-direction: column;');
    expect(noTabsStyles).toContain('flex: 1 1 auto;');
    expect(noTabsStyles).toContain('min-height: 0;');
    expect(styles).toContain('display: block;');
    expect(styles).toContain('margin: 0;');
    expect(styles).toContain('max-height: none;');
  });

  it('keeps the file preview inside the right pane at compact widths', () => {
    const component = readFileSync(join(here, 'components', 'WorkspaceFilesPanel.tsx'), 'utf-8');

    expect(component).toContain('minmax(180px, ${treeWidth}%) 7px minmax(0, 1fr)');
  });
});
