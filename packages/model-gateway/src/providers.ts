// Node 标准库：用于读写 ~/.nexus/config.json
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

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

  // MiniMax 官方 Anthropic 兼容接口（M3 / M2.x 系列，支持 thinking / 工具调用）
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    protocol: 'anthropic',
    isLocal: false,
    description: 'MiniMax 官方 API (MiniMax-M3 / M2.x 系列，Anthropic 兼容)',
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
  if (!provider) return undefined;
  const envVar = resolveProviderApiKeyEnvVar(providerId);

  if (envVar) {
    const envKey = readApiKeyEnvironmentValue(envVar);
    if (envKey) return envKey;
  }

  const config = loadConfig();
  const configKey = config.apiKeys?.[providerId];
  if (configKey) return configKey;

  return undefined;
}

/** Resolve the preferred API key env var name for a provider. */
// 解析指定 provider 当前首选的 API key 环境变量名
export function resolveProviderApiKeyEnvVar(providerId: string): string {
  const provider = getProvider(providerId);
  if (!provider) return '';
  const config = loadConfig();
  return config.apiKeyEnvVars?.[providerId] || provider.apiKeyEnvVar;
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
    const envVar = config.apiKeyEnvVars?.[p.id] || p.apiKeyEnvVar;
    if (envVar && readApiKeyEnvironmentValue(envVar)) return true;
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
  /** Provider id → preferred API key env var name. */
  // provider id 到首选 API key 环境变量名的映射
  apiKeyEnvVars?: Record<string, string>;
  /** Env vars managed by Nexus for the local runtime process. */
  // Nexus 管理的本地运行时环境变量，重启后恢复到进程环境
  runtimeEnv?: Record<string, string>;
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
      for (const [key, value] of Object.entries(_cachedConfig?.runtimeEnv ?? {})) {
        if (isValidEnvVarName(key) && value && !process.env[key]) process.env[key] = value;
      }
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
    apiKeyEnvVars: { ...current.apiKeyEnvVars, ...patch.apiKeyEnvVars },
    runtimeEnv: { ...current.runtimeEnv, ...patch.runtimeEnv },
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

/** Save a preferred env var name for a provider API key. */
// 保存指定 provider 的首选 API key 环境变量名
export function saveProviderApiKeyEnvVar(providerId: string, envVar: string): void {
  const provider = getProvider(providerId);
  if (!provider) return;
  const cleaned = envVar.trim();
  if (!isValidEnvVarName(cleaned)) throw new Error('Invalid environment variable name');
  saveConfig({ apiKeyEnvVars: { [providerId]: cleaned } });
}

/** Persist env vars into Nexus config and expose them to the current process. */
// 批量设置 Nexus 当前进程可见的环境变量，并持久化到本地配置
export function saveRuntimeEnvironmentVariables(vars: Record<string, string>): void {
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(vars)) {
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key || !value) continue;
    if (!isValidEnvVarName(key)) throw new Error(`Invalid environment variable name: ${key}`);
    cleaned[key] = value;
    process.env[key] = value;
  }
  if (Object.keys(cleaned).length > 0) saveConfig({ runtimeEnv: cleaned });
}

/** Read an API key env var from the active process, Nexus runtime env, or Windows user/system env. */
// 读取 API key 环境变量：当前进程 > Nexus runtimeEnv > Windows 用户/系统环境变量
export function readApiKeyEnvironmentValue(name: string): string | undefined {
  const normalizedName = name.trim();
  if (!normalizedName || !isValidEnvVarName(normalizedName)) return undefined;
  const direct = process.env[normalizedName];
  if (direct) return direct;

  const runtimeValue = loadConfig().runtimeEnv?.[normalizedName];
  if (runtimeValue) return runtimeValue;

  const externalEnv = readExternalEnvironmentSnapshot();
  const externalValue = externalEnv[normalizedName];
  if (externalValue) return externalValue;

  if (process.platform === 'win32') {
    const lowered = normalizedName.toLowerCase();
    const matchedKey = Object.keys(externalEnv).find((key) => key.toLowerCase() === lowered);
    if (matchedKey && externalEnv[matchedKey]) return externalEnv[matchedKey];
  }
  return undefined;
}

/** List plausible API key env var names for the UI datalist. */
// 列出 UI 可搜索的 API key 环境变量候选
export function listApiKeyEnvVarCandidates(providerId?: string): string[] {
  const config = loadConfig();
  const names = new Set<string>();
  const add = (name?: string) => {
    const value = name?.trim();
    if (value && isValidEnvVarName(value)) names.add(value);
  };
  for (const provider of listAllProviders()) {
    if (!providerId || provider.id === providerId) {
      add(provider.apiKeyEnvVar);
      add(config.apiKeyEnvVars?.[provider.id]);
    }
  }
  for (const name of Object.keys({ ...readExternalEnvironmentSnapshot(), ...process.env, ...config.runtimeEnv })) {
    if (/(API|KEY|TOKEN|SECRET)/i.test(name)) add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
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
  const config = loadConfig();
  for (const provider of KNOWN_PROVIDERS) {
    const key = resolveApiKey(provider.id);
    if (key) {
      const masked = key.length > 8
        ? key.slice(0, 4) + '...' + key.slice(-4)
        : '****';
      const envVar = config.apiKeyEnvVars?.[provider.id] || provider.apiKeyEnvVar;
      const source = readApiKeyEnvironmentValue(envVar) ? 'env' : 'config';
      lines.push(`${provider.name}: ${masked} (${source})`);
    } else {
      lines.push(`${provider.name}: not set`);
    }
  }
  return lines;
}

export function parseWindowsRegistryEnvironmentOutput(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s+REG_(?:SZ|EXPAND_SZ|MULTI_SZ)\s+(.+)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim();
  }
  return env;
}

let externalEnvCache: { at: number; values: Record<string, string> } | null = null;

function readExternalEnvironmentSnapshot(): Record<string, string> {
  if (process.platform !== 'win32') return {};
  const now = Date.now();
  if (externalEnvCache && now - externalEnvCache.at < 5000) return externalEnvCache.values;

  const values: Record<string, string> = {};
  const registryKeys = [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'HKCU\\Environment',
  ];
  for (const registryKey of registryKeys) {
    try {
      const output = execFileSync('reg', ['query', registryKey], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      Object.assign(values, parseWindowsRegistryEnvironmentOutput(output));
    } catch {
      // Registry access is best-effort; process.env and Nexus runtimeEnv remain authoritative.
    }
  }
  externalEnvCache = { at: now, values };
  return values;
}

function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
