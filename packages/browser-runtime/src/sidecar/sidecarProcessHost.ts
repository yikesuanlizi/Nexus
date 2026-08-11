// Sidecar 进程宿主：spawn 真实的 Node Sidecar 子进程（sidecarEntry），把 stdin/stdout
// 接成 JSONL 传输，返回 BrowserSessionHandle（经 createSidecarClient）。Rust Host 或
// Agent Runtime 进程用它拉起浏览器 Sidecar；stderr 转发给日志回调。
// — English: Sidecar process host — spawns the real Node Sidecar child process
//   (sidecarEntry), wires stdin/stdout as the JSONL transport and returns a
//   BrowserSessionHandle via createSidecarClient. Used by the Rust host or the
//   Agent Runtime process to bring up the browser sidecar; stderr is forwarded
//   to a log callback.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserSessionHandle } from '../port.js';
import { createSidecarClient, type SidecarTransport } from './sidecarClient.js';

const here = dirname(fileURLToPath(import.meta.url));

// 源码入口（.ts）需要 ts-js-resolver loader；编译产物（dist/*.js）不需要。
// — English: TS source entries need the ts-js-resolver loader; compiled dist/*.js do not.
export function resolveSidecarEntryPath(entryPath?: string): { entry: string; loader?: string } {
  if (entryPath !== undefined && entryPath !== '') {
    return entryPath.endsWith('.js') || entryPath.endsWith('.mjs')
      ? { entry: entryPath }
      : { entry: entryPath, loader: join(here, '../../scripts/register-ts-js-resolver.mjs') };
  }
  // 默认：优先编译产物（dist），否则源码（.ts + loader）。
  // — English: default — compiled dist first, source fallback (with loader).
  const distEntry = join(here, '../../dist/sidecar/sidecarEntry.js');
  const srcEntry = join(here, 'sidecarEntry.ts');
  return isAbsolute(srcEntry) && !fileExistsSync(distEntry)
    ? { entry: srcEntry, loader: join(here, '../../scripts/register-ts-js-resolver.mjs') }
    : { entry: distEntry };
}

function fileExistsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

// Windows 强制终止：taskkill /pid <pid> /t /f（杀进程树）；其他平台 SIGKILL。
// — English: force termination — taskkill /pid <pid> /t /f on Windows (kills the
//   whole tree); SIGKILL elsewhere.
async function forceKill(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  } else {
    child.kill('SIGKILL');
  }
}

export interface SpawnSidecarProcessOptions {
  taskId: string;
  runtime?: 'fake' | 'playwright';
  site?: string;
  headless?: boolean;
  entryPath?: string;
  cwd?: string;
  env?: Record<string, string>;
  log?: (line: string) => void;
  onActionStatus?: (payload: unknown) => void;
  commandTimeoutMs?: number;
}

export interface SpawnedSidecarProcess {
  handle: BrowserSessionHandle;
  child: ChildProcess;
  // 优雅停止：先 session.close，再 SIGTERM，超时 SIGKILL。
  // — English: graceful stop — session.close, then SIGTERM, then SIGKILL on timeout.
  stop(timeoutMs?: number): Promise<void>;
  // 进程退出码（null = 未退出）。
  // — English: child exit code (null = still running).
  exitCode: Promise<number | null>;
}

export async function spawnSidecarProcess(options: SpawnSidecarProcessOptions): Promise<SpawnedSidecarProcess> {
  const { entry, loader } = resolveSidecarEntryPath(options.entryPath);
  const nodeArgs: string[] = [];
  if (loader !== undefined) {
    // loader 参数必须是 file:// URL：Node 直接按 URL 加载 --experimental-loader 的值，
    // Windows 绝对路径（D:\...）会被误判为 'd:' scheme。
    // — English: the loader argument must be a file:// URL — Node loads the
    //   --experimental-loader value as a URL directly, and Windows absolute
    //   paths (D:\...) would be misread as a 'd:' scheme.
    nodeArgs.push('--import', pathToFileURL(loader).href);
  }
  const child = spawn(
    process.execPath,
    [
      ...nodeArgs,
      entry,
      `--runtime=${options.runtime ?? 'fake'}`,
      `--task-id=${options.taskId}`,
      ...(options.site !== undefined ? [`--site=${options.site}`] : []),
      ...(options.headless === false ? ['--headless=false'] : []),
    ],
    {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const log = options.log ?? ((): void => {});
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() !== '') log(line);
    }
  });

  // child stdin/stdout → JSONL transport
  // — English: child stdin/stdout as the JSONL transport.
  const transport: SidecarTransport = {
    sendLine: (line: string) => {
      if (!child.stdin?.writable) {
        throw new Error('sidecar stdin not writable');
      }
      child.stdin.write(`${line}\n`);
    },
    onLine: (handler: (line: string) => void) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim() !== '') handler(line);
        }
      });
    },
    close: () => {
      try {
        child.stdin?.end();
      } catch {
        // 已关闭
      }
    },
  };

  const handle = await createSidecarClient({
    taskId: options.taskId,
    transport,
    timeoutMs: options.commandTimeoutMs,
    onActionStatus: options.onActionStatus,
  });

  const exitCode = new Promise<number | null>((resolve) => {
    let settled = false;
    const done = (value: number | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on('exit', (code) => {
      log(`[sidecar] child exited code=${String(code)} signal=${String(child.signalCode)}`);
      done(code);
    });
    // Windows 上 taskkill 强杀后管道 ECONNRESET 会先触发 'error'；延迟 resolve
    // 给 'exit' 事件一个窗口，避免把正常终止误判为 null。
    // — English: on Windows a hard taskkill closes the stdio pipes first and the
    //   child emits 'error' before 'exit'; delay the resolve to give 'exit' a
    //   window so a normal termination is not misreported as null.
    child.on('error', (err) => {
      log(`[sidecar] child error: ${String(err)}`);
      setTimeout(() => done(null), 300);
    });
  });

  // 已退出判定：exitCode 与 signalCode 二选一非 null（信号终止时 exitCode 为 null）。
  // — English: exited means exitCode OR signalCode is set (signal termination
  //   leaves exitCode null).
  function childExited(): boolean {
    return child.exitCode !== null || child.signalCode !== null;
  }

  const stop = async (timeoutMs = 5000): Promise<void> => {
    try {
      await handle.close('host stop');
    } catch {
      // 尽力而为
    }
    transport.close();
    if (childExited()) return;
    const exited = new Promise<number | null>((resolve) => {
      let settled = false;
      const done = (value: number | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once('exit', (code) => done(code));
      child.once('error', () => setTimeout(() => done(null), 300));
    });
    // 先给优雅窗口：SIGTERM（sidecarEntry 的 shutdown handler 会做 session 收尾）。
    // — English: graceful window first — SIGTERM (sidecarEntry's shutdown
    //   handler performs session cleanup).
    child.kill('SIGTERM');
    const graceMs = Math.min(timeoutMs, 2000);
    const term = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), graceMs)),
    ]);
    if (term !== null) return;
    // 强制终止：Windows 上 child.kill(SIGKILL) 实测不可靠（信号仅被记录），
    // 用 taskkill /t /f 终止整个进程树；其他平台用 SIGKILL。
    // — English: force termination — child.kill(SIGKILL) is unreliable on
    //   Windows (the signal is only recorded), so we use taskkill /t /f to kill
    //   the whole process tree; SIGKILL elsewhere.
    await forceKill(child);
    await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  };

  return { handle, child, stop, exitCode };
}
