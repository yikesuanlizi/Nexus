// 设置面板共享辅助：模型草稿匹配、Provider 下拉分组、卡片图标映射等
import type { Locale, RunConfig } from '../../config/config.js';
import type { McpServerStatus, ModelPreset, ModelPresetConfig, ProviderEntry } from '../../shared/types.js';
import type { DropdownOption } from '../DropdownSelect.js';
import type { IconName } from '../Icon.js';
import type { RecommendedMcp, RecommendedSkill } from '../../features/settings/pluginCatalog.js';
import { t } from '../../shared/i18n.js';

export type ModelConfigDraft = Pick<RunConfig, 'provider' | 'model' | 'baseUrl'>;

// 用 preset 匹配当前 RunConfig，用于标识当前正在使用的预设
export function modelPresetMatchesRunConfig(preset: ModelPreset, config: RunConfig): boolean {
  const entries = Object.entries(preset.config) as Array<[keyof RunConfig, RunConfig[keyof RunConfig] | undefined]>;
  return entries.length > 0 && entries.every(([key, value]) => value === undefined || config[key] === value);
}

// 从 RunConfig 初始化模型草稿
export function modelConfigDraftFromConfig(config: RunConfig): ModelConfigDraft {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o',
  deepseek: 'deepseek-v4-pro',
  zhipu: 'glm-4-plus',
  kimi: 'moonshot-v1-8k',
  qwen: 'qwen-plus',
  baidu: 'ernie-4.0-turbo-8k',
  volcengine: 'doubao-seed-1-6',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  openrouter: 'openai/gpt-4o',
  gemini: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  perplexity: 'sonar-pro',
  xai: 'grok-2-latest',
  anthropic: 'claude-3-5-sonnet-latest',
  minimax: 'MiniMax-M3',
  openai_compatible: 'custom-model',
  ollama: 'llama3.1',
  lmstudio: 'local-model',
  vllm: 'local-model',
};

export function defaultModelForProvider(provider: ProviderEntry | undefined, currentModel: string): string {
  if (!provider) return currentModel;
  if (provider.id.startsWith('custom_')) return currentModel;
  return DEFAULT_MODEL_BY_PROVIDER[provider.id] ?? currentModel;
}

// Provider 下拉分组：本地 / 中国 / 国际 / 通用 / 自定义
export function providerDropdownOptions(providers: ProviderEntry[], locale: Locale): Array<DropdownOption<string>> {
  const local = providers.filter((provider) => provider.isLocal && provider.id !== 'openai_compatible' && !provider.id.startsWith('custom_'));
  const generic = providers.filter((provider) => provider.id === 'openai_compatible');
  const custom = providers.filter((provider) => provider.id.startsWith('custom_'));
  const chinaIds = new Set(['deepseek', 'zhipu', 'kimi', 'qwen', 'baidu', 'volcengine', 'siliconflow', 'minimax']);
  const china = providers.filter((provider) => chinaIds.has(provider.id));
  const global = providers.filter((provider) => !provider.isLocal && !chinaIds.has(provider.id) && !provider.id.startsWith('custom_'));
  const map = (group: string, provider: ProviderEntry): DropdownOption<string> => ({
    group,
    value: provider.id,
    label: provider.name,
  });
  return [
    ...local.map((provider) => map(t(locale, 'localProvider'), provider)),
    ...china.map((provider) => map(t(locale, 'remoteChina'), provider)),
    ...global.map((provider) => map(t(locale, 'remoteGlobal'), provider)),
    ...generic.map((provider) => map(t(locale, 'genericProvider'), provider)),
    ...custom.map((provider) => map(t(locale, 'customProvider'), provider)),
  ];
}

// P2.3 预留：保存模型预设草稿的统一编排函数
export async function saveModelPresetDraft(input: {
  requestName: () => Promise<string | null>;
  ensureProvider: () => Promise<string | null>;
  saveProviderKey: (providerId?: string) => Promise<void>;
  saveProviderEnvVar: (providerId?: string) => Promise<void>;
  savePreset: (name: string, config: ModelPresetConfig) => Promise<void>;
  presetConfig: ModelPresetConfig;
}): Promise<void> {
  const name = await input.requestName();
  if (name === null) return;
  const targetProviderId = await input.ensureProvider();
  const resolvedProviderId = targetProviderId ?? input.presetConfig.provider;
  await input.saveProviderKey(resolvedProviderId);
  await input.saveProviderEnvVar(resolvedProviderId);
  await input.savePreset(name, {
    provider: resolvedProviderId,
    model: input.presetConfig.model,
    baseUrl: input.presetConfig.baseUrl || '',
  });
}

// 插件中心顶部 tab 图标
export function pluginNavIcon(tab: 'recommended' | 'mcp' | 'skills' | 'web'): IconName {
  switch (tab) {
    case 'recommended':
      return 'spark';
    case 'mcp':
      return 'panel';
    case 'skills':
      return 'workflow';
    case 'web':
      return 'search';
  }
}

export function recommendedCardVisual(item: RecommendedSkill | RecommendedMcp): { icon: IconName; bg: string } {
  const id = item.id.toLowerCase();
  if (id.includes('playwright')) return { icon: item.type === 'mcp' ? 'puppet' : 'browser', bg: '#a7f3d0' };
  if (id.includes('browser')) return { icon: 'browser', bg: '#bae6fd' };
  if (id.includes('filesystem')) return { icon: 'folder', bg: '#fef3c7' };
  if (id.includes('figma')) return { icon: 'layers', bg: '#e9d5ff' };
  if (id.includes('code-review')) return { icon: 'review', bg: '#bae6fd' };
  if (id.includes('bug-hunt')) return { icon: 'activity', bg: '#fed7aa' };
  if (id.includes('frontend-design')) return { icon: 'browser', bg: '#a7f3d0' };
  if (id.includes('frontend-polish')) return { icon: 'spark', bg: '#e9d5ff' };
  if (id.includes('release-notes')) return { icon: 'doc', bg: '#fecdd3' };
  return item.type === 'mcp'
    ? { icon: 'panel', bg: '#bae6fd' }
    : { icon: 'workflow', bg: '#fef3c7' };
}

export function skillCardVisual(name: string): { icon: IconName; bg: string } {
  const key = name.toLowerCase();
  if (key.includes('review')) return { icon: 'review', bg: '#bae6fd' };
  if (key.includes('sql')) return { icon: 'sql', bg: '#fef3c7' };
  if (key.includes('doc') || key.includes('release')) return { icon: 'doc', bg: '#fecdd3' };
  if (key.includes('mermaid')) return { icon: 'mermaid', bg: '#a7f3d0' };
  if (key.includes('translate')) return { icon: 'translate', bg: '#e9d5ff' };
  if (key.includes('playwright') || key.includes('browser')) return { icon: 'browser', bg: '#a7f3d0' };
  if (key.includes('bug') || key.includes('hunt')) return { icon: 'activity', bg: '#fed7aa' };
  if (key.includes('frontend')) return { icon: 'spark', bg: '#e9d5ff' };
  return { icon: 'workflow', bg: '#fef3c7' };
}

export function webToolCardVisual(id: string): { icon: IconName; bg: string } {
  if (id === 'firecrawl') return { icon: 'search', bg: '#bae6fd' };
  return { icon: 'browser', bg: '#a7f3d0' };
}

export function mcpCardVisual(name: string): { icon: IconName; bg: string } {
  const key = name.toLowerCase();
  if (key.includes('github')) return { icon: 'github', bg: '#bae6fd' };
  if (key.includes('file')) return { icon: 'folder', bg: '#fef3c7' };
  if (key.includes('slack')) return { icon: 'message', bg: '#fecdd3' };
  if (key.includes('postgres') || key.includes('pg')) return { icon: 'database', bg: '#a7f3d0' };
  if (key.includes('puppet') || key.includes('playwright')) return { icon: 'puppet', bg: '#fed7aa' };
  if (key.includes('memory')) return { icon: 'memoryChip', bg: '#e9d5ff' };
  if (key.includes('figma')) return { icon: 'layers', bg: '#e9d5ff' };
  if (key.includes('browser')) return { icon: 'browser', bg: '#bae6fd' };
  return { icon: 'panel', bg: '#bae6fd' };
}

// MCP 状态文本与色调
export function mcpStatusText(
  status: McpServerStatus | undefined,
  enabled: boolean,
  locale: Locale,
): { label: string; dot: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (!enabled || !status || status.status === 'disabled') {
    return { label: locale === 'zh' ? '已禁用' : 'Disabled', dot: '○', tone: 'muted' };
  }
  if (status.status === 'configured') {
    return { label: locale === 'zh' ? '已启用 · 待启动' : 'Enabled · Standby', dot: '●', tone: 'warn' };
  }
  if (status.status === 'running') {
    const tools = locale === 'zh' ? `${status.toolCount} 个工具` : `${status.toolCount} tools`;
    return { label: `${locale === 'zh' ? '运行中' : 'Running'} · ${tools}`, dot: '●', tone: 'ok' };
  }
  if (status.status === 'starting') {
    return { label: locale === 'zh' ? '启动中' : 'Starting', dot: '●', tone: 'warn' };
  }
  const label = status.status === 'dead'
    ? (locale === 'zh' ? '已崩溃' : 'Dead')
    : (locale === 'zh' ? '启动失败' : 'Failed');
  return { label, dot: '●', tone: 'danger' };
}
