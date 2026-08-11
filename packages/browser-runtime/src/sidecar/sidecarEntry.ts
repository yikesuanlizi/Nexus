#!/usr/bin/env node
// Sidecar 可执行入口：桌面 Host（Rust 或开发期 node 脚本）spawn 的目标进程。
// 用法（Node ≥23.6 支持直接运行 TS）：
//   node packages/browser-runtime/src/sidecar/sidecarEntry.ts --runtime=fake --task-id=<id> [--site=default]
//   node dist/sidecar/sidecarEntry.js --runtime=playwright --task-id=<id> --headless=false
// 协议：stdin 收 JSONL 命令帧，stdout 只输出 JSONL 响应/事件帧，日志一律走 stderr
// （架构文档 14.1：日志不得写入协议 stdout）。
// — English: sidecar executable entry — the process spawned by the desktop host.
//   stdin carries JSONL command frames; stdout carries ONLY JSONL response/event
//   frames; all logging goes to stderr (§14.1: logs never pollute the protocol stdout).
// 注意：Node ≥23.6 的 type stripping 支持显式 .ts 后缀相对导入，但不会把 .js 映射到 .ts；
// 因此本入口（唯一被 node 直接执行的源码文件）使用 .ts 后缀导入。tsc 通过
// allowImportingTsExtensions + rewriteRelativeImportExtensions 接受并重写为 .js 产物，
// 源码直跑（node --experimental-loader ts-js-resolver）与 dist 产物（node dist/...）均可用。
// — English: Node ≥23.6 type stripping resolves explicit .ts specifiers but does
//   NOT map .js → .ts; this entry (the only source file executed directly by node)
//   therefore imports with .ts suffixes. tsc accepts them via
//   allowImportingTsExtensions and rewrites them to .js in the dist output via
//   rewriteRelativeImportExtensions, so both source (node --experimental-loader
//   ts-js-resolver) and dist execution work.
import { createStdinStdoutLoop } from './sidecar.ts';
import { FakeBrowserRuntime, type FakeSiteDefinition } from '../fakeRuntime.ts';
import { PlaywrightRuntime } from '../playwrightRuntime.ts';
import { GOLDEN_TASKS } from '../golden/tasks.ts';

interface CliArgs {
  runtime: 'fake' | 'playwright';
  taskId: string;
  site: string;
  headless: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { runtime: 'fake', taskId: 'sidecar-task', site: 'default', headless: true };
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.replace(/^--/, '') : arg.slice(2, eq);
    const value = eq === -1 ? 'true' : arg.slice(eq + 1);
    switch (key) {
      case 'runtime': out.runtime = value === 'playwright' ? 'playwright' : 'fake'; break;
      case 'task-id': out.taskId = value; break;
      case 'site': out.site = value; break;
      case 'headless': out.headless = value !== 'false'; break;
      default: break;
    }
  }
  return out;
}

// 内置默认测试站点（fake 模式的确定性宿主；Playwright 模式忽略）。
// — English: built-in default site for fake mode; ignored in playwright mode.
function defaultSite(): FakeSiteDefinition {
  return {
    startUrl: 'https://example.com/list',
    pages: [
      {
        url: 'https://example.com/list',
        title: '结果列表',
        elements: [
          { ref: 'link-1', role: 'link', name: '结果一', text: '结果一', href: 'https://example.com/detail' },
        ],
        content: [{ type: 'heading', text: '结果列表' }],
        onAction: (action) => {
          if (action.kind === 'click' && action.targetRef === 'link-1') {
            return { kind: 'navigate', url: 'https://example.com/detail' };
          }
          return undefined;
        },
      },
      {
        url: 'https://example.com/detail',
        title: '结果详情',
        elements: [{ ref: 'back', role: 'link', name: '返回', text: '返回' }],
        content: [{ type: 'paragraph', text: '详情内容' }],
      },
    ],
  };
}

const args = parseArgs(process.argv.slice(2));

// 站点解析：--site=default 用内置演示站点；--site=golden:<taskId> 用黄金任务自带站点
// （与 runGoldenTaskWithOrchestrator 的站点自洽，进程级黄金任务直接复用）。
// — English: site resolution — --site=default uses the built-in demo site;
//   --site=golden:<taskId> uses the golden task's own site definition.
function resolveSite(site: string): FakeSiteDefinition {
  if (site.startsWith('golden:')) {
    const taskId = site.slice('golden:'.length);
    const task = GOLDEN_TASKS.find((t) => t.id === taskId);
    if (task === undefined) {
      process.stderr.write(`[sidecar] unknown golden task: ${taskId}\n`);
      process.exit(2);
    }
    return task.site;
  }
  return defaultSite();
}

const runtime = args.runtime === 'playwright'
  ? new PlaywrightRuntime({ headless: args.headless })
  : new FakeBrowserRuntime(resolveSite(args.site));

process.stderr.write(`[sidecar:${args.taskId}] starting runtime=${args.runtime} headless=${String(args.headless)} pid=${process.pid}\n`);

const loop = createStdinStdoutLoop({
  runtime,
  log: (message: string) => process.stderr.write(`[sidecar:${args.taskId}] ${message}\n`),
});

loop.start();

// 优雅退出：Rust Host 侧 stop() 先发 session.close，再 SIGTERM。
// — English: graceful exit — the host sends session.close, then SIGTERM.
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`[sidecar:${args.taskId}] received ${signal}, shutting down\n`);
  try {
    await loop.stop();
  } finally {
    process.exit(0);
  }
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
