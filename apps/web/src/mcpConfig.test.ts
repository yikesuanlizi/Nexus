import { describe, expect, it } from 'vitest';
import { mcpFromCommandText, normalizeStoredMcps } from './mcpConfig.js';

describe('normalizeStoredMcps', () => {
  it('removes the old disabled filesystem placeholder while keeping user MCPs', () => {
    expect(normalizeStoredMcps([
      {
        id: 'default-filesystem',
        name: 'filesystem',
        command: 'npx',
        args: '@modelcontextprotocol/server-filesystem .',
        enabled: false,
      },
      {
        id: 'custom',
        name: 'custom',
        command: 'node',
        args: 'server.js',
        enabled: true,
      },
    ])).toEqual([
      {
        id: 'custom',
        name: 'custom',
        command: 'node',
        args: 'server.js',
        enabled: true,
      },
    ]);
  });

  it('prefills a readable name from slash-command MCP text', () => {
    expect(mcpFromCommandText('npx @playwright/mcp@latest')).toMatchObject({
      name: 'playwright',
      command: 'npx',
      args: '@playwright/mcp@latest',
      enabled: true,
    });
  });
});
