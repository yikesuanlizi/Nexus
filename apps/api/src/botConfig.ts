export const BOT_CONFIG_KEY = 'bot.config.v1';
export const DEFAULT_WEIXIN_BRIDGE_URL = 'http://127.0.0.1:18790/api/v1/admin/rpc';
const LEGACY_WEIXIN_BRIDGE_URL = 'http://127.0.0.1:18790/rpc';

export interface BotPlatformConfig {
  enabled: boolean;
}

export interface WeixinBotConfig extends BotPlatformConfig {
  bridgeUrl: string;
  accountId: string;
  activeThreadId: string;
}

export interface BotConfig {
  weixin: WeixinBotConfig;
  feishu: BotPlatformConfig;
  dingtalk: BotPlatformConfig;
  qq: BotPlatformConfig;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  weixin: {
    enabled: false,
    bridgeUrl: DEFAULT_WEIXIN_BRIDGE_URL,
    accountId: '',
    activeThreadId: '',
  },
  feishu: { enabled: false },
  dingtalk: { enabled: false },
  qq: { enabled: false },
};

export function normalizeBotConfig(input: unknown): BotConfig {
  const raw = asRecord(input);
  const weixin = asRecord(raw.weixin);
  return {
    weixin: {
      enabled: normalizeBoolean(weixin.enabled, DEFAULT_BOT_CONFIG.weixin.enabled),
      bridgeUrl: normalizeWeixinBridgeUrl(weixin.bridgeUrl),
      accountId: normalizeString(weixin.accountId, DEFAULT_BOT_CONFIG.weixin.accountId),
      activeThreadId: normalizeString(weixin.activeThreadId, DEFAULT_BOT_CONFIG.weixin.activeThreadId),
    },
    feishu: normalizeSimplePlatform(raw.feishu),
    dingtalk: normalizeSimplePlatform(raw.dingtalk),
    qq: normalizeSimplePlatform(raw.qq),
  };
}

export function publicBotConfig(config: BotConfig): BotConfig {
  return {
    ...config,
    weixin: {
      ...config.weixin,
      accountId: maskSecret(config.weixin.accountId),
    },
  };
}

export function mergeBotConfig(current: BotConfig, patch: unknown): BotConfig {
  const raw = asRecord(patch);
  const rawWeixin = asRecord(raw.weixin);
  const weixinPatch = {
    ...rawWeixin,
    accountId: isMaskedValue(rawWeixin.accountId) ? current.weixin.accountId : rawWeixin.accountId,
  };
  return normalizeBotConfig({
    ...current,
    ...raw,
    weixin: { ...current.weixin, ...weixinPatch },
    feishu: { ...current.feishu, ...asRecord(raw.feishu) },
    dingtalk: { ...current.dingtalk, ...asRecord(raw.dingtalk) },
    qq: { ...current.qq, ...asRecord(raw.qq) },
  });
}

function normalizeSimplePlatform(input: unknown): BotPlatformConfig {
  const raw = asRecord(input);
  return { enabled: normalizeBoolean(raw.enabled, false) };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeWeixinBridgeUrl(value: unknown): string {
  const url = normalizeString(value, DEFAULT_WEIXIN_BRIDGE_URL);
  return url === LEGACY_WEIXIN_BRIDGE_URL ? DEFAULT_WEIXIN_BRIDGE_URL : url;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > 8 ? `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}` : '****';
}

function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes('...');
}
