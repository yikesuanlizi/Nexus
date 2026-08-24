import { describe, expect, it } from 'vitest';
import { buildWikiLinkGraph, parseWikiPage } from './index.js';

describe('wiki-core page graph', () => {
  it('resolves page links and keeps dangling targets visible', () => {
    const pages = [
      { pageId: 'page-a', ...parseWikiPage('wiki/concepts/a.md', '# A\nSee [[B]] and [[Missing]].') },
      { pageId: 'page-b', ...parseWikiPage('wiki/concepts/b.md', '# B\n') },
    ];
    const graph = buildWikiLinkGraph(pages);
    expect(graph.nodes.map((node) => node.pageId)).toEqual(['page-a', 'page-b']);
    expect(graph.edges).toEqual([
      { sourcePageId: 'page-a', targetSlug: 'b', targetDisplay: 'B', targetPageId: 'page-b', resolved: true },
      { sourcePageId: 'page-a', targetSlug: 'missing', targetDisplay: 'Missing', resolved: false },
    ]);
  });

  it('uses concepts-before-queries and exact-slug-before-alias resolution', () => {
    const pages = [
      { pageId: 'query-run', ...parseWikiPage('wiki/queries/run.md', '---\ntitle: Query Run\naliases: [restart]\n---\n') },
      { pageId: 'concept-restart', ...parseWikiPage('wiki/concepts/restart.md', '---\ntitle: Restart\naliases: [run]\n---\n') },
      { pageId: 'source', ...parseWikiPage('wiki/concepts/source.md', 'See [[run]].') },
    ];
    const graph = buildWikiLinkGraph(pages);
    expect(graph.edges).toEqual([
      { sourcePageId: 'source', targetSlug: 'run', targetDisplay: 'run', targetPageId: 'query-run', resolved: true },
    ]);
  });
});
