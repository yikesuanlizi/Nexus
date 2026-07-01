import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('workspace search spinner', () => {
  it('defines a compact in-field spinner animation', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(styles).toContain('.workspaceSearchSpinner');
    expect(styles).toContain('@keyframes workspaceSearchSpin');
    expect(styles).toContain('animation: workspaceSearchSpin');
    expect(styles).toContain('border-top-color: currentColor;');
    expect(styles).toContain('grid-template-columns: 16px minmax(0,1fr) 16px;');
  });
});
