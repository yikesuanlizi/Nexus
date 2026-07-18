import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { type ThreadState } from '@nexus/runtime';
import { listProviders, type ModelGateway } from '@nexus/model-gateway';
import { createStore, resolveStorageOptions } from '@nexus/storage';
import { forkThread } from '@nexus/memory';
import type { ThreadEvent, ThreadId, ThreadItem, TurnMeta, UserInput } from '@nexus/protocol';
import { buildAgentCard, type AgentRuntimePort } from '@nexus/protocol';
import { createA2AHandler, handleA2ARoute, type A2AHandler } from './a2a/a2aRoute.js';
import { WebApprovalBroker } from './services/approval.js';
import { handleCompactThread } from './routes/compactRoute.js';
import { readJson, sendError, sendJson } from './shared/http.js';
import { DEFAULT_TENANT_ID, tenantEventKey, type TenantContext } from './shared/tenant.js';
import { installGracefulShutdown } from './runtime/shutdown.js';
import { handlePickWorkspaceDirectory } from './routes/workspacePicker.js';
import { autoStartDingtalkForTenant, handleBotRoute } from './routes/botRoute.js';
import { handleWorkspaceFilesRoute } from './routes/workspaceFiles.js';
import { handleSettingsRoute } from './routes/settingsRoute.js';
import { handleWorkflowRoute } from './routes/workflowRoute.js';
import { handleRunMonitorRoute } from './routes/runMonitorRoute.js';
import { handleGitNexusRoute } from './routes/gitnexusRoute.js';
import { handleMemoryRoute } from './routes/memoryRoute.js';
import { handleThreadRoutes } from './routes/threadRoutes.js';
import { harnessRuntimeRegistry } from './services/harnessRuntime.js';
import { handleRollbackThreadRuntimeAction, handleRunControlAction } from './routes/threadRuntimeActions.js';
import { buildSkillDraftSystemPrompt, createSkillInstallTurnItems, createTemplateSkillDraft, deleteSkill, installSkillsFromGitHubUrl, prepareSkillDraftRequest, safeGeneratedSkillDraft, writeSkillDraft, type InstallSkillsResult, type SkillDraft } from './services/skills.js';
import { shouldRetitleThread, titleFromInput } from './services/threadTitle.js';
import { buildUserInputFromTurnRequest } from './services/turnInput.js';
import { defaultConfig, hiddenChatWorkspaceRoot, publicRunConfig, resolveConfig, type AgentRunConfig, type TurnRequest, A2A_CONFIG_KEY, normalizeA2AConfig } from './config/config.js';
import { createTenantRuntime } from './runtime/tenantRuntime.js';
import { applyCorsHeaders, resolveCorsOptions } from './shared/cors.js';
import { handleRequestGate } from './routes/requestGate.js';
import { resolveDeploymentConfig } from './config/deployment.js';
import { handleDeploymentRoute } from './routes/deploymentRoute.js';
import { handleStatusRoute } from './routes/statusRoute.js';
import { handleKeysRoute } from './routes/keysRoute.js';

const storageOptions = resolveStorageOptions();
const { store: rootStore } = createStore(defaultConfig.dataDir);
const eventClients = new Map<string, Set<ServerResponse>>();
const approvalBroker = new WebApprovalBroker(60_000, (entry) => {
  publishEvent({
    type: 'approval.resolved',
    threadId: entry.threadId,
    turnId: entry.turnId,
    requestId: entry.requestId,
    approved: entry.approved,
    reason: entry.reason,
    status: entry.status,
  });
});

function publishEvent(event: ThreadEvent, tenantId: string = DEFAULT_TENANT_ID): void {
  const threadId = 'threadId' in event ? event.threadId : undefined;
  if (!threadId) return;
  const clients = eventClients.get(tenantEventKey(tenantId, threadId));
  if (!clients) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(line);
  }
}

const tenantRuntime = createTenantRuntime({
  rootStore,
  approvalBroker,
  publishEvent,
});

// A2A handler 单例缓存（按租户隔离）— Chinese: A2A handler singleton cache per tenant
const a2aHandlers = new Map<string, A2AHandler>();

/**
 * 将 Nexus AgentLoop 适配到 A2A AgentRuntimePort 端口接口。
 * AgentLoop 的 onEvent 返回 unsubscribe；runTurn 返回 { items, usage }，端口只取 { items }。
 */
// — Chinese: adapt AgentLoop to A2A AgentRuntimePort. onEvent returns unsubscribe.
function adaptAgentLoopToPort(agent: {
  runTurn(threadId: ThreadId, input: { type: 'text'; text: string }, signal?: AbortSignal): Promise<{ items: ThreadItem[] }>;
  interrupt(threadId: ThreadId): boolean;
  onEvent(listener: (event: ThreadEvent) => void): () => void;
}): AgentRuntimePort {
  return {
    runTurn: (threadId, input, signal) => agent.runTurn(threadId, input, signal),
    interrupt: (threadId) => agent.interrupt(threadId),
    onEvent: (listener) => agent.onEvent(listener),
  };
}

/** 推导 A2A 端点基础 URL（支持 NEXUS_A2A_BASE_URL 环境变量覆盖）。 */
// — Chinese: resolve A2A endpoint base URL (overridable via NEXUS_A2A_BASE_URL)
function resolveA2ABaseUrl(req: IncomingMessage): string {
  const envBase = process.env.NEXUS_A2A_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host ?? `localhost:${process.env.NEXUS_API_PORT ?? '4127'}`;
  return `${proto}://${host}`;
}

/**
 * 获取或创建指定租户的 A2A handler（单例）。
 * 装配 AgentCard、TaskStore、AgentExecutor，并注入 agentFactory。
 * authMode 用于在 AgentCard 中声明认证要求（token → Bearer JWT，off → 无需认证）。
 */
// — Chinese: get or create A2A handler singleton per tenant. authMode declares the security scheme.
function getA2AHandler(
  tenantContext: TenantContext,
  req: IncomingMessage,
  authMode: 'token' | 'off',
): A2AHandler {
  const cached = a2aHandlers.get(tenantContext.tenantId);
  if (cached) return cached;

  const baseUrl = resolveA2ABaseUrl(req);
  const store = tenantRuntime.storeForTenant(tenantContext);
  const agentCard = buildAgentCard({
    name: 'Nexus',
    description: 'Nexus Agent OS — A2A endpoint powered by AgentLoop runtime',
    url: `${baseUrl}/api/a2a`,
    version: '0.3.0',
    // 根据 Nexus 部署的认证模式声明 AgentCard 的 security scheme
    // — Chinese: declare AgentCard security scheme based on deployment auth mode
    securityScheme: authMode === 'token' ? 'bearer' : 'none',
  });

  const handler = createA2AHandler({
    agentCard,
    threadStore: store,
    agentFactory: async () => {
      const agent = await tenantRuntime.getDefaultAgent(tenantContext);
      return adaptAgentLoopToPort(agent);
    },
  });
  a2aHandlers.set(tenantContext.tenantId, handler);
  return handler;
}

function serializeThreadState(state: ThreadState): unknown {
  return {
    status: state.status,
    activeTurnId: state.activeTurnId,
    generation: state.generation,
    pendingInterrupts: state.pendingInterrupts,
    pendingRollback: state.pendingRollback,
    lastCheckpoint: state.lastCheckpoint,
    lastTerminalTurnId: state.lastTerminalTurnId,
    hasCancelController: Boolean(state.cancelController),
    turnSummary: state.turnSummary
      ? {
          ...state.turnSummary,
          commandExecutionsStarted: [...state.turnSummary.commandExecutionsStarted],
        }
      : null,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function draftSkill(
  description: string,
  configPatch: Partial<AgentRunConfig> | undefined,
  tenantContext: TenantContext = { tenantId: DEFAULT_TENANT_ID },
): Promise<{
  draft: SkillDraft;
  source: 'model' | 'template';
  error?: string;
}> {
  const locale = configPatch?.locale ?? 'zh';
  const prepared = await prepareSkillDraftRequest(description);
  const templateDraft = createTemplateSkillDraft(prepared, locale);

  try {
    const { model } = await tenantRuntime.createAgent(configPatch, tenantContext);
    const response = await model.chat({
      messages: [
        {
          role: 'system',
          content: buildSkillDraftSystemPrompt(locale),
        },
        { role: 'user', content: prepared.prompt },
      ],
      tool_choice: 'none',
      max_tokens: 1200,
      temperature: 0.2,
    });
    const text = String(response.choices[0]?.message.content ?? '');
    const json = extractJsonObject(text);
    return {
      draft: safeGeneratedSkillDraft(json, prepared, templateDraft),
      source: 'model',
    };
  } catch (error) {
    return {
      draft: templateDraft,
      source: 'template',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createSkillInstallReply(
  model: ModelGateway,
  result: InstallSkillsResult,
  sourceUrl: string,
  locale: AgentRunConfig['locale'],
): Promise<string> {
  const fallback = fallbackSkillInstallReply(result, locale);
  try {
    const response = await model.chat({
      messages: [
        {
          role: 'system',
          content: locale === 'zh'
            ? '你是 Nexus。根据工具安装结果，用中文简洁回答用户。不要编造未安装的 Skill。'
            : 'You are Nexus. Reply concisely in English based on the skill installation result. Do not invent skills that were not installed.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            command: `/skills add ${sourceUrl}`,
            skillsRoot: result.skillsRoot,
            installed: result.installed.map((skill) => ({
              name: skill.name,
              sourcePath: skill.sourcePath,
              path: skill.path,
            })),
          }, null, 2),
        },
      ],
      tool_choice: 'none',
      max_tokens: 300,
      temperature: 0.2,
    });
    const text = String(response.choices[0]?.message.content ?? '').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function fallbackSkillInstallReply(result: InstallSkillsResult, locale: AgentRunConfig['locale']): string {
  const names = result.installed.map((skill) => skill.name).join(', ');
  if (locale === 'en') {
    return `Installed ${result.installed.length} skill(s): ${names || 'none'}.`;
  }
  return `已安装 ${result.installed.length} 个 Skill：${names || '无'}。`;
}

function createSkillInstallFailureItems(
  turnId: string,
  input: string,
  message: string,
  timestamp: string,
): ThreadItem[] {
  const skillUrl = input.replace(/^\/skills\s+add\s+/i, '').trim();
  return [
    {
      id: `${turnId}_item_0`,
      type: 'user_message',
      turnId,
      text: input,
      timestamp,
    },
    {
      id: `${turnId}_item_1`,
      type: 'tool_call',
      turnId,
      toolName: 'skills_add',
      arguments: { input: skillUrl },
      error: { message },
      status: 'failed',
      timestamp,
    },
    {
      id: `${turnId}_item_2`,
      type: 'error',
      turnId,
      message,
      timestamp,
    },
  ];
}

function publishCompletedItems(threadId: ThreadId, turnId: string, items: ThreadItem[], tenantId: string = DEFAULT_TENANT_ID): void {
  for (const item of items) {
    publishEvent({ type: 'item.completed', threadId, turnId, item }, tenantId);
  }
}

function closeThreadEventClients(threadId: ThreadId, tenantId: string = DEFAULT_TENANT_ID): void {
  const key = tenantEventKey(tenantId, threadId);
  const clients = eventClients.get(key);
  if (!clients) return;
  for (const client of clients) {
    client.end();
  }
  eventClients.delete(key);
}

function generateServerId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);
  const deployment = await resolveDeploymentConfig(rootStore, storageOptions.mode);
  const corsOptions = resolveCorsOptions(process.env, deployment.authMode === 'token');
  applyCorsHeaders(req, res, corsOptions);

  if (await handleStatusRoute({ req, res, pathname: url.pathname, deployment, storageOptions, getDefaultRunConfig: () => tenantRuntime.configRepoForTenant({ tenantId: DEFAULT_TENANT_ID }).getDefaultRunConfig() })) return;

  if (await handleDeploymentRoute({ req, res, pathname: url.pathname, store: rootStore, storageMode: storageOptions.mode })) return;

  const gate = await handleRequestGate({ req, res, url, segments, rootStore, storageOptions, authConfig: deployment.authConfig, corsOptions });
  if (gate.handled) return;
  const { tenantContext, authIdentity } = gate;

  const store = tenantRuntime.storeForTenant(tenantContext);
  const configRepo = tenantRuntime.configRepoForTenant(tenantContext);
  const {
    deleteModelPreset,
    getDefaultRunConfig,
    getThreadRunConfig,
    listMcpServers,
    listModelPresets,
    publicThreadRunConfig,
    saveMcpServers,
    saveThreadRunConfig,
    upsertModelPreset,
  } = configRepo;
  const saveTenantDefaultRunConfig = (configPatch: Partial<AgentRunConfig>) => tenantRuntime.saveDefaultRunConfig(configPatch, tenantContext);
  const resetTenantDefaultAgent = () => tenantRuntime.resetDefaultAgent(tenantContext);
  const createTenantAgent = (config?: Partial<AgentRunConfig>) => tenantRuntime.createAgent(config ?? {}, tenantContext);
  const getTenantDefaultAgent = () => tenantRuntime.getDefaultAgent(tenantContext);
  const publishTenantEvent = (event: ThreadEvent) => publishEvent(event, tenantContext.tenantId);
  const tenantMcpManager = tenantRuntime.mcpManagerForTenant(tenantContext);
  if (await handleBotRoute({
    req,
    res,
    url,
    segments,
    store,
    getDefaultRunConfig,
    getThreadRunConfig,
    createAgent: async (config) => ({ agent: (await createTenantAgent(config)).agent }),
    tenantId: tenantContext.tenantId,
    storageMode: storageOptions.mode,
    publishEvent: publishTenantEvent,
  })) return;
  if (await handleWorkspaceFilesRoute({ req, res, url })) return;

  // A2A 标准发现路径 — /.well-known/agent-card.json
  // A2A 规范要求 Agent Card 在此路径暴露，SDK 的 ClientFactory.createFromUrl 默认查找此路径
  // — Chinese: A2A standard discovery path required by the spec
  if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
    const a2aHandler = getA2AHandler(tenantContext, req, deployment.authConfig.mode);
    sendJson(res, 200, a2aHandler.agentCard);
    return;
  }

  // A2A (Agent2Agent) JSON-RPC 路由 — Chinese: A2A JSON-RPC route
  // Agent Card 始终可访问（用于发现），JSON-RPC 调用需要启用配置
  if (segments[0] === 'api' && segments[1] === 'a2a') {
    const a2aHandler = getA2AHandler(tenantContext, req, deployment.authConfig.mode);
    const isCardRequest = req.method === 'GET' && segments[2] === 'card';
    const a2aConfig = normalizeA2AConfig(await store.getSetting(A2A_CONFIG_KEY));
    if (!isCardRequest && !a2aConfig.enabled) {
      sendError(res, 403, 'A2A Server is disabled. Enable it in Settings → A2A Protocol.');
      return;
    }
    if (await handleA2ARoute({ req, res, url, segments, handler: a2aHandler })) return;
  }

  if (await handleSettingsRoute({ req, res, pathname: url.pathname, store, getDefaultRunConfig, saveDefaultRunConfig: saveTenantDefaultRunConfig, resetDefaultAgent: resetTenantDefaultAgent })) return;
  if (await handleMemoryRoute({ req, res, url, pathname: url.pathname, store, getDefaultRunConfig, saveDefaultRunConfig: saveTenantDefaultRunConfig })) return;

  if (req.method === 'POST' && url.pathname === '/api/workspaces/pick') return handlePickWorkspaceDirectory(res);

  if (req.method === 'GET' && url.pathname === '/api/mcp') {
    sendJson(res, 200, { servers: await listMcpServers() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp/status') {
    const detail = url.searchParams.get('detail');
    await tenantMcpManager.configure(await listMcpServers(), { startEnabled: detail === 'full' });
    sendJson(res, 200, { servers: tenantMcpManager.statuses() });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/mcp') {
    const body = await readJson<{ servers?: unknown }>(req);
    const servers = await saveMcpServers(body.servers ?? []);
    resetTenantDefaultAgent();
    await tenantMcpManager.configure(servers, { startEnabled: false });
    sendJson(res, 200, { ok: true, servers, statuses: tenantMcpManager.statuses() });
    return;
  }

  // GitNexus 可视化 API — Chinese: GitNexus visualization API
  if (await handleGitNexusRoute({ req, res, url, mcpManager: tenantMcpManager, listMcpServers })) return;

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const config = await getDefaultRunConfig();
    const forceReload = url.searchParams.get('forceReload') === '1';
    const skills = await tenantRuntime.skillCacheForTenant(tenantContext).loadFromDirectory(
      config.skillsRoot,
      { forceReload },
    );
    if (forceReload) {
      resetTenantDefaultAgent();
    }
    sendJson(res, 200, { skillsRoot: config.skillsRoot, skills: skills.list() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/draft') {
    const body = await readJson<{ description?: string; config?: Partial<AgentRunConfig> }>(req);
    const description = body.description?.trim();
    if (!description) { sendError(res, 400, 'Skill description is required'); return; }
    sendJson(res, 200, await draftSkill(description, body.config, tenantContext));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/install') {
    const body = await readJson<{ url?: string; config?: Partial<AgentRunConfig> }>(req);
    const skillUrl = body.url?.trim();
    if (!skillUrl) { sendError(res, 400, 'Skill URL is required'); return; }
    try {
      const config = resolveConfig({ ...await getDefaultRunConfig(), ...(body.config ?? {}) });
      const result = await installSkillsFromGitHubUrl(config.skillsRoot, skillUrl);
      tenantRuntime.skillCacheForTenant(tenantContext).clear(config.skillsRoot);
      resetTenantDefaultAgent();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills') {
    const body = await readJson<Partial<SkillDraft>>(req);
    if (!body.name?.trim() || !body.body?.trim()) {
      sendError(res, 400, 'Skill name and body are required');
      return;
    }
    const config = await getDefaultRunConfig();
    const saved = await writeSkillDraft(config.skillsRoot, {
      name: body.name,
      description: body.description ?? body.name,
      body: body.body,
    });
    tenantRuntime.skillCacheForTenant(tenantContext).clear(config.skillsRoot);
    resetTenantDefaultAgent();
    sendJson(res, 200, { ok: true, skill: saved });
    return;
  }

  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'skills' && segments[2]) {
    try {
      const config = await getDefaultRunConfig();
      const removed = await deleteSkill(config.skillsRoot, decodeURIComponent(segments[2]));
      tenantRuntime.skillCacheForTenant(tenantContext).clear(config.skillsRoot);
      resetTenantDefaultAgent();
      sendJson(res, 200, { ok: true, skill: removed });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/providers') {
    sendJson(res, 200, { providers: listProviders() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/model-presets') {
    sendJson(res, 200, { presets: await listModelPresets() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/model-presets') {
    const body = await readJson<{
      id?: string;
      name?: string;
      config?: Partial<AgentRunConfig>;
    }>(req);
    sendJson(res, 200, await upsertModelPreset(body));
    return;
  }

  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'model-presets' && segments[2]) {
    sendJson(res, 200, { ok: true, presets: await deleteModelPreset(segments[2]) });
    return;
  }

  if (await handleKeysRoute(req, res, segments, url.pathname)) return;

  if (req.method === 'POST' && url.pathname === '/api/health') {
    const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
    const { model } = await createTenantAgent(body.config);
    sendJson(res, 200, await model.healthCheck());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/threads') {
    sendJson(res, 200, { threads: await store.listThreads({ limit: 50 }) });
    return;
  }

  if (await handleWorkflowRoute({
    req,
    res,
    segments,
    store,
    createPlannerModel: async () => (await createTenantAgent()).model,
  })) return;

  if (await handleRunMonitorRoute({
    req,
    res,
    url,
    segments,
    store,
    tenantContext,
    isAdmin: authIdentity?.role === 'admin',
    adminToken: process.env.NEXUS_ADMIN_TOKEN,
    onControlRun: (action, request) => handleRunControlAction(action, request, getTenantDefaultAgent),
  })) return;

  if (req.method === 'GET' && url.pathname === '/api/approvals') {
    sendJson(res, 200, { approvals: approvalBroker.listPending(), history: approvalBroker.listHistory() });
    return;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'approvals' && segments[2]) {
    const body = await readJson<{ approved?: boolean; reason?: string }>(req);
    const ok = approvalBroker.decide(segments[2], body.approved === true, body.reason);
    if (!ok) { sendError(res, 404, 'Approval request not found'); return; }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/threads') {
    const body = await readJson<{ title?: string; config?: Partial<AgentRunConfig>; conversationKind?: 'chat' | 'project'; workflowProject?: boolean }>(req);
    const conversationKind = body.conversationKind === 'chat' ? 'chat' : 'project';
    const effectiveConfig = body.config
      ? resolveConfig({ ...await getDefaultRunConfig(), ...body.config })
      : await getDefaultRunConfig();
    if (conversationKind === 'chat') {
      effectiveConfig.workspaceRoot = hiddenChatWorkspaceRoot(effectiveConfig.dataDir);
    }
    const agent = body.config ? (await createTenantAgent(effectiveConfig)).agent : await getTenantDefaultAgent();
    const thread = await agent.startThread(body.title ?? 'Nexus', {
      workspaceRoot: conversationKind === 'chat' ? '' : effectiveConfig.workspaceRoot,
      tags: conversationKind === 'chat' ? { conversationKind: 'chat' } : body.workflowProject ? { workflowProject: 'true' } : {},
    });
    const config = await saveThreadRunConfig(thread.threadId, effectiveConfig);
    sendJson(res, 200, { thread: await store.getThread(thread.threadId), config: publicThreadRunConfig(config, await store.getThread(thread.threadId)) });
    return;
  }

  if (await handleThreadRoutes(req, res, url, segments, { store, tenantContext, createTenantAgent, getTenantDefaultAgent, publishTenantEvent, getThreadRunConfig, saveThreadRunConfig, publicThreadRunConfig, closeThreadEventClients })) return;

  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'events' && segments[2]) {
    const threadId = segments[2];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    const eventKey = tenantEventKey(tenantContext.tenantId, threadId);
    const clients = eventClients.get(eventKey) ?? new Set<ServerResponse>();
    clients.add(res);
    eventClients.set(eventKey, clients);
    req.on('close', () => {
      clients.delete(res);
      if (clients.size === 0) eventClients.delete(eventKey);
    });
    return;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'threads' && segments[2]) {
    const threadId = segments[2];
    const action = segments[3];

    if (action === 'skills' && segments[4] === 'install') {
      const body = await readJson<{ url?: string; config?: Partial<AgentRunConfig> }>(req);
      const skillUrl = body.url?.trim();
      if (!skillUrl) { sendError(res, 400, 'Skill URL is required'); return; }
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const thread = await store.getThread(threadId);
      if (!thread) { sendError(res, 404, 'Thread not found'); return; }

      const inputText = `/skills add ${skillUrl}`;
      if (shouldRetitleThread(thread.title)) {
        const nextTitle = titleFromInput(inputText) ?? inputText.slice(0, 60);
        await store.updateThreadMetadata(threadId, { title: nextTitle });
        publishTenantEvent({
          type: 'thread.metadata.updated',
          threadId,
          title: nextTitle,
        });
      }

      const turnId = generateServerId();
      const startedAt = new Date().toISOString();
      const turn: TurnMeta = {
        turnId,
        threadId,
        index: thread.turnCount,
        userInput: { type: 'text', text: inputText },
        status: 'running',
        startedAt,
        completedAt: null,
      };
      await store.saveTurn(turn);
      await store.updateThreadMetadata(threadId, { turnCount: thread.turnCount + 1 });
      publishTenantEvent({ type: 'turn.started', threadId, turnId, turnIndex: thread.turnCount });

      try {
        const result = await installSkillsFromGitHubUrl(config.skillsRoot, skillUrl);
        resetTenantDefaultAgent();
        const { model } = await createTenantAgent(config);
        const agentText = await createSkillInstallReply(model, result, skillUrl, config.locale);
        const items = createSkillInstallTurnItems({
          turnId,
          input: inputText,
          installed: result.installed,
          skillsRoot: result.skillsRoot,
          agentText,
          timestamp: startedAt,
        });
        await store.appendItems(threadId, items);
        publishCompletedItems(threadId, turnId, items, tenantContext.tenantId);
        turn.status = 'completed';
        turn.completedAt = new Date().toISOString();
        await store.saveTurn(turn);
        publishTenantEvent({ type: 'turn.completed', threadId, turnId, usage: null, status: 'completed' });
        sendJson(res, 200, { ok: true, items, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const items = createSkillInstallFailureItems(turnId, inputText, message, startedAt);
        await store.appendItems(threadId, items);
        publishCompletedItems(threadId, turnId, items, tenantContext.tenantId);
        turn.status = 'failed';
        turn.completedAt = new Date().toISOString();
        await store.saveTurn(turn);
        publishTenantEvent({ type: 'turn.failed', threadId, turnId, error: { message } });
        sendError(res, 400, message);
      }
      return;
    }

    if (action === 'turn') {
      const body = await readJson<TurnRequest>(req);
      const config = body.config
        ? await saveThreadRunConfig(threadId, body.config)
        : await getThreadRunConfig(threadId);
      const thread = await store.getThread(threadId);
      const nextTitle = titleFromInput(body.input);
      if (thread && nextTitle && shouldRetitleThread(thread.title)) {
        await store.updateThreadMetadata(threadId, { title: nextTitle });
        publishEvent({
          type: 'thread.metadata.updated',
          threadId,
          title: nextTitle,
        }, tenantContext.tenantId);
      }
      const agent = (await createTenantAgent(config)).agent;
      const result = await agent.runTurn(threadId, buildUserInputFromTurnRequest(body));
      sendJson(res, 200, result);
      return;
    }

    if (action === 'interrupt') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createTenantAgent(config)).agent;
      sendJson(res, 200, { interrupted: agent.interrupt(threadId) });
      return;
    }

    if (action === 'resume-running') {
      const body = await readJson<{ input?: string; config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createTenantAgent(config)).agent;
      const input: UserInput | undefined =
        body.input && body.input.trim() ? { type: 'text', text: body.input } : undefined;
      const result = await agent.resumeRunning(threadId, input);
      sendJson(res, 200, result);
      return;
    }

    if (action === 'resume-tree') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createTenantAgent(config)).agent;
      sendJson(res, 200, await agent.resumeTree(threadId));
      return;
    }

    if (action === 'compact') {
      await handleCompactThread({
        req,
        res,
        threadId,
        store,
        getThreadRunConfig,
        saveThreadRunConfig,
        createModel: async (config) => (await createTenantAgent(config)).model,
        publishEvent: publishTenantEvent,
        generateId: generateServerId,
      });
      return;
    }

    if (action === 'fork') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = resolveConfig(body.config);
      sendJson(res, 200, { thread: await forkThread(threadId, store, config.workspaceRoot) });
      return;
    }

    if (action === 'rollback') {
      const config = await getThreadRunConfig(threadId);
      await handleRollbackThreadRuntimeAction({
        req,
        res,
        threadId,
        createAgent: async () => (await createTenantAgent(config)).agent,
      });
      return;
    }
  }

  sendError(res, 404, 'Not found');
}

const port = Number(process.env.NEXUS_API_PORT ?? 4127);
const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    sendError(res, 500, error instanceof Error ? error.message : String(error));
  });
});

server.listen(port, () => {
  console.log(`Nexus API listening on http://localhost:${port}`);
  // 启动时为 default 租户主动触发钉钉 autoStart（其他租户在首次请求时懒启动）
  // Chinese translation: proactively trigger dingtalk auto-start for default tenant on boot
  const defaultTenantStore = tenantRuntime.storeForTenant({ tenantId: DEFAULT_TENANT_ID });
  const defaultCfgRepo = tenantRuntime.configRepoForTenant({ tenantId: DEFAULT_TENANT_ID });
  void autoStartDingtalkForTenant({
    store: defaultTenantStore,
    tenantId: DEFAULT_TENANT_ID,
    getDefaultRunConfig: () => defaultCfgRepo.getDefaultRunConfig(),
    createAgent: async (config) => ({ agent: (await tenantRuntime.createAgent(config ?? {}, { tenantId: DEFAULT_TENANT_ID })).agent }),
    publishEvent: (event) => publishEvent(event, DEFAULT_TENANT_ID),
  }).catch((err) => {
    console.warn('[dingtalk] default tenant auto-start failed:', err instanceof Error ? err.message : String(err));
  });
});

installGracefulShutdown({
  server,
  store: rootStore,
  // 进程退出时取消所有运行中的 harness run — English: abort running harness runs on exit
  onShutdown: () => harnessRuntimeRegistry.abortAll(),
});
