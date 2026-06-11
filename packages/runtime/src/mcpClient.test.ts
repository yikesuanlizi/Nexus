import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpRuntimeManager, McpStdioClient, mcpToolDisplayName, normalizeMcpServerId } from './mcpClient.js';

describe('McpStdioClient', () => {
  it('starts a stdio MCP server, reads tools, stores serverInfo, and calls a tool', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mini-mcp-'));
    const serverPath = await writeFakeMcpServer(dir);
    const client = new McpStdioClient({
      id: 'fake server',
      name: 'Fake Server',
      command: process.execPath,
      args: serverPath,
      enabled: true,
    });

    try {
      await client.start();

      expect(client.status().status).toBe('running');
      expect(client.status().serverInfo?.name).toBe('fake-stdio');
      expect(client.tools().map((tool) => tool.name)).toEqual(['echo', 'crash']);

      const result = await client.callTool('echo', { message: 'hello MCP' });

      expect(result.content).toEqual([{ type: 'text', text: 'hello MCP' }]);
      expect(result.structuredContent).toEqual({ echoed: 'hello MCP' });
    } finally {
      await client.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks the server dead when the child process exits during a tool call', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mini-mcp-'));
    const serverPath = await writeFakeMcpServer(dir);
    const client = new McpStdioClient({
      id: 'crashy',
      name: 'Crashy',
      command: process.execPath,
      args: serverPath,
      enabled: true,
    });

    try {
      await client.start();
      await expect(client.callTool('crash', {})).rejects.toThrow(/exited|closed|dead/i);
      expect(client.status().status).toBe('dead');
      expect(client.status().error).toMatch(/exited/i);
    } finally {
      await client.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('McpRuntimeManager', () => {
  it('normalizes server IDs, exposes namespaced tool definitions, and renders display names', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mini-mcp-'));
    const serverPath = await writeFakeMcpServer(dir);
    const manager = new McpRuntimeManager();

    try {
      await manager.configure([
        {
          id: 'GitHub MCP!',
          name: 'GitHub MCP',
          command: process.execPath,
          args: serverPath,
          enabled: true,
        },
      ]);

      expect(normalizeMcpServerId('GitHub MCP!')).toBe('github-mcp');
      expect(manager.statuses()[0]).toMatchObject({
        id: 'github-mcp',
        name: 'GitHub MCP',
        status: 'running',
        toolCount: 2,
      });

      const tools = manager.toolDefinitions();
      expect(tools.map((tool) => tool.name)).toContain('mcp__github-mcp__echo');
      expect(mcpToolDisplayName('mcp__github-mcp__echo')).toBe('github-mcp: echo');

      const result = await tools.find((tool) => tool.name === 'mcp__github-mcp__echo')?.execute(
        { message: 'from registry' },
        {
          workspaceRoot: dir,
          threadId: 'thread',
          turnId: 'turn',
          approved: true,
        },
      );

      expect(result?.status).toBe('completed');
      expect(result?.output).toContain('from registry');
    } finally {
      await manager.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeFakeMcpServer(dir: string): Promise<string> {
  const file = path.join(dir, 'fake-mcp-server.mjs');
  await writeFile(file, `
let buffer = Buffer.alloc(0);

process.stderr.write('fake mcp stderr is consumed\\n');

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  process.stdout.write(body);
}

function handle(message) {
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-stdio', version: '1.0.0' }
      }
    });
    return;
  }
  if (message.method === 'notifications/initialized') {
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo a message.',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
              additionalProperties: false
            }
          },
          {
            name: 'crash',
            description: 'Exit the process.',
            inputSchema: { type: 'object', additionalProperties: false }
          }
        ]
      }
    });
    return;
  }
  if (message.method === 'tools/call') {
    if (message.params?.name === 'crash') {
      process.exit(5);
    }
    const text = message.params?.arguments?.message ?? '';
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text }],
        structuredContent: { echoed: text },
        isError: false
      }
    });
  }
}

function pump() {
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) throw new Error('missing content length');
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
    buffer = buffer.slice(bodyEnd);
    handle(JSON.parse(body));
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  pump();
});
`, 'utf8');
  return file;
}
