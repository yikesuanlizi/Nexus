import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GitNexusGraphModal', () => {
  it('portals the graph overlay to document.body so right-pane transforms cannot clip it', () => {
    const source = readFileSync('apps/desktop/src/components/GitNexusGraphModal.tsx', 'utf8');

    expect(source).toContain("import { createPortal } from 'react-dom'");
    expect(source).toContain('return createPortal(');
    expect(source).toContain('document.body');
  });

  it('keeps wheel zoom enabled inside the enlarged graph overlay', () => {
    const source = readFileSync('apps/desktop/src/components/GitNexusGraphModal.tsx', 'utf8');

    expect(source).not.toContain('disableZoom');
  });

  it('uses a light graph modal shell in the light theme instead of a dark chrome frame', () => {
    const styles = readFileSync('apps/desktop/src/styles.css', 'utf8');

    expect(styles).toContain('.gitNexusGraphModal {\n  position: relative;\n  width: min(96vw, 1680px);\n  height: min(94vh, 1040px);\n  background: #f8fafc;');
    expect(styles).toContain('.gitNexusGraphModalTitle {\n  position: absolute;\n  top: 12px;\n  left: 20px;\n  color: #0f172a;');
    expect(styles).toContain('.gitNexusGraphContent .gitNexusForceGraphCanvasWrap {\n  flex: 1;\n  background: #f8fafc;\n  border: 1px solid rgba(226, 232, 240, 0.9);');
  });
});
