export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

export const MCP_SERVERS_KEY = 'mcp.servers';

export function normalizeMcpServers(input: unknown): McpServerConfig[] {
  if (!Array.isArray(input)) return [];
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<McpServerConfig>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const command = typeof item.command === 'string' ? item.command.trim() : '';
    if (!name || !command) continue;
    const args = typeof item.args === 'string' ? item.args.trim() : '';
    const id = uniqueId(slugify(typeof item.id === 'string' && item.id.trim() ? item.id : name), seen);
    servers.push({
      id,
      name,
      command,
      args,
      enabled: item.enabled !== false,
    });
  }
  return servers;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'mcp-server';
}

function uniqueId(base: string, seen: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  seen.add(candidate);
  return candidate;
}
