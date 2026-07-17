// HarnessRuntimeRegistry：进程内单例，管理 harnessRunId → 运行时条目映射。
// 职责：
//   1. 注册 harness run（调用方预生成 harnessRunId，立即返回）
//   2. 提供 abortController 用于取消运行中的 run（Gap 1）
//   3. 跟踪 promise 状态（running / completed / failed / cancelled）
//   4. 提供 listByThread 用于 status 路由查询进度
//   5. abortAll 用于进程优雅退出时清理
//
// 注意：本注册表只管进程内运行时状态，持久化（HarnessState）由 GoalTracker 写入 thread.tags。
// — Chinese: process-level registry for harness runs; persistence handled by GoalTracker.

import type { ThreadId } from '@nexus/protocol';
import type { HarnessResult } from '@nexus/runtime';

// 运行时状态：running（运行中）/ completed（完成）/ failed（失败）/ cancelled（已取消）
export type HarnessRuntimeStatus = 'running' | 'completed' | 'failed' | 'cancelled';

// 单个 harness run 的运行时条目
export interface HarnessRunEntry {
  /** 调用方预生成的 harness run ID（Gap 1） */
  harnessRunId: string;
  threadId: ThreadId;
  tenantId: string;
  startedAt: string;
  /** 运行结束时的时间戳（running 状态为 undefined） */
  completedAt?: string;
  /** 用于取消 runTurn 的 AbortController */
  abortController: AbortController;
  /** 后台 runHarness promise */
  promise: Promise<HarnessResult>;
  runtimeStatus: HarnessRuntimeStatus;
  /** 完成时的最终结果 */
  result?: HarnessResult;
  /** 失败或取消时的错误信息 */
  error?: string;
}

// 默认保留时长：24 小时（过期条目由 cleanup 清理）
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * HarnessRuntimeRegistry：进程内单例注册表。
 * 同一进程内所有租户共享一个实例（按 tenantId + threadId 隔离查询）。
 */
export class HarnessRuntimeRegistry {
  private runs = new Map<string, HarnessRunEntry>();

  /**
   * 注册并启动一个 harness run。
   * 调用方负责预生成 harnessRunId 和提供 run 函数（内部调用 agent.runHarness）。
   * 返回注册后的条目，调用方可立即用 entry.harnessRunId 响应 API 请求。
   */
  start(params: {
    harnessRunId: string;
    threadId: ThreadId;
    tenantId: string;
    run: (signal: AbortSignal) => Promise<HarnessResult>;
  }): HarnessRunEntry {
    const { harnessRunId, threadId, tenantId, run } = params;
    if (this.runs.has(harnessRunId)) {
      throw new Error(`Harness run ${harnessRunId} already exists`);
    }
    const abortController = new AbortController();
    const startedAt = new Date().toISOString();

    // run 函数会被立即调用（传入 abortController.signal）
    // — English: run function invoked immediately with abort signal
    const promise = run(abortController.signal);

    const entry: HarnessRunEntry = {
      harnessRunId,
      threadId,
      tenantId,
      startedAt,
      abortController,
      promise,
      runtimeStatus: 'running',
    };
    this.runs.set(harnessRunId, entry);

    // 异步跟踪状态（不阻塞调用方）
    // — English: track terminal status without blocking caller
    promise
      .then((result) => {
        // 可能已被 cancel 标记，避免覆盖
        if (entry.runtimeStatus === 'running') {
          entry.runtimeStatus = 'completed';
          entry.result = result;
          entry.completedAt = new Date().toISOString();
        }
      })
      .catch((err) => {
        if (entry.runtimeStatus !== 'running') return; // 已被 cancel 标记
        if (abortController.signal.aborted) {
          entry.runtimeStatus = 'cancelled';
        } else {
          entry.runtimeStatus = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
        }
        entry.completedAt = new Date().toISOString();
      });

    return entry;
  }

  /** 获取指定 harness run 的运行时条目 */
  get(runId: string): HarnessRunEntry | undefined {
    return this.runs.get(runId);
  }

  /** 列出某 thread 的所有运行时条目（按 startedAt 升序） */
  listByThread(threadId: ThreadId): HarnessRunEntry[] {
    return [...this.runs.values()]
      .filter((entry) => entry.threadId === threadId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /** 获取某 thread 当前运行中的 harness run（若无返回 undefined） */
  activeRunForThread(threadId: ThreadId): HarnessRunEntry | undefined {
    return this.listByThread(threadId).find((entry) => entry.runtimeStatus === 'running');
  }

  /**
   * 取消运行中的 harness run。
   * 返回 true 表示成功触发 abort；false 表示不存在或已结束。
   */
  cancel(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry) return false;
    if (entry.runtimeStatus !== 'running') return false;
    // 标记为 cancelled（避免 promise.then 误标为 completed）
    entry.runtimeStatus = 'cancelled';
    entry.completedAt = new Date().toISOString();
    entry.abortController.abort();
    return true;
  }

  /**
   * 取消某 thread 的所有运行中 harness run（用于线程删除等场景）。
   */
  cancelByThread(threadId: ThreadId): number {
    let count = 0;
    for (const entry of this.listByThread(threadId)) {
      if (entry.runtimeStatus === 'running' && this.cancel(entry.harnessRunId)) count++;
    }
    return count;
  }

  /**
   * 取消所有运行中的 harness run（进程优雅退出时调用）。
   */
  abortAll(): void {
    for (const entry of this.runs.values()) {
      if (entry.runtimeStatus === 'running') {
        entry.runtimeStatus = 'cancelled';
        entry.completedAt = new Date().toISOString();
        entry.abortController.abort();
      }
    }
  }

  /**
   * 清理已结束的旧条目（防止 Map 无限增长）。
   * 默认保留 24 小时。
   */
  cleanup(maxAgeMs: number = DEFAULT_MAX_AGE_MS): void {
    const now = Date.now();
    for (const [runId, entry] of this.runs) {
      if (entry.runtimeStatus === 'running') continue;
      const completedAt = entry.completedAt ? Date.parse(entry.completedAt) : Date.parse(entry.startedAt);
      if (Number.isNaN(completedAt) || now - completedAt > maxAgeMs) {
        this.runs.delete(runId);
      }
    }
  }

  /** 当前注册的 run 总数（含已结束） */
  size(): number {
    return this.runs.size;
  }
}

// 进程内单例（由 server.ts 导入并在 shutdown 时调用 abortAll）
// — English: process-level singleton, imported by server.ts for shutdown cleanup
export const harnessRuntimeRegistry = new HarnessRuntimeRegistry();
