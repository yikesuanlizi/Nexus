import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadStore } from '@nexus/storage';
import { readJson, sendError, sendJson } from '../shared/http.js';
import type { TenantContext } from '../shared/tenant.js';

// 运行控制动作 — Chinese: run control actions
export type RunControlAction = 'interrupt' | 'resume' | 'rollback' | 'approve' | 'deny' | 'retry';

// 处理运行监控与控制路由（列出 run 记录、事件、控制调用、管理员监控）
// — Chinese: handle run monitor and control routes (list run records, events, control calls, admin monitor)
export async function handleRunMonitorRoute(options: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  segments: string[];
  store: ThreadStore;
  tenantContext: TenantContext;
  isAdmin?: boolean;
  adminToken?: string;
  onControlRun?: (action: RunControlAction, request: {
    runId: string;
    threadId?: string;
    checkpointId?: string;
    reason?: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
}): Promise<boolean> {
  const { req, res, segments, store, tenantContext, url } = options;

  if (segments[0] === 'api' && segments[1] === 'runs') {
    // GET /api/runs — 按条件列出运行记录（可选 threadId、status、limit）
    // — Chinese: GET /api/runs — list run records with optional threadId/status/limit
    if (req.method === 'GET' && segments.length === 2) {
      const runs = await store.listRunRecords?.({
        threadId: url.searchParams.get('threadId') ?? undefined,
        status: url.searchParams.get('status') as never || undefined,
        limit: Number(url.searchParams.get('limit') ?? 100),
      }) ?? [];
      sendJson(res, 200, { runs });
      return true;
    }

    // GET /api/runs/threads — 按 thread 分组查询运行记录（过滤已删除 thread）
    // — Chinese: GET /api/runs/threads — query runs grouped by thread (filter deleted threads)
    if (req.method === 'GET' && segments.length === 3 && segments[2] === 'threads') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const threads = await listThreadsWithRuns(store, limit);
      sendJson(res, 200, { threads });
      return true;
    }

    // GET /api/runs/:runId/events — 列出特定运行的事件
    // — Chinese: GET /api/runs/:runId/events — list events for a specific run
    if (req.method === 'GET' && segments.length === 4 && segments[3] === 'events') {
      const events = await store.listRunEvents?.(segments[2], {
        category: url.searchParams.get('category') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 500),
      }) ?? [];
      sendJson(res, 200, { events });
      return true;
    }

    // POST /api/runs/:runId/control — 发起运行控制动作（interrupt/resume/rollback/approve/deny/retry）
    // — Chinese: POST /api/runs/:runId/control — dispatch run control actions
    if (req.method === 'POST' && segments.length === 4 && segments[3] === 'control') {
      const body = await readJson<{ action?: RunControlAction; threadId?: string; checkpointId?: string; reason?: string } & Record<string, unknown>>(req);
      const action = body.action;
      if (!action || !['interrupt', 'resume', 'rollback', 'approve', 'deny', 'retry'].includes(action)) {
        sendError(res, 400, 'Unsupported run control action');
        return true;
      }
      const now = new Date().toISOString();
      if (!store.appendRunEvent || !store.updateRunRecord) {
        sendError(res, 501, 'Run monitor store is not available');
        return true;
      }
      let result: unknown = null;
      let controlError: string | null = null;
      try {
        result = await options.onControlRun?.(action, {
          runId: segments[2],
          threadId: body.threadId,
          checkpointId: body.checkpointId,
          reason: body.reason,
          payload: body,
        }) ?? null;
      } catch (error) {
        controlError = error instanceof Error ? error.message : String(error);
      }
      // 追加控制事件并更新运行记录 — Chinese: append control event and update run record
      await store.appendRunEvent({
        eventId: `control_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        runId: segments[2],
        tenantId: tenantContext.tenantId,
        threadId: body.threadId ?? '',
        sequence: Date.now(),
        category: 'control',
        type: `control.${action}`,
        level: controlError ? 'error' : action === 'deny' ? 'warning' : 'info',
        message: controlError ?? body.reason ?? `Run control action: ${action}`,
        metadata: {
          checkpointId: body.checkpointId ?? null,
          status: controlError ? 'failed' : 'completed',
          error: controlError,
        },
        createdAt: now,
      });
      await store.updateRunRecord(segments[2], {
        activeStep: `control.${action}`,
        updatedAt: now,
      });
      if (controlError) {
        sendJson(res, 409, { ok: false, error: controlError });
        return true;
      }
      sendJson(res, 200, { ok: true, result });
      return true;
    }
  }

  // /api/admin/runs — 管理员级运行监控（需要管理员角色或 x-nexus-admin-token）
  // — Chinese: /api/admin/runs — admin-level run monitor
  if (segments[0] === 'api' && segments[1] === 'admin' && segments[2] === 'runs') {
    if (!options.isAdmin && !isAdminMonitorRequest(req, options.adminToken)) {
      sendError(res, 403, 'Admin monitor token is required');
      return true;
    }
    if (req.method === 'GET' && segments.length === 3) {
      const runs = await store.listRunRecords?.({
        threadId: url.searchParams.get('threadId') ?? undefined,
        status: url.searchParams.get('status') as never || undefined,
        limit: Number(url.searchParams.get('limit') ?? 200),
      }) ?? [];
      sendJson(res, 200, { runs, admin: true });
      return true;
    }

    // GET /api/admin/runs/threads — 管理员视图：按 thread 分组查询运行记录（过滤已删除 thread）
    // — Chinese: GET /api/admin/runs/threads — admin view: query runs grouped by thread (filter deleted threads)
    if (req.method === 'GET' && segments.length === 4 && segments[3] === 'threads') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const threads = await listThreadsWithRuns(store, limit);
      sendJson(res, 200, { threads, admin: true });
      return true;
    }
  }

  return false;
}

// 通过 x-nexus-admin-token 头判断请求是否为管理员监控请求
// — Chinese: check x-nexus-admin-token header for admin monitor requests
export function isAdminMonitorRequest(req: IncomingMessage, adminToken = process.env.NEXUS_ADMIN_TOKEN): boolean {
  if (!adminToken) return false;
  const raw = req.headers['x-nexus-admin-token'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === adminToken;
}

// 按 thread 分组统计运行记录，过滤已删除的 thread
// — Chinese: group run records by thread, filter deleted threads
interface ThreadWithRunStats {
  threadId: string;
  title: string;
  runCount: number;
  lastActiveAt: string;
  tenantId: string;
  status: string;
}

async function listThreadsWithRuns(
  store: ThreadStore,
  limit: number,
): Promise<ThreadWithRunStats[]> {
  // 1. 获取所有 run 记录
  const runs = await store.listRunRecords?.({
    limit: undefined,
  }) ?? [];

  if (runs.length === 0) {
    return [];
  }

  // 2. 按 threadId 分组统计
  const threadStatsMap = new Map<string, {
    runCount: number;
    lastActiveAt: string;
    tenantId: string;
  }>();

  for (const run of runs) {
    const threadId = run.threadId;
    const existing = threadStatsMap.get(threadId);
    if (existing) {
      existing.runCount += 1;
      if (run.updatedAt > existing.lastActiveAt) {
        existing.lastActiveAt = run.updatedAt;
      }
    } else {
      threadStatsMap.set(threadId, {
        runCount: 1,
        lastActiveAt: run.updatedAt,
        tenantId: run.tenantId ?? '',
      });
    }
  }

  // 3. 批量获取 thread 信息
  const threadIds = Array.from(threadStatsMap.keys());
  const threadResults = await Promise.all(
    threadIds.map((threadId) => store.getThread(threadId)),
  );

  // 4. 过滤已删除的 thread（getThread 返回 null 表示 thread 不存在/已删除）
  const result: ThreadWithRunStats[] = [];
  for (let i = 0; i < threadIds.length; i++) {
    const threadId = threadIds[i];
    const thread = threadResults[i];
    const stats = threadStatsMap.get(threadId)!;

    // 过滤已删除或不存在的 thread
    if (!thread) continue;

    result.push({
      threadId,
      title: thread.title,
      runCount: stats.runCount,
      lastActiveAt: stats.lastActiveAt,
      tenantId: thread.tenantId ?? stats.tenantId,
      status: thread.status,
    });
  }

  // 5. 按 lastActiveAt 倒序排列
  result.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

  // 6. 应用 limit
  return result.slice(0, limit);
}
