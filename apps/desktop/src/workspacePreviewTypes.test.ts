import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('workspace preview types', () => {
  it('renders image, pdf, markdown, and office previews', () => {
    const component = readFileSync(join(here, 'components', 'WorkspaceFilesPanel.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(component).toContain('ReactMarkdown');
    expect(component).toContain('remarkGfm');
    expect(component).toContain("preview.previewType === 'image'");
    expect(component).toContain("preview.previewType === 'pdf'");
    expect(component).toContain("preview.previewType === 'markdown'");
    expect(component).toContain('workspaceOfficePreview');
    expect(styles).toContain('.workspaceImagePreview');
    expect(styles).toContain('.workspacePdfPreview');
    expect(styles).toContain('.workspaceMarkdownPreview');
    expect(styles).toContain('.workspaceOfficePreview');
  });
});
