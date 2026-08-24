import type { WikiPageRecord } from './page.js';

export interface WikiGraphNode {
  pageId: string;
  slug: string;
  title: string;
  relativePath: string;
  pageDirectory: WikiPageRecord['pageDirectory'];
}

export interface WikiGraphEdge {
  sourcePageId: string;
  targetSlug: string;
  targetPageId?: string;
  targetDisplay?: string;
  resolved: boolean;
}

export interface WikiLinkGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
}

/**
 * Build the page-link graph from the extracted Wiki page model. The source
 * project resolves links from Markdown bodies rather than frontmatter; this
 * keeps that rule while making unresolved targets explicit for Ops evidence.
 */
export function buildWikiLinkGraph(pages: ReadonlyArray<WikiPageRecord & { pageId?: string }>): WikiLinkGraph {
  const nodes = pages
    .map((page) => ({
      pageId: page.pageId ?? `${page.pageDirectory}:${page.slug}`,
      slug: page.slug,
      title: page.title,
      relativePath: page.relativePath,
      pageDirectory: page.pageDirectory,
    }))
    .sort((a, b) => a.pageId.localeCompare(b.pageId));
  const bySlug = new Map<string, WikiGraphNode>();
  const byAlias = new Map<string, WikiGraphNode>();
  const pageById = new Map(
    pages.map((page) => [page.pageId ?? `${page.pageDirectory}:${page.slug}`, page]),
  );
  for (const directory of ['concepts', 'queries'] as const) {
    for (const node of nodes.filter((candidate) => candidate.pageDirectory === directory)) {
      bySlug.set(`${directory}:${node.slug}`, node);
      const sourcePage = pageById.get(node.pageId);
      for (const alias of sourcePage?.aliases ?? []) {
        const normalized = slugifyAlias(alias);
        if (normalized && !byAlias.has(`${directory}:${normalized}`)) {
          byAlias.set(`${directory}:${normalized}`, node);
        }
      }
    }
  }
  const edges: WikiGraphEdge[] = [];
  for (const page of pages) {
    if (page.pageDirectory !== 'concepts' && page.pageDirectory !== 'queries') continue;
    const sourcePageId = page.pageId ?? `${page.pageDirectory}:${page.slug}`;
    const targets = page.linkTargets ?? page.links.map((slug) => ({ slug, display: slug }));
    for (const target of targets) {
      const targetSlug = target.slug;
      const resolved = bySlug.get(`concepts:${targetSlug}`)
        ?? bySlug.get(`queries:${targetSlug}`)
        ?? byAlias.get(`concepts:${targetSlug}`)
        ?? byAlias.get(`queries:${targetSlug}`);
      edges.push({
        sourcePageId,
        targetSlug,
        targetDisplay: target.display,
        ...(resolved ? { targetPageId: resolved.pageId, resolved: true } : { resolved: false }),
      });
    }
  }
  edges.sort((a, b) => a.sourcePageId.localeCompare(b.sourcePageId) || a.targetSlug.localeCompare(b.targetSlug));
  return { nodes, edges };
}

function slugifyAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
