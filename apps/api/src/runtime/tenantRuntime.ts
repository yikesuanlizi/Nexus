import * as fs from 'node:fs';
import path from 'node:path';
import { AgentLoop, McpRuntimeManager, type AgentConfig } from '@nexus/runtime';
import { ModelGateway, type ModelConfig } from '@nexus/model-gateway';
import { AutoApproveHandler, DEFAULT_PRESET, getPreset, type ApprovalHandler, type SandboxConfig } from '@nexus/sandbox';
import { LocalHookRegistry, LocalSkillRegistryCache } from '@nexus/extensions';
import { createI18n, systemPromptKey } from '@nexus/i18n';
import { resolveModelCapabilities, type ThreadEvent } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { BUILTIN_TOOLS, ToolRegistry } from '@nexus/tools';
import { createDynamicContextProvider } from '../services/dynamicContext.js';
import { createDingtalkForwardToolsForStore, dingtalkForwardingSystemPrompt } from '../services/dingtalkForwardTool.js';
import {
  WEB_PROVIDER_SECRETS_KEY,
  A2A_CONFIG_KEY,
  normalizeA2AConfig,
  createConfigRepository,
  hiddenChatWorkspaceRoot,
  resolveConfig,
  resolveWebProviderRuntimeConfig,
  type AgentRunConfig,
  type WebProviderSecrets,
} from '../config/config.js';
import { DEFAULT_TENANT_ID, type TenantContext } from '../shared/tenant.js';
import { ActiveRunRegistry } from './activeRunRegistry.js';

export type AgentRuntimeOverrides = Pick<AgentConfig, 'systemPrompt' | 'tools'> & {
  systemPromptSuffix?: string;
};
export type AgentCreateConfig = Partial<AgentRunConfig> & Partial<AgentRuntimeOverrides>;

export interface TenantRuntime {
  storeForTenant(tenantContext: TenantContext): ThreadStore;
  configRepoForTenant(tenantContext: TenantContext): ReturnType<typeof createConfigRepository>;
  mcpManagerForTenant(tenantContext: TenantContext): McpRuntimeManager;
  skillCacheForTenant(tenantContext: TenantContext): LocalSkillRegistryCache;
  getDefaultAgent(tenantContext?: TenantContext): Promise<AgentLoop>;
  resetDefaultAgent(tenantContext: TenantContext): void;
  saveDefaultRunConfig(configPatch: Partial<AgentRunConfig>, tenantContext: TenantContext): Promise<AgentRunConfig>;
  createAgent(
    configPatch?: AgentCreateConfig,
    tenantContext?: TenantContext,
  ): Promise<{ agent: AgentLoop; model: ModelGateway; config: AgentRunConfig }>;
  activeRunRegistry: ActiveRunRegistry;
}

export function createTenantRuntime(options: {
  rootStore: ThreadStore;
  approvalBroker: ApprovalHandler;
  publishEvent(event: ThreadEvent, tenantId?: string): void;
}): TenantRuntime {
  const defaultTenantContext: TenantContext = { tenantId: DEFAULT_TENANT_ID };
  const configRepo = createConfigRepository(options.rootStore);
  const mcpManager = new McpRuntimeManager();
  const skillCache = new LocalSkillRegistryCache();
  let defaultAgent: AgentLoop | null = null;
  const activeRunRegistry = new ActiveRunRegistry();

  function bindAgentToRegistry(agent: AgentLoop): void {
    agent.onEvent((event) => {
      if (event.type === 'turn.started') {
        activeRunRegistry.register({
          runId: event.runId,
          threadId: event.threadId,
          turnId: event.turnId,
          interrupt: () => {
            agent.interrupt(event.threadId);
          },
          resolveDecision: (response) => agent.resolveUserDecision(event.threadId, response),
        });
      } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        activeRunRegistry.finish(event.runId);
      }
    });
  }

  function storeForTenant(_tenantContext: TenantContext): ThreadStore {
    return options.rootStore;
  }

  function configRepoForTenant(_tenantContext: TenantContext): ReturnType<typeof createConfigRepository> {
    return configRepo;
  }

  function mcpManagerForTenant(_tenantContext: TenantContext): McpRuntimeManager {
    return mcpManager;
  }

  function skillCacheForTenant(_tenantContext: TenantContext): LocalSkillRegistryCache {
    return skillCache;
  }

  async function getDefaultAgent(_tenantContext: TenantContext = defaultTenantContext): Promise<AgentLoop> {
    if (!defaultAgent) {
      defaultAgent = (await createAgent({}, defaultTenantContext)).agent;
    }
    return defaultAgent;
  }

  function resetDefaultAgent(_tenantContext: TenantContext): void {
    defaultAgent = null;
  }

  async function saveDefaultRunConfig(
    configPatch: Partial<AgentRunConfig>,
    tenantContext: TenantContext,
  ): Promise<AgentRunConfig> {
    const next = await configRepo.saveDefaultRunConfig(configPatch);
    if (configPatch.skillsRoot !== undefined) {
      skillCache.clear();
    }
    // 系统监控开关/阈值变更：热更新到当前运行中的 agent
    // — Chinese: system monitor toggle/threshold change: hot-update the currently running agent
    if (configPatch.systemMonitorEnabled !== undefined
      || configPatch.systemMonitorSamplingEnabled !== undefined
      || configPatch.systemMonitorGuardEnabled !== undefined
      || configPatch.systemMonitorLogRecordingEnabled !== undefined
      || configPatch.systemMonitorThresholds !== undefined) {
      const currentAgent = defaultAgent;
      if (currentAgent) {
        currentAgent.updateSystemMonitorConfig({
          enabled: configPatch.systemMonitorSamplingEnabled ?? configPatch.systemMonitorEnabled,
          guardEnabled: configPatch.systemMonitorGuardEnabled,
          logRecordingEnabled: configPatch.systemMonitorLogRecordingEnabled,
          thresholds: configPatch.systemMonitorThresholds,
        } as never);
      }
    }
    resetDefaultAgent(tenantContext);
    return next;
  }

  async function createAgent(
    configPatch: AgentCreateConfig = {},
    _tenantContext: TenantContext = defaultTenantContext,
  ): Promise<{ agent: AgentLoop; model: ModelGateway; config: AgentRunConfig }> {
    const tenantStore = options.rootStore;
    const tenantRepo = configRepo;
    const base = await tenantRepo.getDefaultRunConfig();
    const config = resolveConfig({ ...base, ...configPatch });
    await prepareManagedWorkspaceDirectories(config.workspaceRoot);
    const defaultSystemPrompt = createI18n(config.locale ?? 'zh').t(systemPromptKey(config.locale ?? 'zh'));
    const connectorPrompt = dingtalkForwardingSystemPrompt(config.locale ?? 'zh');
    const runtimeSystemPrompt = `${configPatch.systemPrompt
      ?? (configPatch.systemPromptSuffix
        ? `${defaultSystemPrompt}\n\n${connectorPrompt}\n\n${configPatch.systemPromptSuffix}`
        : `${defaultSystemPrompt}\n\n${connectorPrompt}`)}

## Managed temporary files
For one-off scripts, generated inspection output, and disposable caches in a project workspace, use .nexus/tmp/. Do not leave temporary helpers in the project root. Files in .nexus/tmp are managed and may be removed after seven days; durable user-requested work belongs outside that directory.`;
    if (config.workspaceRoot === hiddenChatWorkspaceRoot(config.dataDir)) {
      fs.mkdirSync(config.workspaceRoot, { recursive: true });
    }
    const modelCapabilities = resolveModelCapabilities({
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      modelContextTokens: config.modelContextTokens,
      modelMaxOutputTokens: config.modelMaxOutputTokens,
    });
    const modelConfig: ModelConfig = {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl ?? '',
      apiKey: config.apiKey,
      maxTokens: config.modelMaxOutputTokens ?? 8192,
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
    const skills = await skillCache.loadFromDirectory(config.skillsRoot);
    const hooks = new LocalHookRegistry();
    const webProviderSecrets = await tenantStore.getSetting<WebProviderSecrets>(WEB_PROVIDER_SECRETS_KEY) ?? {};
    const webProvider = resolveWebProviderRuntimeConfig(config, webProviderSecrets);
    await mcpManager.configure(await tenantRepo.listMcpServers(), { startEnabled: false });
    // 已启用的 MCP 服务器预启动，把具体工具直接暴露给 Agent
    // 未启用的 server 不会启动，也不会暴露任何工具
    // — Chinese: pre-start enabled MCP servers so concrete tools are exposed to the agent;
    //            disabled servers are not started and expose no tools
    const mcpTools = await mcpManager.toolDefinitions({ ensureStarted: true });
    // 读取 A2A 客户端配置 — Chinese: read A2A client config
    const a2aConfig = normalizeA2AConfig(await tenantStore.getSetting(A2A_CONFIG_KEY));
    const agent = new AgentLoop(({
      workspaceRoot: config.workspaceRoot,
      sandbox,
      model,
      store: tenantStore,
      tenantId: DEFAULT_TENANT_ID,
      approvalHandler: preset.approval === 'never' ? new AutoApproveHandler() : options.approvalBroker,
      skills,
      hooks,
      locale: config.locale ?? 'zh',
      maxIterations: config.maxIterations,
      webSearchMode: config.webSearchMode,
      webProvider,
      runProfile: config.runProfile,
      modelContextTokens: modelCapabilities.contextTokens,
      agentRoles: config.agentRoles,
      systemPrompt: runtimeSystemPrompt,
      tools: configPatch.tools ?? createTenantToolRegistry(tenantStore),
      mcpTools,
      dynamicContextProvider: createDynamicContextProvider(tenantStore),
      memory: {
        memoryEnabled: config.memoryEnabled,
        autoExtractMemories: config.autoExtractMemories,
        useColdMemories: config.useColdMemories,
        memoryInjectLimit: config.memoryInjectLimit,
        memoryTokenBudget: config.memoryTokenBudget,
      },
      a2aClientEnabled: a2aConfig.clientEnabled,
      a2aRemotes: a2aConfig.remotes.map(r => r.url),
      // 中文注释：采样、轨迹记录和阈值 guard 分别由设置字段控制；guard 只在采样开启时生效。
      maxSubagentDepth: config.maxSubagentDepth ?? 1,
      maxParallelReadonlyTools: config.maxParallelReadonlyTools ?? 2,
      systemMonitor: ({
        enabled: config.systemMonitorSamplingEnabled === true,
        guardEnabled: config.systemMonitorGuardEnabled === true,
        logRecordingEnabled: config.systemMonitorLogRecordingEnabled === true,
        thresholds: config.systemMonitorThresholds,
      } as never),
      skillsDirs: [config.skillsRoot],
    } as AgentConfig));
    agent.onEvent((event) => options.publishEvent(event, DEFAULT_TENANT_ID));
    bindAgentToRegistry(agent);
    await agent.loadSkillsFromConfiguredDirs();
    return { agent, model, config };
  }

  return {
    storeForTenant,
    configRepoForTenant,
    mcpManagerForTenant,
    skillCacheForTenant,
    getDefaultAgent,
    resetDefaultAgent,
    saveDefaultRunConfig,
    createAgent,
    activeRunRegistry,
  };
}

export function createTenantToolRegistry(store: ThreadStore): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
  for (const tool of createDingtalkForwardToolsForStore(store)) {
    registry.register(tool);
  }
  return registry;
}

async function prepareManagedWorkspaceDirectories(workspaceRoot: string): Promise<void> {
  const root = workspaceRoot.trim();
  if (!root) return;
  const tempRoot = path.join(root, '.nexus', 'tmp');
  await fs.promises.mkdir(tempRoot, { recursive: true });
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(tempRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(tempRoot, entry.name);
    const stats = await fs.promises.stat(entryPath).catch(() => null);
    if (!stats || stats.mtimeMs >= cutoff) return;
    await fs.promises.rm(entryPath, { recursive: entry.isDirectory(), force: true });
  }));
}
