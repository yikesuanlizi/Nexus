import { describe, expect, it } from 'vitest';
import { normalizeMcpServers } from './mcp.js';

describe('normalizeMcpServers', () => {
  it('keeps only valid MCP server configs and assigns stable ids', () => {
    const result = normalizeMcpServers([
      { id: '', name: 'playwright', command: 'npx', args: '@playwright/mcp@latest', enabled: true },
      { id: 'bad', name: 'missing command', command: '', args: '', enabled: true },
    ]);

    expect(result).toEqual([
      {
        id: 'playwright',
        name: 'playwright',
        command: 'npx',
        args: '@playwright/mcp@latest',
        enabled: true,
      },
    ]);
  });
});
