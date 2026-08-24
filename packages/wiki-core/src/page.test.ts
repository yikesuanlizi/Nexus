import { describe, expect, it } from 'vitest';
import { extractWikilinkTargets, parseFrontmatterStatus, parseWikiPage, slugify } from './index.js';

describe('wiki-core page model adapted from llm-wiki-compiler', () => {
  it('parses frontmatter metadata and keeps the markdown body separate', () => {
    const parsed = parseWikiPage(
      'wiki/concepts/restart.md',
      '---\ntitle: Restart Runbook\nsummary: Safe restart\ntags:\n  - ops\n  - runbook\n---\nSee [[approval|approval flow]].',
    );
    expect(parsed.pageDirectory).toBe('concepts');
    expect(parsed.title).toBe('Restart Runbook');
    expect(parsed.summary).toBe('Safe restart');
    expect(parsed.tags).toEqual(['ops', 'runbook']);
    expect(parsed.links).toEqual(['approval']);
    expect(parsed.linkTargets).toEqual([{ slug: 'approval', display: 'approval flow' }]);
    expect(parsed.body).toContain('[[approval|approval flow]]');
    expect(parsed.parseStatus.malformedFrontmatter).toBe(false);
  });

  it('preserves aliases and deduplicates wikilinks', () => {
    expect(extractWikilinkTargets('[[Incident One|first]] [[incident one]]')).toEqual([
      { slug: 'incident-one', display: 'first' },
    ]);
    expect(slugify('中文 Restart!')).toBe('中文-restart');
  });

  it('reports malformed frontmatter instead of discarding the page', () => {
    const result = parseFrontmatterStatus('---\ntitle: [bad\n---\nbody');
    expect(result.hasFrontmatterBlock).toBe(true);
    expect(result.malformedFrontmatter).toBe(true);
    expect(result.body).toBe('body');
  });
});
