import { describe, expect, it } from 'vitest';
import { mcpFromCommandText, resolveMcpDraftFromInput } from './mcpConfig.js';

describe('mcpFromCommandText', () => {
  it('keeps package-style commands and derives a name from url inputs', () => {
    expect(mcpFromCommandText('npx @playwright/mcp@latest --port 8080')).toMatchObject({
      command: 'npx',
      args: '@playwright/mcp@latest --port 8080',
      name: 'playwright',
    });

    expect(mcpFromCommandText('npx @modelcontextprotocol/server-filesystem https://github.com/modelcontextprotocol/server-filesystem')).toMatchObject({
      command: 'npx',
      args: '@modelcontextprotocol/server-filesystem https://github.com/modelcontextprotocol/server-filesystem',
      name: 'filesystem',
    });
  });

  it('treats url-only MCP input as a source draft instead of an executable command', () => {
    expect(mcpFromCommandText('请添加 https://github.com/modelcontextprotocol/server-filesystem')).toMatchObject({
      command: '',
      args: '',
      name: 'filesystem',
      enabled: false,
      sourceUrl: 'https://github.com/modelcontextprotocol/server-filesystem',
      sourceKind: 'url',
    });
  });

  it('fetches a source-backed MCP draft only for URL source inputs', async () => {
    const calls: string[] = [];
    const result = await resolveMcpDraftFromInput('https://github.com/modelcontextprotocol/server-filesystem', async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        draft: {
          id: '',
          name: 'filesystem',
          command: 'npx',
          args: '-y @modelcontextprotocol/server-filesystem .',
          enabled: true,
          sourceKind: 'url',
          sourceUrl: 'https://github.com/modelcontextprotocol/server-filesystem',
        },
      }));
    });

    expect(calls).toEqual(['/api/mcp/draft']);
    expect(result.draft.command).toBe('npx');
  });
});
