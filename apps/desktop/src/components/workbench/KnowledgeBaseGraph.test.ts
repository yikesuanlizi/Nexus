import { describe, expect, it } from 'vitest';
import { createKnowledgeGraphLayout } from './KnowledgeBaseGraph.js';

describe('knowledge base graph layout', () => {
  it('keeps only resolved links whose endpoints exist', () => {
    const layout = createKnowledgeGraphLayout({
      nodes: [
        { pageId: 'a', slug: 'a', title: 'A', relativePath: 'a.md', pageDirectory: 'root' },
        { pageId: 'b', slug: 'b', title: 'B', relativePath: 'b.md', pageDirectory: 'root' },
      ],
      edges: [
        { sourcePageId: 'a', targetSlug: 'b', targetPageId: 'b', resolved: true },
        { sourcePageId: 'a', targetSlug: 'missing', resolved: false },
      ],
    });

    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.source.node.pageId).toBe('a');
    expect(layout.edges[0]?.target.node.pageId).toBe('b');
  });

  it('returns a stable bounded position for an isolated page', () => {
    const layout = createKnowledgeGraphLayout({
      nodes: [{ pageId: 'only', slug: 'only', title: 'Only', relativePath: 'only.md', pageDirectory: 'root' }],
      edges: [],
    });

    const node = layout.nodes[0]!;
    expect(node.x).toBeGreaterThanOrEqual(34);
    expect(node.x).toBeLessThanOrEqual(726);
    expect(node.y).toBeGreaterThanOrEqual(34);
    expect(node.y).toBeLessThanOrEqual(376);
  });
});
