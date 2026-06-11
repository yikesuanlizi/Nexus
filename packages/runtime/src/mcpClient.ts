import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolDefinition, ToolParamSchema, ToolResult } from '@nexus/tools';

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

export type McpServerRuntimeStatus = 'disabled' | 'starting' | 'running' | 'failed' | 'dead';

export interface McpServerInfo {
  name?: string;
  version?: string;
  title?: string;
  [key: string]: unknown;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: ToolParamSchema | Record<string, unknown>;
}

export interface McpCallToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  meta?: unknown;
}

export interface McpServerStatusView {
  id: string;
  name: string;
  enabled: boolean;
  status: McpServerRuntimeStatus;
  serverInfo?: McpServerInfo;
  error?: string;
  toolCount: number;
  tools: Array<{ name: string; description?: string; namespacedName?: string }>;
  stderr?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

const INITIALIZE_TIMEOUT_MS = 30_000;
const LIST_TOOLS_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private runtimeStatus: McpServerRuntimeStatus;
  private lastError: string | undefined;
  private stderrTail = '';
  private toolList: McpToolInfo[] = [];
  private serverInfo: McpServerInfo | undefined;

  constructor(private readonly config: McpServerConfig) {
    this.runtimeStatus = config.enabled ? 'disabled' : 'disabled';
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.runtimeStatus = 'disabled';
      return;
    }
    if (this.runtimeStatus === 'running') return;

    this.runtimeStatus = 'starting';
    this.lastError = undefined;
    this.stderrTail = '';
    this.toolList = [];
    this.buffer = Buffer.alloc(0);

    try {
      const args = splitArgs(this.config.args);
      this.child = spawn(this.config.command, args, {
        stdio: 'pipe',
        windowsHide: true,
      });

      this.child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
      this.child.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk));
      this.child.on('error', (error) => this.markFailed(error.message));
      this.child.on('exit', (code, signal) => {
        if (this.runtimeStatus === 'running' || this.runtimeStatus === 'starting') {
          const reason = `MCP server exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`;
          this.markDead(reason);
        }
      });

      const initialize = await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Nexus', version: '0.1.0' },
      }, INITIALIZE_TIMEOUT_MS) as { serverInfo?: McpServerInfo };
      this.serverInfo = initialize.serverInfo;
      this.notify('notifications/initialized', {});

      const listed = await this.request('tools/list', {}, LIST_TOOLS_TIMEOUT_MS) as { tools?: McpToolInfo[] };
      this.toolList = Array.isArray(listed.tools) ? listed.tools : [];
      this.runtimeStatus = 'running';
    } catch (error) {
      this.markFailed(error instanceof Error ? error.message : String(error));
      await this.stop();
      throw error;
    }
  }

  async callTool(tool: string, args: Record<string, unknown>, timeoutMs = TOOL_CALL_TIMEOUT_MS): Promise<McpCallToolResult> {
    if (this.runtimeStatus !== 'running') {
      throw new Error(`MCP server ${this.config.name} is ${this.runtimeStatus}`);
    }
    const result = await this.request('tools/call', {
      name: tool,
      arguments: args,
    }, timeoutMs) as Partial<McpCallToolResult>;
    return {
      content: Array.isArray(result.content) ? result.content : [],
      structuredContent: result.structuredContent,
      isError: result.isError,
      meta: result.meta,
    };
  }

  tools(): McpToolInfo[] {
    return [...this.toolList];
  }

  status(): McpServerStatusView {
    return {
      id: normalizeMcpServerId(this.config.id || this.config.name),
      name: this.config.name,
      enabled: this.config.enabled,
      status: this.runtimeStatus,
      serverInfo: this.serverInfo,
      error: this.lastError,
      toolCount: this.toolList.length,
      tools: this.toolList.map((tool) => ({ name: tool.name, description: tool.description })),
      stderr: this.stderrTail || undefined,
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP server closed'));
    }
    this.pending.clear();
    if (!child) return;
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error('MCP server stdin is not writable'));
    }
    const id = this.nextRequestId++;
    const message = { jsonrpc: '2.0', id, method, params };
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child?.stdin.writable) return;
    const message = { jsonrpc: '2.0', method, params };
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.markDead('MCP response missing Content-Length header');
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(body) as typeof message;
    } catch (error) {
      this.markDead(`Invalid MCP JSON-RPC response: ${String(error)}`);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'MCP JSON-RPC error'));
      return;
    }
    pending.resolve(message.result);
  }

  private onStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4000);
  }

  private markFailed(message: string): void {
    this.runtimeStatus = 'failed';
    this.lastError = message;
    this.rejectPending(message);
  }

  private markDead(message: string): void {
    this.runtimeStatus = 'dead';
    this.lastError = message;
    this.rejectPending(message);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export class McpRuntimeManager {
  private clients = new Map<string, { config: McpServerConfig; client?: McpStdioClient }>();

  async configure(configs: McpServerConfig[]): Promise<void> {
    const normalized = new Map<string, McpServerConfig>();
    for (const config of configs) {
      const id = normalizeMcpServerId(config.id || config.name);
      normalized.set(id, { ...config, id });
    }

    for (const [id, entry] of this.clients) {
      if (!normalized.has(id) || JSON.stringify(entry.config) !== JSON.stringify(normalized.get(id))) {
        await entry.client?.stop();
        this.clients.delete(id);
      }
    }

    for (const [id, config] of normalized) {
      if (this.clients.has(id)) continue;
      if (!config.enabled) {
        this.clients.set(id, { config });
        continue;
      }
      const client = new McpStdioClient(config);
      this.clients.set(id, { config, client });
      try {
        await client.start();
      } catch {
        // Status is kept on the client for UI/API inspection.
      }
    }
  }

  toolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [serverId, entry] of this.clients) {
      const client = entry.client;
      if (!client || client.status().status !== 'running') continue;
      for (const tool of client.tools()) {
        const toolName = normalizeMcpToolName(tool.name);
        const namespacedName = mcpNamespacedToolName(serverId, toolName);
        definitions.push({
          name: namespacedName,
          description: tool.description
            ? `${entry.config.name}: ${tool.description}`
            : `MCP tool ${entry.config.name}: ${tool.name}`,
          parameters: normalizeToolSchema(tool.inputSchema),
          requiredPolicy: 'readonly',
          requiresApproval: false,
          timeoutMs: TOOL_CALL_TIMEOUT_MS,
          maxOutputLength: 30_000,
          execute: async (args) => {
            const result = await client.callTool(tool.name, args, TOOL_CALL_TIMEOUT_MS);
            return mcpResultToToolResult(result);
          },
        });
      }
    }
    return definitions;
  }

  statuses(): McpServerStatusView[] {
    return [...this.clients.entries()].map(([serverId, entry]) => {
      if (!entry.client) {
        return {
          id: serverId,
          name: entry.config.name,
          enabled: entry.config.enabled,
          status: 'disabled',
          toolCount: 0,
          tools: [],
        };
      }
      const status = entry.client.status();
      return {
        ...status,
        id: serverId,
        tools: status.tools.map((tool) => ({
          ...tool,
          namespacedName: mcpNamespacedToolName(serverId, normalizeMcpToolName(tool.name)),
        })),
      };
    });
  }

  async shutdown(): Promise<void> {
    for (const entry of this.clients.values()) {
      await entry.client?.stop();
    }
    this.clients.clear();
  }
}

export function normalizeMcpServerId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'mcp-server';
}

export function normalizeMcpToolName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'tool';
}

export function mcpNamespacedToolName(serverId: string, toolName: string): string {
  return `mcp__${normalizeMcpServerId(serverId)}__${normalizeMcpToolName(toolName)}`;
}

export function mcpToolDisplayName(namespacedName: string): string {
  const identity = parseMcpNamespacedToolName(namespacedName);
  return identity ? `${identity.serverId}: ${identity.toolName}` : namespacedName;
}

export function parseMcpNamespacedToolName(name: string): { serverId: string; toolName: string } | null {
  const match = /^mcp__([^_].*?)__(.+)$/.exec(name);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

function mcpResultToToolResult(result: McpCallToolResult): ToolResult {
  const output = result.content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '');
      }
      return typeof part === 'string' ? part : JSON.stringify(part);
    })
    .filter(Boolean)
    .join('\n');
  return {
    output: output || JSON.stringify(result),
    data: {
      content: result.content,
      structuredContent: result.structuredContent,
      isError: result.isError,
      meta: result.meta,
    },
    status: result.isError ? 'failed' : 'completed',
    error: result.isError ? { message: output || 'MCP tool returned an error' } : undefined,
  };
}

function normalizeToolSchema(schema: McpToolInfo['inputSchema']): ToolParamSchema {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  const candidate = schema as ToolParamSchema;
  return {
    type: typeof candidate.type === 'string' ? candidate.type : 'object',
    description: candidate.description,
    properties: candidate.properties,
    required: candidate.required,
    additionalProperties: candidate.additionalProperties,
    enum: candidate.enum,
    items: candidate.items,
  };
}

export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}
