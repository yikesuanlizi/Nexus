import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('sidebar collapse', () => {
  it('does not immediately reopen the conversation pane from rail hover preview', () => {
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(main).not.toContain('sidebarPreview');
    expect(main).not.toContain('setSidebarPreview');
    expect(styles).not.toContain(':has(.rail:hover)');
  });

  it('keeps every workspace navigation module and exposes row actions on hover or focus', () => {
    const sidebar = readFileSync(join(here, 'components', 'WorkspaceThreadList.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(sidebar).toContain('WorkflowProjectList');
    expect(sidebar).toContain('ThreadModuleView');
    expect(sidebar).toContain('WorkspaceGroupView');
    expect(sidebar).toContain('onOpenSettings');
    expect(sidebar).toContain('onToggleSidebar');
    expect(styles).toContain('.workspaceThreadRow:hover .workspaceThreadActions');
    expect(styles).toContain('.workspaceThreadRow:focus-within .workspaceThreadActions');
  });
});
