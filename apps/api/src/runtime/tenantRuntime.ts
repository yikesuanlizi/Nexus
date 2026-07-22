import * as fs from 'node:fs';
import { AgentLoop, McpRuntimeManager, type AgentConfig } from '@nexus/runtime';
import { ModelGateway, type ModelConfig } from '@nexus/model-gateway';
import { AutoApproveHandler, DEFAULT_PRESET, getPreset, type ApprovalHandler, type SandboxConfig } from '@nexus/sandbox';
import { LocalHookRegistry, LocalSkillRegistryCache } from '@nexus/extensions';
import { createI18n, systemPromptKey } from '@nexus/i18n';
import type { ThreadEvent } from '@nexus/protocol';
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
  const configRepos = new Map<string, ReturnType<typeof createConfigRepository>>();
  const mcpManagers = new Map<string, McpRuntimeManager>();
  const skillCaches = new Map<string, LocalSkillRegistryCache>();
  const defaultAgents = new Map<string, AgentLoop>();
  const defaultTenantContext: TenantContext = { tenantId: DEFAULT_TENANT_ID };
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
        });
      } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        activeRunRegistry.finish(event.runId);
      }
    });
  }

  function storeForTenant(tenantContext: TenantContext): ThreadStore {
    return options.rootStore.scope?.(tenantContext.tenantId) ?? options.rootStore;
  }

  function configRepoForTenant(tenantContext: TenantContext): ReturnType<typeof createConfigRepository> {
    let repo = configRepos.get(tenantContext.tenantId);
    if (!repo) {
      repo = createConfigRepository(storeForTenant(tenantContext));
      configRepos.set(tenantContext.tenantId, repo);
    }
    return repo;
  }

  function mcpManagerForTenant(tenantContext: TenantContext): McpRuntimeManager {
    let manager = mcpManagers.get(tenantContext.tenantId);
    if (!manager) {
      manager = new McpRuntimeManager();
      mcpManagers.set(tenantContext.tenantId, manager);
    }
    return manager;
  }

  function skillCacheForTenant(tenantContext: TenantContext): LocalSkillRegistryCache {
    let cache = skillCaches.get(tenantContext.tenantId);
    if (!cache) {
      cache = new LocalSkillRegistryCache();
      skillCaches.set(tenantContext.tenantId, cache);
    }
    return cache;
  }

  async function getDefaultAgent(tenantContext: TenantContext = defaultTenantContext): Promise<AgentLoop> {
    let agent = defaultAgents.get(tenantContext.tenantId);
    if (!agent) {
      agent = (await createAgent({}, tenantContext)).agent;
      defaultAgents.set(tenantContext.tenantId, agent);
    }
    return agent;
  }

  function resetDefaultAgent(tenantContext: TenantContext): void {
    defaultAgents.delete(tenantContext.tenantId);
  }

  async function saveDefaultRunConfig(
    configPatch: Partial<AgentRunConfig>,
    tenantContext: TenantContext,
  ): Promise<AgentRunConfig> {
    const next = await configRepoForTenant(tenantContext).saveDefaultRunConfig(configPatch);
    if (configPatch.skillsRoot !== undefined) {
      skillCacheForTenant(tenantContext).clear();
    }
    // 系统监控开关/阈值变更：热更新到当前运行中的 agent
    // — Chinese: system monitor toggle/threshold change: hot-update the currently running agent
    if (configPatch.systemMonitorEnabled !== undefined) {
      const currentAgent = defaultAgents.get(tenantContext.tenantId);
      if (currentAgent) {
        currentAgent.updateSystemMonitorConfig({ enabled: configPatch.systemMonitorEnabled });
      }
    }
    resetDefaultAgent(tenantContext);
    return next;
  }

  async function createAgent(
    configPatch: AgentCreateConfig = {},
    tenantContext: TenantContext = defaultTenantContext,
  ): Promise<{ agent: AgentLoop; model: ModelGateway; config: AgentRunConfig }> {
    const tenantStore = storeForTenant(tenantContext);
    const tenantRepo = configRepoForTenant(tenantContext);
    const base = await tenantRepo.getDefaultRunConfig();
    const config = resolveConfig({ ...base, ...configPatch });
    const defaultSystemPrompt = createI18n(config.locale ?? 'zh').t(systemPromptKey(config.locale ?? 'zh'));
    const connectorPrompt = dingtalkForwardingSystemPrompt(config.locale ?? 'zh');
    const runtimeSystemPrompt = configPatch.systemPrompt
      ?? (configPatch.systemPromptSuffix
        ? `${defaultSystemPrompt}\n\n${connectorPrompt}\n\n${configPatch.systemPromptSuffix}`
        : `${defaultSystemPrompt}\n\n${connectorPrompt}`);
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
    const skills = await skillCacheForTenant(tenantContext).loadFromDirectory(config.skillsRoot);
    const hooks = new LocalHookRegistry();
    const webProviderSecrets = await tenantStore.getSetting<WebProviderSecrets>(WEB_PROVIDER_SECRETS_KEY) ?? {};
    const webProvider = resolveWebProviderRuntimeConfig(config, webProviderSecrets);
    const mcpManager = mcpManagerForTenant(tenantContext);
    await mcpManager.configure(await tenantRepo.listMcpServers(), { startEnabled: false });
    // 已启用的 MCP 服务器预启动，把具体工具直接暴露给 Agent
    // 未启用的 server 不会启动，也不会暴露任何工具
    // — Chinese: pre-start enabled MCP servers so concrete tools are exposed to the agent;
    //            disabled servers are not started and expose no tools
    const mcpTools = await mcpManager.toolDefinitions({ ensureStarted: true });
    // 读取 A2A 客户端配置 — Chinese: read A2A client config
    const a2aConfig = normalizeA2AConfig(await tenantStore.getSetting(A2A_CONFIG_KEY));
    const agent = new AgentLoop({
      workspaceRoot: config.workspaceRoot,
      sandbox,
      model,
      store: tenantStore,
      tenantId: tenantContext.tenantId,
      approvalHandler: preset.approval === 'never' ? new AutoApproveHandler() : options.approvalBroker,
      skills,
      hooks,
      locale: config.locale ?? 'zh',
      webSearchMode: config.webSearchMode,
      webProvider,
      runProfile: config.runProfile,
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
      // 中文注释：从设置面板的开关读取，启用后 agent 会收到主机压力通知并自动限流
      // — Chinese: read from settings panel toggle; when enabled agent receives host pressure notifications and auto-throttles
      systemMonitor: { enabled: config.systemMonitorEnabled === true },
      skillsDirs: [config.skillsRoot],
    });
    agent.onEvent((event) => options.publishEvent(event, tenantContext.tenantId));
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
