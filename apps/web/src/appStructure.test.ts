import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('app module structure', () => {
  it('keeps main.tsx focused on app state and layout', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source.split('\n').length).toBeLessThanOrEqual(1400);
    expect(source).toContain("from './components/Dialogs.js'");
  });
});
