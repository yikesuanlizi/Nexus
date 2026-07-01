// Node 标准库：用于读写 ~/.nexus/config.json
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Provider Entry ─────────────────────────────────────────────────────────
// provider 条目：描述一个完整 provider（local 或 remote）
// 英文说明：ProviderEntry 描述一个 provider 的全部元信息
export interface ProviderEntry {
  /** Unique id (e.g. 'deepseek', 'openai', 'ollama'). */
  // provider 唯一 id（例如 'deepseek'、'openai'、'ollama'）
  id: string;
  /** Display name. */
  // 显示名称
  name: string;
  /** Default base URL for the OpenAI-compatible endpoint. */
  // OpenAI 兼容端点的默认 base URL
  baseUrl: string;
  /** Environment variable to read the API key from. */
  // 读取 API key 的环境变量名
  apiKeyEnvVar: string;
  /** API protocol. */
  // API 协议：openai 或 anthropic
  protocol: 'openai' | 'anthropic';
  /** Whether this is a local provider (no API key needed). */
  // 是否为本地 provider（不需要 API key）
  isLocal: boolean;
  /** Optional description. */
  // 描述（可选）
  description?: string;
}

// ─── Known Provider Registry ────────────────────────────────────────────────
// 已知的 provider 静态注册表
const KNOWN_PROVIDERS: ProviderEntry[] = [
  // ── Local ──────────────────────────────────────────────────────────────
  // 本地 provider 区：不需要 API key
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnvVar: '',
    protocol: 'openai',
    isLocal: true,
    description: 'Local Ollama server',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    apiKeyEnvVar: '',
    protocol: 'openai',
    isLocal: true,
    description: 'Local LM Studio server',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://localhost:8000/v1',
    apiKeyEnvVar: '',
    protocol: 'openai',
    isLocal: true,
    description: 'Local vLLM server',
  },

  // ── Remote: OpenAI-compatible ───────────────────────────────────────────
  // 远程 OpenAI 兼容 provider
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'OpenAI API (GPT-4o, etc.)',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'DeepSeek API (DeepSeek-V3, DeepSeek-R1)',
  },
  {
    id: 'zhipu',
    name: '智谱 (ZhipuAI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnvVar: 'ZHIPU_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: '智谱清言 API (GLM-4, etc.)',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnvVar: 'KIMI_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: '月之暗面 Kimi API',
  },
  {
    id: 'qwen',
    name: '通义千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnvVar: 'QWEN_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: '阿里云通义千问 API (Qwen-Max, Qwen-Plus)',
  },
  {
    id: 'baidu',
    name: '百度文心 (ERNIE)',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKeyEnvVar: 'BAIDU_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: '百度千帆 API (ERNIE-4.0, etc.)',
  },
  {
    id: 'volcengine',
    name: '火山引擎 Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnvVar: 'VOLCENGINE_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: '火山引擎 Ark API，可调用豆包等模型',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnvVar: 'SILICONFLOW_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'SiliconFlow API (DeepSeek, Qwen, etc.)',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'Groq Cloud API (Llama, Mixtral)',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnvVar: 'TOGETHER_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'Together AI API',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'OpenRouter — unified API for many models',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'Google Gemini OpenAI-compatible API',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'Mistral AI API',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnvVar: 'PERPLEXITY_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'Perplexity Sonar API',
  },
  {
    id: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnvVar: 'XAI_API_KEY',
    protocol: 'openai',
    isLocal: false,
    description: 'xAI Grok API',
  },

  // ── Remote: Anthropic ──────────────────────────────────────────────────
  // 远程 Anthropic provider
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    protocol: 'anthropic',
    isLocal: false,
    description: 'Anthropic API (Claude)',
  },

  // ── Generic ────────────────────────────────────────────────────────────
  // 通用 OpenAI 兼容端点
  {
    id: 'openai_compatible',
    name: 'OpenAI-compatible',
    baseUrl: 'http://localhost:8080/v1',
    apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
    protocol: 'openai',
    isLocal: true,
    description: 'Generic OpenAI-compatible endpoint',
  },
];

// ─── Registry API ───────────────────────────────────────────────────────────
// 按 id 查 provider；自动把 doubao 归一到 volcengine
export function getProvider(id: string): ProviderEntry | undefined {
  const normalizedId = id === 'doubao' ? 'volcengine' : id;
  return KNOWN_PROVIDERS.find((p) => p.id === normalizedId);
}

// 列出全部内置 provider（拷贝防修改）
export function listProviders(): ProviderEntry[] {
  return [...KNOWN_PROVIDERS];
}

// 列出所有远程 provider
export function listRemoteProviders(): ProviderEntry[] {
  return KNOWN_PROVIDERS.filter((p) => !p.isLocal);
}

// 列出所有本地 provider
export function listLocalProviders(): ProviderEntry[] {
  return KNOWN_PROVIDERS.filter((p) => p.isLocal);
}

// ─── API Key Resolution ─────────────────────────────────────────────────────
/**
 * Resolve the API key for a provider.
 * Priority: explicit override > env var > config file.
 */
// 解析 provider 的 API key；优先级：显式覆盖 > 环境变量 > 配置文件
export function resolveApiKey(
  providerId: string,
  explicitKey?: string,
): string | undefined {
  if (explicitKey) return explicitKey;

  const provider = getProvider(providerId);
  if (!provider || !provider.apiKeyEnvVar) return undefined;

  // 1. 环境变量
  const envKey = process.env[provider.apiKeyEnvVar];
  if (envKey) return envKey;

  // 2. 配置文件
  const config = loadConfig();
  const configKey = config.apiKeys?.[providerId];
  if (configKey) return configKey;

  return undefined;
}

/**
 * Detect which remote providers have API keys available
 * (from env vars or config file).
 */
// 检测当前已配置 API key 的 provider（来自环境变量或配置文件），供 UI 列表展示
export function detectAvailableProviders(): ProviderEntry[] {
  const config = loadConfig();
  return KNOWN_PROVIDERS.filter((p) => {
    if (p.isLocal) return true; // 本地 provider 始终可用
    if (p.apiKeyEnvVar && process.env[p.apiKeyEnvVar]) return true;
    if (config.apiKeys?.[p.id]) return true;
    return false;
  });
}

// ─── Config File Persistence ────────────────────────────────────────────────
// 配置文件位置：~/.nexus/config.json
const CONFIG_DIR = path.join(os.homedir(), '.nexus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 本地持久化的用户配置
// 英文说明：Interface for the locally persisted user config
interface NexusConfig {
  /** Provider id → API key mapping. */
  // provider id 到 API key 的映射
  apiKeys?: Record<string, string>;
  /** Custom provider definitions. */
  // 用户自定义的 provider 定义列表
  customProviders?: ProviderEntry[];
  /** Default provider id. */
  // 默认 provider id
  defaultProvider?: string;
  /** Default model. */
  // 默认模型名
  defaultModel?: string;
}

// 缓存：避免每次读盘
let _cachedConfig: NexusConfig | null = null;

// 加载配置：失败或不存在返回空对象
export function loadConfig(): NexusConfig {
  if (_cachedConfig) return _cachedConfig;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _cachedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* 忽略错误 */ }
  return _cachedConfig ?? {};
}

// 保存配置：深合并 patch 后写盘
export function saveConfig(patch: Partial<NexusConfig>): void {
  const current = loadConfig();
  const merged: NexusConfig = {
    ...current,
    ...patch,
    apiKeys: { ...current.apiKeys, ...patch.apiKeys },
    customProviders: patch.customProviders ?? current.customProviders,
  };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  _cachedConfig = merged;
}

/** Persist an API key to the config file. */
// 把指定 provider 的 API key 持久化到配置文件；英文说明：Persist an API key to ~/.nexus/config.json
export function saveApiKey(providerId: string, apiKey: string): void {
  saveConfig({ apiKeys: { [providerId]: apiKey } });
}

/** Remove an API key from the config file. */
// 从配置文件移除指定 provider 的 API key；英文说明：Remove an API key from the config file
export function removeApiKey(providerId: string): void {
  const current = loadConfig();
  const keys = { ...current.apiKeys };
  delete keys[providerId];
  saveConfig({ apiKeys: keys });
}

/** Add a custom provider definition. */
// 新增或覆盖一个自定义 provider；英文说明：Add a custom provider definition
export function addCustomProvider(provider: ProviderEntry): void {
  const current = loadConfig();
  const existing = current.customProviders ?? [];
  const idx = existing.findIndex((p) => p.id === provider.id);
  if (idx >= 0) existing[idx] = provider;
  else existing.push(provider);
  saveConfig({ customProviders: existing });
}

/** Get all providers including custom ones. */
// 列出内置 + 自定义的所有 provider；英文说明：Get all providers including custom ones
export function listAllProviders(): ProviderEntry[] {
  const config = loadConfig();
  const custom = config.customProviders ?? [];
  return [...KNOWN_PROVIDERS, ...custom];
}

// ─── Environment Variable Summary ───────────────────────────────────────────
/** Return a human-readable summary of which API keys are set. */
// 生成可读的 API key 状态摘要（带遮罩显示）；英文说明：Return a human-readable summary of which API keys are set
export function apiKeySummary(): string[] {
  const lines: string[] = [];
  for (const provider of KNOWN_PROVIDERS) {
    if (provider.isLocal) continue;
    const key = resolveApiKey(provider.id);
    if (key) {
      const masked = key.length > 8
        ? key.slice(0, 4) + '...' + key.slice(-4)
        : '****';
      const source = process.env[provider.apiKeyEnvVar] ? 'env' : 'config';
      lines.push(`${provider.name}: ${masked} (${source})`);
    } else {
      lines.push(`${provider.name}: not set`);
    }
  }
  return lines;
}
