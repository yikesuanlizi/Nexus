import path from 'node:path';
import {
  extractWikilinkTargets,
  extractWikilinkSlugs,
  parseFrontmatterStatus,
  type FrontmatterStatus,
} from './markdown.js';

export type WikiPageDirectory = 'concepts' | 'queries' | 'other';

export interface WikiPageRecord {
  slug: string;
  pageDirectory: WikiPageDirectory;
  relativePath: string;
  title: string;
  summary: string;
  tags: string[];
  links: string[];
  linkTargets: Array<{ slug: string; display: string }>;
  aliases: string[];
  createdAt?: string;
  updatedAt?: string;
  orphaned: boolean;
  archived: boolean;
  body: string;
  frontmatter: Record<string, unknown>;
  parseStatus: Pick<FrontmatterStatus, 'hasFrontmatterBlock' | 'malformedFrontmatter'> & {
    hasTitle: boolean;
  };
}

export function pageDirectoryFor(relativePath: string): WikiPageDirectory {
  const normalized = relativePath.replaceAll(path.sep, '/');
  if (normalized.startsWith('wiki/concepts/')) return 'concepts';
  if (normalized.startsWith('wiki/queries/')) return 'queries';
  return 'other';
}

export function parseWikiPage(relativePath: string, content: string): WikiPageRecord {
  const parsed = parseFrontmatterStatus(content);
  const normalized = relativePath.replaceAll(path.sep, '/');
  const filename = normalized.split('/').at(-1) ?? normalized;
  const slug = filename.replace(/\.md$/i, '');
  const meta = parsed.meta;
  const heading = parsed.body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]
    ?.replace(/[`*_~]/g, '')
    .trim();
  const title = typeof meta.title === 'string' && meta.title.trim()
    ? meta.title.trim()
    : heading || slug;
  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : [];
  return {
    slug,
    pageDirectory: pageDirectoryFor(normalized),
    relativePath: normalized,
    title,
    summary: typeof meta.summary === 'string' ? meta.summary : '',
    tags,
    links: extractWikilinkSlugs(parsed.body),
    linkTargets: extractWikilinkTargets(parsed.body),
    aliases: Array.isArray(meta.aliases)
      ? meta.aliases
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.trim())
        .filter(Boolean)
      : [],
    ...(typeof meta.createdAt === 'string' ? { createdAt: meta.createdAt } : {}),
    ...(typeof meta.updatedAt === 'string' ? { updatedAt: meta.updatedAt } : {}),
    orphaned: meta.orphaned === true,
    archived: meta.archived === true,
    body: parsed.body,
    frontmatter: meta,
    parseStatus: {
      hasFrontmatterBlock: parsed.hasFrontmatterBlock,
      malformedFrontmatter: parsed.malformedFrontmatter,
      hasTitle: typeof meta.title === 'string' && meta.title.trim().length > 0,
    },
  };
}
