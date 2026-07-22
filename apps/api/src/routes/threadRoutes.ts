// Thread 子路由聚合器：把 /api/threads/:id/* 的路由分发从 server.ts 抽离，
// 让 server.ts 聚焦于顶层装配（≤780 行架构守卫）。
// — Chinese: thread sub-route aggregator to keep server.ts focused on top-level wiring

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { ThreadStore } from '@nexus/storage';
import type { AgentLoop } from '@nexus/runtime';
import type { ModelGateway } from '@nexus/model-gateway';
import type { ThreadEvent, ThreadId } from '@nexus/protocol';
import type { AgentRunConfig, ThreadConfigOverrides } from '../config/config.js';
import { readJson, sendError, sendJson } from '../shared/http.js';
import type { TenantContext } from '../shared/tenant.js';
import { buildThreadChildInfos } from '../services/threadChildren.js';
import { usageForThreadTree, usageFromThread } from '../services/usage.js';
import { clearRemoteBotBindingsForDeletedThread } from './threadDeletion.js';
import { handlePatchThread } from './threadMetadata.js';
import { handleWorkflowRoute } from './workflowRoute.js';
import { handleHarnessRoute } from './harnessRoute.js';

// thread 路由需要的上下文（由 server.ts 的 route 函数闭包注入）
// — Chinese: context injected from server.ts route closure
export interface ThreadRouteContext {
  store: ThreadStore;
  tenantContext: TenantContext;
  createTenantAgent: (config?: Partial<AgentRunConfig>) => Promise<{ agent: AgentLoop; model: ModelGateway; config: AgentRunConfig }>;
  getTenantDefaultAgent: () => Promise<AgentLoop>;
  publishTenantEvent: (event: ThreadEvent) => void;
  getThreadRunConfig: (threadId: ThreadId) => Promise<AgentRunConfig>;
  saveThreadRunConfig: (threadId: ThreadId, config: Partial<AgentRunConfig>) => Promise<AgentRunConfig>;
  getThreadConfigOverrides: (threadId: string) => Promise<ThreadConfigOverrides>;
  updateThreadConfigOverrides: (threadId: string, input: Record<string, unknown>) => Promise<ThreadConfigOverrides>;
  publicThreadRunConfig: (config: AgentRunConfig, thread: { tags?: Record<string, string> } | null) => AgentRunConfig;
  closeThreadEventClients: (threadId: ThreadId, tenantId: string) => void;
}

/**
 * 处理 /api/threads/:id/* 的所有子路由。
 * 返回 true 表示已处理；false 表示不匹配（交由上层继续路由）。
 */
export async function handleThreadRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  segments: string[],
  ctx: ThreadRouteContext,
): Promise<boolean> {
  if (!(segments[0] === 'api' && segments[1] === 'threads' && segments[2])) return false;
  const threadId = segments[2] as ThreadId;
  const { store, tenantContext, createTenantAgent, getTenantDefaultAgent, publishTenantEvent } = ctx;

  // workflow 子路由
  if (await handleWorkflowRoute({
    req, res, segments, store,
    createPlannerModel: async () => (await createTenantAgent()).model,
  })) return true;

  // harness 子路由：start/status/cancel
  if (await handleHarnessRoute({
    req, res, url, segments, store, tenantContext,
    createAgent: async (config) => (await createTenantAgent(config)).agent,
    publishEvent: publishTenantEvent,
    getThreadRunConfig: ctx.getThreadRunConfig,
  })) return true;

  // GET /api/threads/:id — 线程详情
  if (req.method === 'GET' && segments.length === 3) {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const turns = await store.getTurns(threadId);
    const items = await store.getItems(threadId);
    const config = await ctx.getThreadRunConfig(threadId);
    const includeChildrenUsage = url.searchParams.get('includeChildren') === '1';
    sendJson(res, 200, {
      thread, turns, items,
      config: ctx.publicThreadRunConfig(config, thread),
      usage: includeChildrenUsage ? await usageForThreadTree(store, threadId) : usageFromThread(thread),
    });
    return true;
  }

  // GET /api/threads/:id/usage
  if (req.method === 'GET' && segments[3] === 'usage') {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const includeChildrenUsage = url.searchParams.get('includeChildren') === '1';
    sendJson(res, 200, { usage: includeChildrenUsage ? await usageForThreadTree(store, threadId) : usageFromThread(thread) });
    return true;
  }

  // GET /api/threads/:id/children
  if (req.method === 'GET' && segments[3] === 'children') {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const recursive = url.searchParams.get('recursive') === '1';
    const agent = await getTenantDefaultAgent();
    const children = await buildThreadChildInfos({
      parentThreadId: threadId, recursive, store,
      getRuntimeState: (childThreadId) => agent.getRuntimeState(childThreadId),
    });
    sendJson(res, 200, { threadId, children });
    return true;
  }

  // DELETE /api/threads/:id
  if (req.method === 'DELETE' && segments.length === 3) {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const agent = await getTenantDefaultAgent();
    agent.interrupt(threadId);
    ctx.closeThreadEventClients(threadId, tenantContext.tenantId);
    await store.deleteThread(threadId);
    await clearRemoteBotBindingsForDeletedThread(store, threadId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // PATCH /api/threads/:id
  if (req.method === 'PATCH' && segments.length === 3) {
    await handlePatchThread(req, res, store, threadId);
    return true;
  }

  // GET /api/threads/:id/config
  if (req.method === 'GET' && segments[3] === 'config' && segments.length === 4) {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const overrides = await ctx.getThreadConfigOverrides(threadId);
    sendJson(res, 200, { overrides });
    return true;
  }

  // PATCH /api/threads/:id/config
  if (req.method === 'PATCH' && segments[3] === 'config' && segments.length === 4) {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const body = await readJson<{ overrides?: Record<string, unknown> }>(req);
    const overrides = await ctx.updateThreadConfigOverrides(threadId, body.overrides ?? {});
    sendJson(res, 200, { overrides });
    return true;
  }

  // GET /api/threads/:id/state
  if (req.method === 'GET' && segments[3] === 'state') {
    const agent = await getTenantDefaultAgent();
    const thread = await store.getThread(threadId);
    sendJson(res, 200, { state: await agent.getRuntimeState(threadId), usage: usageFromThread(thread) });
    return true;
  }

  // GET /api/threads/:id/context-pressure
  if (req.method === 'GET' && segments[3] === 'context-pressure') {
    const thread = await store.getThread(threadId);
    if (!thread) { sendError(res, 404, 'Thread not found'); return true; }
    const agent = await getTenantDefaultAgent();
    const pressure = await agent.getContextPressure(threadId);
    sendJson(res, 200, { pressure });
    return true;
  }

  return false;
}
