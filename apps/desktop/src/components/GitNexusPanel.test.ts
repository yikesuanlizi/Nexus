import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GitNexusPanel graph affordances', () => {
  it('renders graph expansion as a floating affordance inside the graph shell', () => {
    const source = readFileSync('apps/desktop/src/components/GitNexusPanel.tsx', 'utf8');

    expect(source).toContain('className="gitNexusGraphShell"');
    expect(source).toContain('className="gitNexusGraphExpandBtn gitNexusGraphExpandBtn--floating"');
    expect(source.indexOf('className="gitNexusGraphShell"')).toBeLessThan(
      source.indexOf('className="gitNexusGraphExpandBtn gitNexusGraphExpandBtn--floating"'),
    );
  });
});
