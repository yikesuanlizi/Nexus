// 钉钉工作台 CLI (dws) 包装器 — 桥接 Agent 与钉钉企业数据操作
// Chinese: DingTalk Workspace CLI wrapper — bridges Agent with DingTalk enterprise data operations
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface DwsExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: unknown | null;
}

export interface DwsCliOptions {
  /** dws 可执行文件路径，不传则自动查找（PATH → node_modules/.bin/dws） */
  binaryPath?: string;
  /** 工作目录 */
  cwd?: string;
  /** 超时毫秒，默认 60s */
  timeoutMs?: number;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 查找 dws 可执行文件路径
 * 优先级：显式 binaryPath → PATH 中的 dws → node_modules/.bin/dws
 * Chinese: Resolve dws binary path (explicit → PATH → node_modules/.bin/dws)
 */
function isWindowsScript(binary: string): boolean {
  if (process.platform !== 'win32') return false;
  const lower = binary.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

function resolveDwsBinary(binaryPath?: string): { binary: string; useShell: boolean } {
  const explicit = binaryPath?.trim();
  if (explicit) {
    return { binary: explicit, useShell: isWindowsScript(explicit) };
  }
  // 尝试查找 node_modules/.bin/dws（项目依赖安装方式）
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.cwd(), 'node_modules', '.bin', 'dws.cmd'),
        path.join(process.cwd(), 'node_modules', '.bin', 'dws.ps1'),
        path.join(process.cwd(), 'node_modules', '.bin', 'dws'),
      ]
    : [
        path.join(process.cwd(), 'node_modules', '.bin', 'dws'),
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { binary: candidate, useShell: isWindowsScript(candidate) };
    }
  }
  // fallback: 依赖 PATH 中的 dws（全局安装）
  return { binary: 'dws', useShell: false };
}

/**
 * 检测 dws 是否已安装且可执行
 * Chinese: Check if dws is installed and executable
 */
export async function isDwsAvailable(binaryPath?: string): Promise<boolean> {
  try {
    const result = await execDws(['--version'], { binaryPath, timeoutMs: 5_000 });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 执行 dws 命令并返回结构化结果
 * Chinese: Execute dws command and return structured result
 */
export async function execDws(
  args: string[],
  options: DwsCliOptions = {},
): Promise<DwsExecResult> {
  const { binary, useShell } = resolveDwsBinary(options.binaryPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...process.env, ...options.env };

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        json: null,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const trimmedStdout = stdout.trim();
      let json: unknown | null = null;
      // 如果参数含 -f json，尝试解析输出
      if (args.includes('-f') && args.includes('json') && trimmedStdout) {
        try {
          json = JSON.parse(trimmedStdout);
        } catch {
          // 解析失败则保留原始 stdout
        }
      }
      resolve({
        exitCode: killed ? -2 : (code ?? -1),
        stdout: trimmedStdout,
        stderr: stderr.trim(),
        json,
      });
    });
  });
}

/**
 * 查询 dws schema（可用产品与工具列表）
 * Chinese: Query dws schema (available products and tools)
 */
export async function dwsSchema(
  toolPath?: string,
  options?: DwsCliOptions,
): Promise<DwsExecResult> {
  const args = ['schema'];
  if (toolPath) {
    args.push(toolPath);
  }
  args.push('-f', 'json');
  return execDws(args, options);
}

/**
 * 执行 dws 命令（带 --yes 跳过确认，适合 Agent 场景）
 * Chinese: Execute dws command with --yes flag for Agent scenarios
 */
export async function dwsExec(
  command: string[],
  options?: DwsCliOptions & {
    /** 输出格式：json / table / raw */
    format?: 'json' | 'table' | 'raw';
    /** 预览模式，不实际执行 */
    dryRun?: boolean;
    /** jq 过滤表达式 */
    jq?: string;
    /** 输出到文件 */
    outputFile?: string;
  },
): Promise<DwsExecResult> {
  const { format = 'json', dryRun, jq, outputFile, ...cliOptions } = options ?? {};
  const args = [...command, '--yes', '-f', format];
  if (dryRun) {
    args.push('--dry-run');
  }
  if (jq) {
    args.push('--jq', jq);
  }
  if (outputFile) {
    args.push('-o', outputFile);
  }
  return execDws(args, cliOptions);
}

/**
 * 获取 dws 认证状态
 * Chinese: Get dws authentication status
 */
export async function dwsAuthStatus(options?: DwsCliOptions): Promise<DwsExecResult> {
  return execDws(['auth', 'status', '-f', 'json'], options);
}

/**
 * 列出所有可用产品
 * Chinese: List all available products
 */
export async function dwsListProducts(options?: DwsCliOptions): Promise<DwsExecResult> {
  return execDws(['schema', '-f', 'json'], options);
}
