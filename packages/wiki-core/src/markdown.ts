/**
 * Markdown helpers adapted from atomicstrata/llm-wiki-compiler's
 * src/utils/markdown.ts and src/wiki/collect.ts.
 *
 * The extracted surface is intentionally limited to page metadata and links;
 * compiler writes, LLM prompts and embedding/vector code are not included.
 */
import yaml from 'js-yaml';

export interface FrontmatterStatus {
  meta: Record<string, unknown>;
  body: string;
  hasFrontmatterBlock: boolean;
  malformedFrontmatter: boolean;
}

export function parseFrontmatterStatus(content: string): FrontmatterStatus {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content, hasFrontmatterBlock: false, malformedFrontmatter: false };
  }

  let meta: Record<string, unknown> = {};
  let malformedFrontmatter = false;
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    } else if (parsed !== null && parsed !== undefined) {
      malformedFrontmatter = true;
    }
  } catch {
    malformedFrontmatter = true;
  }
  return {
    meta,
    body: match[2],
    hasFrontmatterBlock: true,
    malformedFrontmatter,
  };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikilinkTargets(body: string): Array<{ slug: string; display: string }> {
  const targets: Array<{ slug: string; display: string }> = [];
  const seen = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    const target = match[1].trim();
    const slug = slugify(target);
    if (!seen.has(slug)) {
      seen.add(slug);
      targets.push({ slug, display: match[2]?.trim() || target });
    }
  }
  return targets;
}

export function extractWikilinkSlugs(body: string): string[] {
  return extractWikilinkTargets(body).map((target) => target.slug);
}
