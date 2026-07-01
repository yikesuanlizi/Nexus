// MCP 服务器配置 — Chinese: MCP server config
export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

// MCP 服务器配置存储键 — Chinese: MCP servers storage key
export const MCP_SERVERS_KEY = 'mcp.servers';

// 规范化用户提供的 MCP 服务器输入 — Chinese: normalize incoming MCP servers
export function normalizeMcpServers(input: unknown): McpServerConfig[] {
  if (!Array.isArray(input)) return [];
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<McpServerConfig>;
    // 只有名称和命令都是非空字符串才使用 — Chinese: only accept valid name & command
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

// 将字符串转换为 kebab-case slug（支持中文） — Chinese: slugify with Chinese support
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'mcp-server';
}

// 若已存在则生成唯一的 id（追加递增数字） — Chinese: ensure unique id
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
