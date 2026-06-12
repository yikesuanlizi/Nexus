import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import { URL } from 'node:url';
import { AgentLoop, McpRuntimeManager, type ThreadState } from '@nexus/runtime';
import { ModelGateway, listProviders, resolveApiKey, removeApiKey, saveApiKey, type ModelConfig } from '@nexus/model-gateway';
import { DEFAULT_PRESET, getPreset, AutoApproveHandler, type SandboxConfig } from '@nexus/sandbox';
import { createStore } from '@nexus/storage';
import { forkThread, rollbackTurns } from '@nexus/memory';
import { LocalHookRegistry, LocalSkillRegistry } from '@nexus/extensions';
import type { ThreadEvent, ThreadId, ThreadItem, TurnMeta, UserInput } from '@nexus/protocol';
import { WebApprovalBroker } from './approval.js';
import { handleCompactThread } from './compactRoute.js';
import { readJson, sendError, sendJson } from './http.js';
import { installGracefulShutdown } from './shutdown.js';
import { handlePickWorkspaceDirectory } from './workspacePicker.js';
import { handlePatchThread } from './threadMetadata.js';
import { handleBotRoute } from './botRoute.js';
import { handleWorkspaceFilesRoute } from './workspaceFiles.js';
import { buildSkillDraftSystemPrompt, createSkillInstallTurnItems, createTemplateSkillDraft, installSkillsFromGitHubUrl, prepareSkillDraftRequest, safeGeneratedSkillDraft, writeSkillDraft, type InstallSkillsResult, type SkillDraft } from './skills.js';
import { shouldRetitleThread, titleFromInput } from './threadTitle.js';
import { buildThreadChildInfos } from './threadChildren.js';
import { buildUserInputFromTurnRequest } from './turnInput.js';
import { usageForThreadTree, usageFromThread } from './usage.js';
import { DEFAULT_RUN_CONFIG_KEY, createConfigRepository, defaultConfig, hiddenChatWorkspaceRoot, publicRunConfig, resolveConfig, type AgentRunConfig, type ApiKeyState, type TurnRequest } from './config.js';

const { store } = createStore(defaultConfig.dataDir);
const configRepo = createConfigRepository(store);
const eventClients = new Map<ThreadId, Set<ServerResponse>>();
const mcpManager = new McpRuntimeManager();
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

let defaultAgent: AgentLoop | null = null;
async function getDefaultAgent(): Promise<AgentLoop> {
  if (!defaultAgent) {
    const { agent } = await createAgent();
    defaultAgent = agent;
  }
  return defaultAgent;
}
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

async function saveDefaultRunConfig(configPatch: Partial<AgentRunConfig>): Promise<AgentRunConfig> {
  const next = await configRepo.saveDefaultRunConfig(configPatch);
  defaultAgent = null;
  return next;
}
async function createAgent(configPatch: Partial<AgentRunConfig> = {}): Promise<{ agent: AgentLoop; model: ModelGateway; config: AgentRunConfig }> {
  const base = await getDefaultRunConfig();
  const config = resolveConfig({ ...base, ...configPatch });
  if (config.workspaceRoot === hiddenChatWorkspaceRoot(config.dataDir)) {
    fs.mkdirSync(config.workspaceRoot, { recursive: true });
  }
  const modelConfig: ModelConfig = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ?? '',
    apiKey: config.apiKey,
    maxTokens: 8192,
    temperature: 0.2,
    timeoutMs: 120_000,
    reasoningEffort: config.reasoningEffort,
  };
  const model = new ModelGateway(modelConfig);
  const preset = getPreset(config.permissions) ?? DEFAULT_PRESET;
  const sandbox: SandboxConfig = {
    preset,
    workspaceRoot: config.workspaceRoot,
    execPolicyRules: [
      { pattern: [['git', 'jj']], decision: 'allow', justification: 'VCS commands are allowed.' },
      { pattern: ['npm', 'run'], decision: 'prompt', justification: 'npm scripts may have side effects.' },
      { pattern: ['rm', ['-rf', '-r']], decision: 'forbidden', justification: 'Recursive delete is too dangerous.' },
    ],
  };
  const skills = new LocalSkillRegistry();
  await skills.loadFromDirectory(config.skillsRoot);
  const hooks = new LocalHookRegistry();
  await mcpManager.configure(await listMcpServers());
  const agent = new AgentLoop({
    workspaceRoot: config.workspaceRoot,
    sandbox,
    model,
    store,
    approvalHandler: preset.approval === 'never' ? new AutoApproveHandler() : approvalBroker,
    skills,
    hooks,
    locale: config.locale ?? 'zh',
    webSearchMode: config.webSearchMode,
    runProfile: config.runProfile,
    mcpTools: mcpManager.toolDefinitions(),
  });
  agent.onEvent((event) => publishEvent(event));
  return { agent, model, config };
}

function publishEvent(event: ThreadEvent): void {
  const threadId = 'threadId' in event ? event.threadId : undefined;
  if (!threadId) return;
  const clients = eventClients.get(threadId);
  if (!clients) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(line);
  }
}

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';
}

function listApiKeyStates(): ApiKeyState[] {
  return listProviders()
    .filter((provider) => !provider.isLocal)
    .map((provider) => {
      const key = resolveApiKey(provider.id);
      const fromEnv = provider.apiKeyEnvVar ? Boolean(process.env[provider.apiKeyEnvVar]) : false;
      return {
        providerId: provider.id,
        envVar: provider.apiKeyEnvVar,
        configured: Boolean(key),
        source: key ? (fromEnv ? 'env' : 'config') : null,
        masked: key ? maskKey(key) : null,
      };
    });
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

async function draftSkill(description: string, configPatch?: Partial<AgentRunConfig>): Promise<{
  draft: SkillDraft;
  source: 'model' | 'template';
  error?: string;
}> {
  const locale = configPatch?.locale ?? 'zh';
  const prepared = await prepareSkillDraftRequest(description);
  const templateDraft = createTemplateSkillDraft(prepared, locale);

  try {
    const { model } = await createAgent(configPatch);
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

function publishCompletedItems(threadId: ThreadId, turnId: string, items: ThreadItem[]): void {
  for (const item of items) {
    publishEvent({ type: 'item.completed', threadId, turnId, item });
  }
}

function closeThreadEventClients(threadId: ThreadId): void {
  const clients = eventClients.get(threadId);
  if (!clients) return;
  for (const client of clients) {
    client.end();
  }
  eventClients.delete(threadId);
}

function generateServerId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);

  if (await handleBotRoute({ req, res, url, segments, store, getDefaultRunConfig, createAgent: async (config) => ({ agent: (await createAgent(config)).agent }) })) return;
  if (await handleWorkspaceFilesRoute({ req, res, url })) return;

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, { ok: true, defaultConfig: publicRunConfig(await getDefaultRunConfig()) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const stored = await store.getSetting<Partial<AgentRunConfig>>(DEFAULT_RUN_CONFIG_KEY);
    sendJson(res, 200, { config: publicRunConfig(await getDefaultRunConfig()), stored: Boolean(stored) });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
    const config = await saveDefaultRunConfig(body.config ?? {});
    sendJson(res, 200, { ok: true, config: publicRunConfig(config) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/workspaces/pick') return handlePickWorkspaceDirectory(res);

  if (req.method === 'GET' && url.pathname === '/api/mcp') {
    sendJson(res, 200, { servers: await listMcpServers() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp/status') {
    await mcpManager.configure(await listMcpServers());
    sendJson(res, 200, { servers: mcpManager.statuses() });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/mcp') {
    const body = await readJson<{ servers?: unknown }>(req);
    const servers = await saveMcpServers(body.servers ?? []);
    defaultAgent = null;
    await mcpManager.configure(servers);
    sendJson(res, 200, { ok: true, servers, statuses: mcpManager.statuses() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const config = await getDefaultRunConfig();
    const skills = new LocalSkillRegistry();
    await skills.loadFromDirectory(config.skillsRoot);
    sendJson(res, 200, { skillsRoot: config.skillsRoot, skills: skills.list() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/draft') {
    const body = await readJson<{ description?: string; config?: Partial<AgentRunConfig> }>(req);
    const description = body.description?.trim();
    if (!description) {
      sendError(res, 400, 'Skill description is required');
      return;
    }
    sendJson(res, 200, await draftSkill(description, body.config));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/install') {
    const body = await readJson<{ url?: string; config?: Partial<AgentRunConfig> }>(req);
    const skillUrl = body.url?.trim();
    if (!skillUrl) {
      sendError(res, 400, 'Skill URL is required');
      return;
    }
    try {
      const config = resolveConfig({ ...await getDefaultRunConfig(), ...(body.config ?? {}) });
      const result = await installSkillsFromGitHubUrl(config.skillsRoot, skillUrl);
      defaultAgent = null;
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
    defaultAgent = null;
    sendJson(res, 200, { ok: true, skill: saved });
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

  if (req.method === 'GET' && url.pathname === '/api/keys') {
    sendJson(res, 200, { keys: listApiKeyStates() });
    return;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'keys' && segments[2]) {
    const body = await readJson<{ apiKey?: string }>(req);
    const apiKey = body.apiKey?.trim();
    if (!apiKey) {
      sendError(res, 400, 'API key is required');
      return;
    }
    saveApiKey(segments[2], apiKey);
    sendJson(res, 200, { ok: true, keys: listApiKeyStates() });
    return;
  }

  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'keys' && segments[2]) {
    removeApiKey(segments[2]);
    sendJson(res, 200, { ok: true, keys: listApiKeyStates() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/health') {
    const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
    const { model } = await createAgent(body.config);
    sendJson(res, 200, await model.healthCheck());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/threads') {
    sendJson(res, 200, { threads: await store.listThreads({ limit: 50 }) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/approvals') {
    sendJson(res, 200, { approvals: approvalBroker.listPending(), history: approvalBroker.listHistory() });
    return;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'approvals' && segments[2]) {
    const body = await readJson<{ approved?: boolean; reason?: string }>(req);
    const ok = approvalBroker.decide(segments[2], body.approved === true, body.reason);
    if (!ok) {
      sendError(res, 404, 'Approval request not found');
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/threads') {
    const body = await readJson<{ title?: string; config?: Partial<AgentRunConfig>; conversationKind?: 'chat' | 'project' }>(req);
    const conversationKind = body.conversationKind === 'chat' ? 'chat' : 'project';
    const effectiveConfig = body.config
      ? resolveConfig({ ...await getDefaultRunConfig(), ...body.config })
      : await getDefaultRunConfig();
    if (conversationKind === 'chat') {
      effectiveConfig.workspaceRoot = hiddenChatWorkspaceRoot(effectiveConfig.dataDir);
    }
    const agent = body.config ? (await createAgent(effectiveConfig)).agent : await getDefaultAgent();
    const thread = await agent.startThread(body.title ?? 'Nexus', {
      workspaceRoot: conversationKind === 'chat' ? '' : effectiveConfig.workspaceRoot,
      tags: conversationKind === 'chat' ? { conversationKind: 'chat' } : {},
    });
    const config = await saveThreadRunConfig(thread.threadId, effectiveConfig);
    sendJson(res, 200, { thread: await store.getThread(thread.threadId), config: publicThreadRunConfig(config, await store.getThread(thread.threadId)) });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'threads' && segments[2]) {
    const threadId = segments[2];
    if (req.method === 'GET' && segments.length === 3) {
      const thread = await store.getThread(threadId);
      if (!thread) {
        sendError(res, 404, 'Thread not found');
        return;
      }
      const turns = await store.getTurns(threadId);
      const items = await store.getItems(threadId);
      const config = await getThreadRunConfig(threadId);
      const includeChildrenUsage = url.searchParams.get('includeChildren') === '1';
      sendJson(res, 200, {
        thread,
        turns,
        items,
        config: publicThreadRunConfig(config, thread),
        usage: includeChildrenUsage ? await usageForThreadTree(store, threadId) : usageFromThread(thread),
      });
      return;
    }

    if (req.method === 'GET' && segments[3] === 'usage') {
      const thread = await store.getThread(threadId);
      if (!thread) {
        sendError(res, 404, 'Thread not found');
        return;
      }
      const includeChildrenUsage = url.searchParams.get('includeChildren') === '1';
      sendJson(res, 200, { usage: includeChildrenUsage ? await usageForThreadTree(store, threadId) : usageFromThread(thread) });
      return;
    }

    if (req.method === 'GET' && segments[3] === 'children') {
      const thread = await store.getThread(threadId);
      if (!thread) {
        sendError(res, 404, 'Thread not found');
        return;
      }
      const recursive = url.searchParams.get('recursive') === '1';
      const agent = await getDefaultAgent();
      const children = await buildThreadChildInfos({
        parentThreadId: threadId,
        recursive,
        store,
        getRuntimeState: (childThreadId) => agent.getRuntimeState(childThreadId),
      });
      sendJson(res, 200, { threadId, children });
      return;
    }

    if (req.method === 'DELETE' && segments.length === 3) {
      const thread = await store.getThread(threadId);
      if (!thread) { sendError(res, 404, 'Thread not found'); return; }
      const agent = await getDefaultAgent();
      agent.interrupt(threadId);
      closeThreadEventClients(threadId);
      await store.deleteThread(threadId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'PATCH' && segments.length === 3) return handlePatchThread(req, res, store, threadId);

    if (req.method === 'PATCH' && segments[3] === 'config') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = await saveThreadRunConfig(threadId, body.config ?? {});
      sendJson(res, 200, { ok: true, config: publicRunConfig(config) });
      return;
    }

    if (req.method === 'GET' && segments[3] === 'state') {
      const agent = await getDefaultAgent();
      const thread = await store.getThread(threadId);
      sendJson(res, 200, { state: await agent.getRuntimeState(threadId), usage: usageFromThread(thread) });
      return;
    }
  }

  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'events' && segments[2]) {
    const threadId = segments[2];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: {"type":"connected"}\n\n');
    const clients = eventClients.get(threadId) ?? new Set<ServerResponse>();
    clients.add(res);
    eventClients.set(threadId, clients);
    req.on('close', () => {
      clients.delete(res);
      if (clients.size === 0) eventClients.delete(threadId);
    });
    return;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'threads' && segments[2]) {
    const threadId = segments[2];
    const action = segments[3];

    if (action === 'skills' && segments[4] === 'install') {
      const body = await readJson<{ url?: string; config?: Partial<AgentRunConfig> }>(req);
      const skillUrl = body.url?.trim();
      if (!skillUrl) {
        sendError(res, 400, 'Skill URL is required');
        return;
      }
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const thread = await store.getThread(threadId);
      if (!thread) {
        sendError(res, 404, 'Thread not found');
        return;
      }

      const inputText = `/skills add ${skillUrl}`;
      if (shouldRetitleThread(thread.title)) {
        await store.updateThreadMetadata(threadId, { title: titleFromInput(inputText) ?? inputText.slice(0, 60) });
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
      publishEvent({ type: 'turn.started', threadId, turnId, turnIndex: thread.turnCount });

      try {
        const result = await installSkillsFromGitHubUrl(config.skillsRoot, skillUrl);
        defaultAgent = null;
        const { model } = await createAgent(config);
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
        publishCompletedItems(threadId, turnId, items);
        turn.status = 'completed';
        turn.completedAt = new Date().toISOString();
        await store.saveTurn(turn);
        publishEvent({ type: 'turn.completed', threadId, turnId, usage: null, status: 'completed' });
        sendJson(res, 200, { ok: true, items, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const items = createSkillInstallFailureItems(turnId, inputText, message, startedAt);
        await store.appendItems(threadId, items);
        publishCompletedItems(threadId, turnId, items);
        turn.status = 'failed';
        turn.completedAt = new Date().toISOString();
        await store.saveTurn(turn);
        publishEvent({ type: 'turn.failed', threadId, turnId, error: { message } });
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
      }
      const agent = (await createAgent(config)).agent;
      const result = await agent.runTurn(threadId, buildUserInputFromTurnRequest(body));
      sendJson(res, 200, result);
      return;
    }

    if (action === 'interrupt') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createAgent(config)).agent;
      sendJson(res, 200, { interrupted: agent.interrupt(threadId) });
      return;
    }

    if (action === 'resume-running') {
      const body = await readJson<{ input?: string; config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createAgent(config)).agent;
      const input: UserInput | undefined =
        body.input && body.input.trim() ? { type: 'text', text: body.input } : undefined;
      const result = await agent.resumeRunning(threadId, input);
      sendJson(res, 200, result);
      return;
    }

    if (action === 'resume-tree') {
      const body = await readJson<{ config?: Partial<AgentRunConfig> }>(req);
      const config = body.config ? await saveThreadRunConfig(threadId, body.config) : await getThreadRunConfig(threadId);
      const agent = (await createAgent(config)).agent;
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
        createModel: async (config) => (await createAgent(config)).model,
        publishEvent,
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
      const body = await readJson<{ count?: number }>(req);
      sendJson(res, 200, await rollbackTurns(threadId, store, body.count ?? 1));
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
});

installGracefulShutdown({ server, store });
