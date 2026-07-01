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
});
