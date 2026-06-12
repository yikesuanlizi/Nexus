import * as fs from 'node:fs/promises';
import { Dirent } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolContext, ToolResult } from './registry.js';

// ─── current_time ──────────────────────────────────────────────────────────
export const currentTimeTool: ToolDefinition = {
  name: 'current_time',
  description: 'Get the current local date and time. Use this for simple time/date questions instead of shell commands.',
  parameters: {
    type: 'object',
    properties: {
      locale: { type: 'string', description: 'Optional BCP-47 locale, e.g. zh-CN or en-US.' },
      timeZone: { type: 'string', description: 'Optional IANA timezone, e.g. Asia/Shanghai.' },
    },
  },
  requiredPolicy: 'readonly',
  async execute(args): Promise<ToolResult> {
    const now = new Date();
    const locale = typeof args.locale === 'string' && args.locale.trim() ? args.locale : 'zh-CN';
    const timeZone = typeof args.timeZone === 'string' && args.timeZone.trim() ? args.timeZone : 'Asia/Shanghai';
    const formatted = new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(now);
    return {
      output: `Current time (${timeZone}): ${formatted}`,
      data: {
        iso: now.toISOString(),
        formatted,
        timeZone,
      },
      status: 'completed',
    };
  },
};

// ─── read_file ──────────────────────────────────────────────────────────────
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path relative to workspace root, or absolute.' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed).' },
      limit: { type: 'number', description: 'Maximum number of lines to read.' },
    },
    required: ['filePath'],
  },
  requiredPolicy: 'readonly',
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = resolvePath(ctx.workspaceRoot, String(args.filePath));
    const content = await fs.readFile(filePath, 'utf-8');
    const allLines = content.split('\n');
    let lines = allLines;
    const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) - 1 : 0;
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : undefined;
    if (limit !== undefined) {
      lines = lines.slice(offset, offset + limit);
    } else if (offset > 0) {
      lines = lines.slice(offset);
    }
    const startLine = offset + 1;
    const endLine = Math.min(allLines.length, offset + lines.length);
    const numbered = lines.map((line, index) => `${startLine + index}: ${line}`).join('\n');
    const ref = fileSegmentRef(filePath, startLine, endLine, lines.join('\n'));
    return {
      output: numbered,
      status: 'completed',
      data: {
        path: filePath,
        startLine,
        endLine,
        totalLines: allLines.length,
        artifactRefs: [ref],
      },
    };
  },
};

// ─── write_file ─────────────────────────────────────────────────────────────
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write or overwrite a file in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path relative to workspace root.' },
      content: { type: 'string', description: 'File content to write.' },
    },
    required: ['filePath', 'content'],
  },
  requiredPolicy: 'workspace_write',
  requiresApproval: true,
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = resolvePath(ctx.workspaceRoot, String(args.filePath));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(args.content), 'utf-8');
    return { output: `Wrote ${Buffer.byteLength(String(args.content))} bytes to ${args.filePath}`, status: 'completed' };
  },
};

// ─── shell_command ──────────────────────────────────────────────────────────
export const shellCommandTool: ToolDefinition = {
  name: 'shell_command',
  description:
    'Run a shell command. The command runs in the workspace root. Output is captured and returned.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (relative to workspace or absolute).',
      },
    },
    required: ['command'],
  },
  requiredPolicy: 'workspace_write',
  requiresApproval: true,
  maxOutputLength: 20_000,
  timeoutMs: 120_000,
  async execute(args, ctx): Promise<ToolResult> {
    const { exec } = await import('node:child_process');
    const cmd = String(args.command);
    const cwd =
      args.cwd ? resolvePath(ctx.workspaceRoot, String(args.cwd)) : ctx.workspaceRoot;

    return new Promise((resolve) => {
      exec(
        cmd,
        {
          cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const output = [stdout, stderr ? `\n[stderr]\n${stderr}` : '']
            .filter(Boolean)
            .join('\n')
            .trim();
          if (error && error.code !== 0 && !output) {
            resolve({
              output: `Command failed: ${error.message}`,
              status: 'failed',
              exitCode: error.code ?? 1,
              error: { message: error.message },
            });
          } else {
            resolve({
              output: output || '(no output)',
              status: 'completed',
              exitCode: error?.code ?? 0,
            });
          }
        },
      );
    });
  },
};

// ─── search_content ─────────────────────────────────────────────────────────
export const searchContentTool: ToolDefinition = {
  name: 'search_content',
  description:
    'Search for a text pattern (substring or regex) across files in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex pattern to search for.' },
      path: {
        type: 'string',
        description: 'Directory to search in (relative to workspace root, default: root).',
      },
      fileTypes: { type: 'string', description: 'Comma-separated file extensions (e.g. ".ts,.js").' },
      caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default false).' },
      contextLines: { type: 'number', description: 'Lines of context around each match.' },
    },
    required: ['pattern'],
  },
  requiredPolicy: 'readonly',
  timeoutMs: 30_000,
  maxOutputLength: 30_000,
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = String(args.pattern);
    const searchPath = args.path
      ? resolvePath(ctx.workspaceRoot, String(args.path))
      : ctx.workspaceRoot;

    // Simple recursive grep using Node
    const results: SearchMatch[] = [];
    await walkAndSearch(
      searchPath,
      pattern,
      {
        caseSensitive: !!args.caseSensitive,
        fileTypes: args.fileTypes ? String(args.fileTypes).split(',').map((s) => s.trim()) : undefined,
        contextLines: typeof args.contextLines === 'number' ? Math.floor(args.contextLines) : 0,
      },
      results,
    );

    if (results.length === 0) {
      return { output: `No matches found for "${pattern}"`, status: 'completed' };
    }
    return {
      output: results.map((result) => result.lines).flat().join('\n'),
      status: 'completed',
      data: {
        pattern,
        matches: results,
        artifactRefs: results.map((result) => result.artifactRef),
      },
    };
  },
};

// ─── web_search ────────────────────────────────────────────────────────────
export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the public web for current, external, or explicitly requested online information. Use it to discover likely URLs, then use web_fetch for a specific page. Avoid repeated searches for the same task.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The web search query.' },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return, from 1 to 8. Default is 5.',
      },
    },
    required: ['query'],
  },
  requiredPolicy: 'readonly',
  timeoutMs: 20_000,
  maxOutputLength: 12_000,
  async execute(args): Promise<ToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return {
        output: 'Missing query for web_search',
        status: 'failed',
        error: { message: 'query is required', code: 'INVALID_ARGUMENTS' },
      };
    }

    const maxResultsRaw = Number(args.maxResults);
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.min(8, Math.max(1, Math.floor(maxResultsRaw)))
      : 5;
    try {
      const results = (await fetchSearchResults(query)).slice(0, maxResults);
      if (results.length === 0) {
        return {
          output: `No web search results found for "${query}".`,
          status: 'completed',
          data: { query, results: [] },
        };
      }

      const output = [
        `Web search results for "${query}":`,
        ...results.map((result, index) =>
          [
            `${index + 1}. ${result.title}`,
            result.url,
            result.snippet ? result.snippet : undefined,
          ].filter(Boolean).join('\n'),
        ),
      ].join('\n\n');

      return {
        output,
        status: 'completed',
        data: { query, results },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: `Web search failed for "${query}": ${message}`,
        status: 'failed',
        error: { message, code: 'WEB_SEARCH_FAILED' },
      };
    }
  },
};

// ─── web_fetch ─────────────────────────────────────────────────────────────
export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch and extract readable text from a specific HTTP/HTTPS URL. Use this when the user provides a URL or after web_search finds a promising result.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The HTTP or HTTPS URL to fetch.' },
    },
    required: ['url'],
  },
  requiredPolicy: 'readonly',
  timeoutMs: 25_000,
  maxOutputLength: 18_000,
  async execute(args, ctx): Promise<ToolResult> {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return {
        output: 'Missing or invalid URL for web_fetch',
        status: 'failed',
        error: { message: 'url must be a valid HTTP/HTTPS URL', code: 'INVALID_ARGUMENTS' },
      };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        output: `Unsupported URL protocol for web_fetch: ${url.protocol}`,
        status: 'failed',
        error: { message: 'only http and https URLs are supported', code: 'INVALID_ARGUMENTS' },
      };
    }

    const controller = new AbortController();
    const abortFromContext = () => controller.abort(ctx.signal?.reason);
    if (ctx.signal) {
      if (ctx.signal.aborted) controller.abort(ctx.signal.reason);
      else ctx.signal.addEventListener('abort', abortFromContext, { once: true });
    }

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'user-agent': 'Mozilla/5.0 Nexus/0.1',
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      const title = contentType.includes('html') ? extractHtmlTitle(body) : undefined;
      const text = contentType.includes('html') ? htmlToReadableText(body) : body.trim();
      const returnedText = limitToolText(text, 16_000);
      const output = [
        `Fetched URL: ${url.toString()}`,
        `Status: ${response.status} ${response.statusText}`.trim(),
        contentType ? `Content-Type: ${contentType}` : undefined,
        title ? `Title: ${title}` : undefined,
        '',
        returnedText || '[empty response body]',
      ].filter((line) => line !== undefined).join('\n');

      return {
        output,
        status: response.ok ? 'completed' : 'failed',
        data: {
          url: url.toString(),
          status: response.status,
          contentType,
          title,
          text: returnedText,
          truncated: text.length > returnedText.length,
        },
        error: response.ok
          ? undefined
          : { message: `HTTP ${response.status} ${response.statusText}`.trim(), code: 'WEB_FETCH_FAILED' },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: `web_fetch failed for "${url.toString()}": ${message}`,
        status: 'failed',
        error: { message, code: 'WEB_FETCH_FAILED' },
      };
    } finally {
      if (ctx.signal) ctx.signal.removeEventListener('abort', abortFromContext);
    }
  },
};

// ─── apply_patch ────────────────────────────────────────────────────────────
export const applyPatchTool: ToolDefinition = {
  name: 'apply_patch',
  description:
    'Apply a unified diff patch to files in the workspace. Each hunk specifies the target file and the changes.',
  parameters: {
    type: 'object',
    properties: {
      patch: { type: 'string', description: 'Unified diff patch text.' },
    },
    required: ['patch'],
  },
  requiredPolicy: 'workspace_write',
  requiresApproval: true,
  async execute(args, ctx): Promise<ToolResult> {
    const patchText = String(args.patch);
    let actions: NexusPatchAction[];
    try {
      actions = parseNexusPatch(patchText);
      const changes = await applyNexusPatchActions(ctx.workspaceRoot, actions);
      return {
        output: changes.map((change) => `${change.kind} ${change.path} (+${change.addedLines ?? 0}/-${change.removedLines ?? 0})`).join('\n') || 'No changes applied',
        status: 'completed',
        data: { changes },
      };
    } catch (error) {
      const message = `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`;
      return {
        output: message,
        status: 'failed',
        error: { message, code: 'APPLY_PATCH_FAILED' },
      };
    }
  },
};

// ─── built‑in tool list ─────────────────────────────────────────────────────
export const BUILTIN_TOOLS: ToolDefinition[] = [
  currentTimeTool,
  readFileTool,
  writeFileTool,
  shellCommandTool,
  searchContentTool,
  webSearchTool,
  webFetchTool,
  applyPatchTool,
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function resolvePath(workspaceRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workspaceRoot, filePath);
}

interface WalkOptions {
  caseSensitive: boolean;
  fileTypes?: string[];
  contextLines: number;
}

async function walkAndSearch(
  dir: string,
  pattern: string,
  opts: WalkOptions,
  results: SearchMatch[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walkAndSearch(fullPath, pattern, opts, results);
    } else if (entry.isFile()) {
      if (opts.fileTypes && opts.fileTypes.length > 0) {
        const ext = path.extname(entry.name);
        if (!opts.fileTypes.some((ft) => ext === ft || entry.name.endsWith(ft))) continue;
      }
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const flags = opts.caseSensitive ? 'g' : 'gi';
        const regex = safeRegex(pattern, flags);
        if (!regex) continue;

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            // Reset lastIndex for global regex
            regex.lastIndex = 0;
            const relPath = path.relative(process.cwd(), fullPath);
            const workspaceRelPath = path.relative(dir, fullPath);
            if (opts.contextLines > 0) {
              const start = Math.max(0, i - opts.contextLines);
              const end = Math.min(lines.length, i + opts.contextLines + 1);
              const rendered: string[] = [];
              for (let j = start; j < end; j++) {
                rendered.push(`${relPath}:${j + 1}: ${lines[j]}`);
              }
              rendered.push('---');
              results.push({
                path: workspaceRelPath || path.basename(fullPath),
                line: i + 1,
                text: lines[i],
                lines: rendered,
                artifactRef: fileSegmentRef(fullPath, start + 1, end, lines.slice(start, end).join('\n')),
              });
            } else {
              const rendered = [`${relPath}:${i + 1}: ${lines[i]}`];
              results.push({
                path: workspaceRelPath || path.basename(fullPath),
                line: i + 1,
                text: lines[i],
                lines: rendered,
                artifactRef: fileSegmentRef(fullPath, i + 1, i + 1, lines[i]),
              });
            }
            if (results.length > 200) return; // safety limit
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

interface SearchMatch {
  path: string;
  line: number;
  text: string;
  lines: string[];
  artifactRef: ReturnType<typeof fileSegmentRef>;
}

function fileSegmentRef(filePath: string, startLine: number, endLine: number, excerpt: string) {
  return {
    kind: 'file_segment' as const,
    path: filePath,
    startLine,
    endLine,
    sha256: createHash('sha256').update(excerpt).digest('hex'),
    excerpt: excerpt.length > 2000 ? `${excerpt.slice(0, 2000)}\n... [truncated]` : excerpt,
  };
}

function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    try {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchSource {
  name: string;
  url: (query: string) => string;
  parse: (html: string) => WebSearchResult[];
}

const SEARCH_SOURCES: SearchSource[] = [
  {
    name: 'DuckDuckGo',
    url: (query) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoResults,
  },
  {
    name: 'Bing',
    url: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    parse: parseBingResults,
  },
];

async function fetchSearchResults(query: string): Promise<WebSearchResult[]> {
  const failures: string[] = [];

  for (const source of SEARCH_SOURCES) {
    try {
      const response = await fetch(source.url(query), {
        headers: {
          'user-agent': 'Mozilla/5.0 Nexus/0.1',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const html = await response.text();
      const results = source.parse(html);
      if (results.length > 0) return results;
      failures.push(`${source.name}: no results parsed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${source.name}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
  return [];
}

function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRegex = /<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*\bresult\b|<\/body>|$)/gi;
  const fallbackRegex = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<(?:a|div)[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>|$)/gi;

  for (const match of html.matchAll(blockRegex)) {
    const block = match[1] ?? '';
    const linkMatch = block.match(/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const snippetMatch = block.match(/<(?:a|div)[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const result = normalizeSearchResult(linkMatch[2] ?? '', linkMatch[1] ?? '', snippetMatch?.[1] ?? '');
    if (result) results.push(result);
  }

  if (results.length > 0) return dedupeSearchResults(results);

  for (const match of html.matchAll(fallbackRegex)) {
    const result = normalizeSearchResult(match[2] ?? '', match[1] ?? '', match[3] ?? '');
    if (result) results.push(result);
  }

  return dedupeSearchResults(results);
}

function parseBingResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRegex = /<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)(?=<li[^>]+class="[^"]*\bb_algo\b|<\/ol>|$)/gi;

  for (const match of html.matchAll(blockRegex)) {
    const block = match[1] ?? '';
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!linkMatch) continue;

    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const result = normalizeSearchResult(linkMatch[2] ?? '', linkMatch[1] ?? '', snippetMatch?.[1] ?? '');
    if (result) results.push(result);
  }

  return dedupeSearchResults(results);
}

function normalizeSearchResult(titleHtml: string, urlHtml: string, snippetHtml: string): WebSearchResult | null {
  const title = cleanHtml(titleHtml);
  const url = normalizeDuckDuckGoUrl(decodeHtml(urlHtml));
  const snippet = cleanHtml(snippetHtml);
  if (!title || !url) return null;
  return { title, url, snippet };
}

function extractHtmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleaned = title ? cleanHtml(title) : '';
  return cleaned || undefined;
}

function htmlToReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|main|aside|li|tr|h[1-6])>/gi, '\n');
  return decodeHtml(withBreaks.replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function limitToolText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
}

function cleanHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl, 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return rawUrl;
  }
}

function dedupeSearchResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

type NexusPatchAction =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: NexusPatchHunk[] };

interface NexusPatchHunk {
  lines: Array<{ prefix: ' ' | '+' | '-'; text: string }>;
}

interface AppliedChange {
  path: string;
  kind: 'add' | 'delete' | 'update';
  addedLines: number;
  removedLines: number;
  hunks: Array<{
    path: string;
    addedLines: number;
    removedLines: number;
    startLine?: number;
    endLine?: number;
    summary?: string;
  }>;
  summary: string;
}

function parseNexusPatch(patch: string): NexusPatchAction[] {
  const lines = patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let index = 0;
  if (lines[index] !== '*** Begin Patch') throw new Error('missing "*** Begin Patch"');
  index++;
  const actions: NexusPatchAction[] = [];

  while (index < lines.length) {
    const line = lines[index];
    if (line === '*** End Patch' || (line === '' && lines[index + 1] === undefined)) break;
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      index++;
      const addLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) throw new Error(`add file ${filePath} contains a non-add line`);
        addLines.push(lines[index].slice(1));
        index++;
      }
      actions.push({ kind: 'add', path: filePath, lines: addLines });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      actions.push({ kind: 'delete', path: line.slice('*** Delete File: '.length).trim() });
      index++;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      index++;
      let moveTo: string | undefined;
      if (lines[index]?.startsWith('*** Move to: ')) {
        moveTo = lines[index].slice('*** Move to: '.length).trim();
        index++;
      }
      const hunks: NexusPatchHunk[] = [];
      let current: NexusPatchHunk | null = null;
      while (index < lines.length && !lines[index].startsWith('*** ')) {
        const hunkLine = lines[index];
        if (hunkLine === '' && index === lines.length - 1) break;
        if (hunkLine.startsWith('@@')) {
          if (current) hunks.push(current);
          current = { lines: [] };
          index++;
          continue;
        }
        if (hunkLine === '*** End of File') {
          index++;
          continue;
        }
        if (!current) current = { lines: [] };
        const prefix = hunkLine[0];
        if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
          throw new Error(`invalid patch line in ${filePath}: ${hunkLine}`);
        }
        current.lines.push({ prefix, text: hunkLine.slice(1) });
        index++;
      }
      if (current) hunks.push(current);
      if (!moveTo && hunks.length === 0) throw new Error(`update file ${filePath} has no hunks`);
      actions.push({ kind: 'update', path: filePath, moveTo, hunks });
      continue;
    }
    throw new Error(`unexpected patch line: ${line}`);
  }
  if (!lines.includes('*** End Patch')) throw new Error('missing "*** End Patch"');
  if (actions.length === 0) throw new Error('patch has no file operations');
  return actions;
}

async function applyNexusPatchActions(workspaceRoot: string, actions: NexusPatchAction[]): Promise<AppliedChange[]> {
  const staged = new Map<string, string | null>();
  const changes: AppliedChange[] = [];

  for (const action of actions) {
    if (action.kind === 'add') {
      const abs = resolvePath(workspaceRoot, action.path);
      staged.set(abs, action.lines.join('\n'));
      changes.push({
        path: action.path,
        kind: 'add',
        addedLines: action.lines.length,
        removedLines: 0,
        hunks: [{ path: action.path, addedLines: action.lines.length, removedLines: 0 }],
        summary: `add ${action.path}`,
      });
      continue;
    }
    if (action.kind === 'delete') {
      const abs = resolvePath(workspaceRoot, action.path);
      const content = await readStagedOrDisk(staged, abs);
      if (content === null) throw new Error(`${action.path}: file not found`);
      staged.set(abs, null);
      const removed = splitPatchLines(content).length;
      changes.push({
        path: action.path,
        kind: 'delete',
        addedLines: 0,
        removedLines: removed,
        hunks: [{ path: action.path, addedLines: 0, removedLines: removed }],
        summary: `delete ${action.path}`,
      });
      continue;
    }
    const abs = resolvePath(workspaceRoot, action.path);
    const original = await readStagedOrDisk(staged, abs);
    if (original === null) throw new Error(`${action.path}: file not found`);
    const applied = applyUpdateHunks(original, action.path, action.hunks);
    const targetAbs = action.moveTo ? resolvePath(workspaceRoot, action.moveTo) : abs;
    staged.set(abs, action.moveTo ? null : applied.content);
    if (action.moveTo) staged.set(targetAbs, applied.content);
    changes.push({
      path: action.moveTo ?? action.path,
      kind: 'update',
      addedLines: applied.added,
      removedLines: applied.removed,
      hunks: applied.hunks.map((hunk) => ({ ...hunk, path: action.moveTo ?? action.path })),
      summary: action.moveTo ? `update ${action.path} -> ${action.moveTo}` : `update ${action.path}`,
    });
  }

  for (const [absPath, content] of staged) {
    if (content === null) {
      await fs.rm(absPath, { force: true });
    } else {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, 'utf-8');
    }
  }
  return changes;
}

async function readStagedOrDisk(staged: Map<string, string | null>, absPath: string): Promise<string | null> {
  if (staged.has(absPath)) return staged.get(absPath) ?? null;
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

function applyUpdateHunks(content: string, filePath: string, hunks: NexusPatchHunk[]): {
  content: string;
  added: number;
  removed: number;
  hunks: AppliedChange['hunks'];
} {
  const hadTrailingNewline = content.endsWith('\n');
  let lines = splitPatchLines(content);
  let added = 0;
  let removed = 0;
  const appliedHunks: AppliedChange['hunks'] = [];

  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((line) => line.prefix !== '+').map((line) => line.text);
    const newLines = hunk.lines.filter((line) => line.prefix !== '-').map((line) => line.text);
    const index = findLineSequence(lines, oldLines);
    if (index < 0) throw new Error(`${filePath}: hunk context not found`);
    lines = [
      ...lines.slice(0, index),
      ...newLines,
      ...lines.slice(index + oldLines.length),
    ];
    const hunkAdded = hunk.lines.filter((line) => line.prefix === '+').length;
    const hunkRemoved = hunk.lines.filter((line) => line.prefix === '-').length;
    added += hunkAdded;
    removed += hunkRemoved;
    appliedHunks.push({
      path: filePath,
      startLine: index + 1,
      endLine: index + Math.max(oldLines.length, 1),
      addedLines: hunkAdded,
      removedLines: hunkRemoved,
      summary: `+${hunkAdded}/-${hunkRemoved}`,
    });
  }

  const next = lines.join('\n') + (hadTrailingNewline ? '\n' : '');
  return { content: next, added, removed, hunks: appliedHunks };
}

function splitPatchLines(content: string): string[] {
  const withoutFinalNewline = content.endsWith('\n') ? content.slice(0, -1) : content;
  if (withoutFinalNewline === '') return [];
  return withoutFinalNewline.split('\n');
}

function findLineSequence(lines: string[], target: string[]): number {
  if (target.length === 0) return lines.length;
  for (let i = 0; i <= lines.length - target.length; i++) {
    let matched = true;
    for (let j = 0; j < target.length; j++) {
      if (lines[i + j] !== target[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}
