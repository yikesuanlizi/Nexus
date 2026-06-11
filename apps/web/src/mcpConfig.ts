import type { McpConfig } from './types.js';

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

export function mcpFromCommandText(text: string): McpConfig {
  const trimmed = text.trim();
  if (!trimmed) {
    return { id: '', name: '', command: '', args: '', enabled: true };
  }
  const [command = '', ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  const name = inferMcpName(command, args);
  return {
    id: '',
    name,
    command,
    args,
    enabled: true,
  };
}

function inferMcpName(command: string, args: string): string {
  const packageName = args.split(/\s+/).find((part) => part.includes('/mcp') || part.includes('mcp-') || part.includes('@'));
  const raw = packageName ?? command;
  const withoutVersion = raw.replace(/@latest$/, '');
  const scoped = withoutVersion.match(/^@([^/]+)\/(?:mcp|mcp-.+)$/);
  if (scoped?.[1]) return scoped[1];
  return withoutVersion
    .replace(/^@/, '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/^server-/, '')
    .replace(/^mcp-/, '')
    || 'mcp-server';
}
