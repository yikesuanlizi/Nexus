import type { McpConfig } from '../../shared/types.js';
import { extractUrlTokens } from '../input/composerInput.js';

function isOldFilesystemPlaceholder(mcp: McpConfig): boolean {
  return (
    mcp.id === 'default-filesystem'
    && mcp.name === 'filesystem'
    && mcp.command === 'npx'
    && mcp.args === '@modelcontextprotocol/server-filesystem .'
    && mcp.enabled === false
  );
}

export function normalizeStoredMcps(mcps: McpConfig[]): McpConfig[] {
  return mcps.filter((mcp) => !isOldFilesystemPlaceholder(mcp));
}

export interface ResolvedMcpDraft {
  draft: McpConfig;
  sourceError?: string;
}

export async function resolveMcpDraftFromInput(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedMcpDraft> {
  const localDraft = mcpFromCommandText(text);
  if (localDraft.sourceKind !== 'url') return { draft: localDraft };
  try {
    const response = await fetchImpl('/api/mcp/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: text.trim() }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error ?? 'MCP draft failed');
    }
    const data = await response.json() as { draft?: McpConfig; sourceError?: string };
    return { draft: data.draft ?? localDraft, sourceError: data.sourceError };
  } catch (error) {
    return {
      draft: localDraft,
      sourceError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function mcpFromCommandText(text: string): McpConfig {
  const trimmed = text.trim();
  if (!trimmed) {
    return { id: '', name: '', command: '', args: '', enabled: true };
  }
  const url = extractUrlTokens(trimmed)[0]?.value;
  if (url && !startsWithExecutableCommand(trimmed)) {
    return {
      id: '',
      name: inferMcpName('', '', url),
      command: '',
      args: '',
      enabled: false,
      sourceKind: 'url',
      sourceUrl: url,
      sourceHint: trimmed,
    };
  }
  const [command = '', ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  const name = inferMcpName(command, args, url);
  return {
    id: '',
    name,
    command,
    args,
    enabled: true,
    sourceKind: 'command',
    sourceUrl: url,
  };
}

function startsWithExecutableCommand(text: string): boolean {
  const [first = ''] = text.trim().split(/\s+/);
  const normalized = first.toLowerCase();
  return [
    'bun',
    'cmd',
    'deno',
    'docker',
    'node',
    'npm',
    'npx',
    'pnpm',
    'powershell',
    'pwsh',
    'python',
    'python3',
    'uv',
    'uvx',
    'yarn',
  ].includes(normalized)
    || /^[a-z]:[\\/]/i.test(first)
    || first.startsWith('./')
    || first.startsWith('../')
    || first.startsWith('/');
}

function inferMcpName(command: string, args: string, url?: string): string {
  const packageName = args.split(/\s+/).find((part) => part.includes('/mcp') || part.includes('mcp-') || part.includes('@'));
  const raw = packageName ?? command;
  const withoutVersion = raw.replace(/@latest$/, '');
  const scoped = withoutVersion.match(/^@([^/]+)\/(?:mcp|mcp-.+)$/);
  if (scoped?.[1]) return scoped[1];
  const candidateUrl = url ?? (looksLikeUrl(command) ? command : undefined);
  if (candidateUrl) {
    try {
      const parsed = new URL(candidateUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const repoLike = parts.slice(-1)[0] ?? parsed.hostname;
      return normalizeMcpName(repoLike);
    } catch {
      // fall through to normalized command name
    }
  }
  return normalizeMcpName(withoutVersion);
}

function normalizeMcpName(value: string): string {
  return value
    .replace(/^https?:\/\//i, '')
    .replace(/^@/, '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/^server-/, '')
    .replace(/^mcp-/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    || 'mcp-server';
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
