import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('browser dialogs', () => {
  it('does not use native browser alert, confirm, or prompt dialogs', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).not.toMatch(/\bwindow\.(alert|confirm|prompt)\s*\(/);
    expect(source).not.toMatch(/\b(alert|confirm|prompt)\s*\(/);
  });
});
