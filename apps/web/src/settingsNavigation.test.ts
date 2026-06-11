import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('settings navigation', () => {
  it('switches settings pages with internal state instead of anchor scrolling', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');

    expect(source).toContain('const [activeSection, setActiveSection]');
    expect(source).toContain("onClick={() => setActiveSection(tab.id)}");
    expect(source).not.toContain('href="#settings-');
  });
});
