import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Provider Entry ─────────────────────────────────────────────────────────
export interface ProviderEntry {
  /** Unique id (e.g. 'deepseek', 'openai', 'ollama'). */
  id: string;
  /** Display name. */
  name: string;
  /** Default base URL for the OpenAI-compatible endpoint. */
  baseUrl: string;
  /** Environment variable to read the API key from. */
  apiKeyEnvVar: string;
  /** API protocol. */
  protocol: 'openai' | 'anthropic';
  /** Whether this is a local provider (no API key needed). */
  isLocal: boolean;
  /** Optional description. */
  description?: string;
}

// ─── Known Provider Registry ────────────────────────────────────────────────
const KNOWN_PROVIDERS: ProviderEntry[] = [
  // ── Local ──────────────────────────────────────────────────────────────
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

  // ── Remote: Anthropic ──────────────────────────────────────────────────
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
export function getProvider(id: string): ProviderEntry | undefined {
  const normalizedId = id === 'doubao' ? 'volcengine' : id;
  return KNOWN_PROVIDERS.find((p) => p.id === normalizedId);
}

export function listProviders(): ProviderEntry[] {
  return [...KNOWN_PROVIDERS];
}

export function listRemoteProviders(): ProviderEntry[] {
  return KNOWN_PROVIDERS.filter((p) => !p.isLocal);
}

export function listLocalProviders(): ProviderEntry[] {
  return KNOWN_PROVIDERS.filter((p) => p.isLocal);
}

// ─── API Key Resolution ─────────────────────────────────────────────────────
/**
 * Resolve the API key for a provider.
 * Priority: explicit override > env var > config file.
 */
export function resolveApiKey(
  providerId: string,
  explicitKey?: string,
): string | undefined {
  if (explicitKey) return explicitKey;

  const provider = getProvider(providerId);
  if (!provider || !provider.apiKeyEnvVar) return undefined;

  // 1. Environment variable
  const envKey = process.env[provider.apiKeyEnvVar];
  if (envKey) return envKey;

  // 2. Config file
  const config = loadConfig();
  const configKey = config.apiKeys?.[providerId];
  if (configKey) return configKey;

  return undefined;
}

/**
 * Detect which remote providers have API keys available
 * (from env vars or config file).
 */
export function detectAvailableProviders(): ProviderEntry[] {
  const config = loadConfig();
  return KNOWN_PROVIDERS.filter((p) => {
    if (p.isLocal) return true; // local always "available"
    if (p.apiKeyEnvVar && process.env[p.apiKeyEnvVar]) return true;
    if (config.apiKeys?.[p.id]) return true;
    return false;
  });
}

// ─── Config File Persistence ────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), '.nexus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface NexusConfig {
  /** Provider id → API key mapping. */
  apiKeys?: Record<string, string>;
  /** Custom provider definitions. */
  customProviders?: ProviderEntry[];
  /** Default provider id. */
  defaultProvider?: string;
  /** Default model. */
  defaultModel?: string;
}

let _cachedConfig: NexusConfig | null = null;

export function loadConfig(): NexusConfig {
  if (_cachedConfig) return _cachedConfig;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _cachedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return _cachedConfig ?? {};
}

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
export function saveApiKey(providerId: string, apiKey: string): void {
  saveConfig({ apiKeys: { [providerId]: apiKey } });
}

/** Remove an API key from the config file. */
export function removeApiKey(providerId: string): void {
  const current = loadConfig();
  const keys = { ...current.apiKeys };
  delete keys[providerId];
  saveConfig({ apiKeys: keys });
}

/** Add a custom provider definition. */
export function addCustomProvider(provider: ProviderEntry): void {
  const current = loadConfig();
  const existing = current.customProviders ?? [];
  const idx = existing.findIndex((p) => p.id === provider.id);
  if (idx >= 0) existing[idx] = provider;
  else existing.push(provider);
  saveConfig({ customProviders: existing });
}

/** Get all providers including custom ones. */
export function listAllProviders(): ProviderEntry[] {
  const config = loadConfig();
  const custom = config.customProviders ?? [];
  return [...KNOWN_PROVIDERS, ...custom];
}

// ─── Environment Variable Summary ───────────────────────────────────────────
/** Return a human-readable summary of which API keys are set. */
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
