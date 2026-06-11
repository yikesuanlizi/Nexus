// ─── Tool definition ────────────────────────────────────────────────────────
import type { CommandStatus } from '@nexus/protocol';
import type { SandboxLevel } from '@nexus/sandbox';

/** Schema for tool parameters (JSON Schema subset). */
export interface ToolParamSchema {
  type: string;
  description?: string;
  properties?: Record<string, ToolParamSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: string[];
  items?: ToolParamSchema;
}

/** A registered tool definition. */
export interface ToolDefinition {
  /** Unique tool name (e.g. "read_file", "shell_command"). */
  name: string;
  /** Description for the model. */
  description: string;
  /** JSON Schema for the arguments. */
  parameters: ToolParamSchema;
  /** Execution timeout in ms. */
  timeoutMs?: number;
  /** Max output length in characters before truncation. */
  maxOutputLength?: number;
  /** Which sandbox level is required. */
  requiredPolicy: SandboxLevel;
  /** Whether this tool requires HITL approval. */
  requiresApproval?: boolean;
  /** The actual implementation. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Context passed to every tool execution. */
export interface ToolContext {
  /** Absolute workspace root. */
  workspaceRoot: string;
  /** Current thread ID. */
  threadId: string;
  /** Current turn ID. */
  turnId: string;
  /** Whether execution is approved. */
  approved: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/** Result of a tool execution. */
export interface ToolResult {
  /** Human-readable output. */
  output: string;
  /** Structured data if applicable. */
  data?: unknown;
  /** Error details if failed. */
  error?: { message: string; code?: string };
  /** Exit code (for shell commands). */
  exitCode?: number;
  /** Status. */
  status: CommandStatus;
}

// ─── Tool Registry ──────────────────────────────────────────────────────────
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Get tools formatted for OpenAI-compatible tool_choice. */
  toOpenAITools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: ToolParamSchema };
  }> {
    return this.list().sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /** Execute a tool by name. */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        output: `Unknown tool: ${name}`,
        status: 'failed',
        error: { message: `Tool "${name}" not found`, code: 'UNKNOWN_TOOL' },
      };
    }

    try {
      const timeout = tool.timeoutMs ?? 60_000;
      const result = await withTimeout(tool.execute(args, ctx), timeout);
      // Truncate output
      const maxLen = tool.maxOutputLength ?? 50_000;
      if (result.output.length > maxLen) {
        const originalLength = result.output.length;
        result.output =
          result.output.slice(0, maxLen) +
          `\n... [truncated ${originalLength - maxLen} chars]`;
        result.data = withTruncationMetadata(result.data, {
          originalLength,
          returnedLength: result.output.length,
          maxOutputLength: maxLen,
        });
      }
      return result;
    } catch (err) {
      return {
        output: `Tool error: ${String(err)}`,
        status: 'failed',
        error: { message: String(err), code: 'EXECUTION_ERROR' },
      };
    }
  }
}

function withTruncationMetadata(
  data: unknown,
  truncation: { originalLength: number; returnedLength: number; maxOutputLength: number },
): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), truncation };
  }
  return { value: data, truncation };
}

/** Wrap a promise with a timeout. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
