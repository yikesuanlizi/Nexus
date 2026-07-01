import { DEFAULT_RUN_CONFIG_KEY, WEB_PROVIDER_SECRETS_KEY, publicRunConfig, publicWebProviderConfig, type AgentRunConfig, type WebProviderSecrets } from '../config/config.js';
import { readJson, sendJson } from '../shared/http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadStore } from '@nexus/storage';

// 设置路由选项 — Chinese: settings route options
export interface SettingsRouteOptions {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  store: ThreadStore;
  getDefaultRunConfig(): Promise<AgentRunConfig>;
  saveDefaultRunConfig(configPatch: Partial<AgentRunConfig>): Promise<AgentRunConfig>;
  resetDefaultAgent(): void;
}

// 处理设置路由（读取 / 更新默认运行配置与 Web 提供商密钥）
// — Chinese: handle settings routes (read/update default run config and web provider secrets)
export async function handleSettingsRoute(options: SettingsRouteOptions): Promise<boolean> {
  const { req, res, pathname, store } = options;
  // GET /api/settings — 返回公开的运行配置与 Web 提供商配置（隐去密钥）
  // — Chinese: GET /api/settings — return public run config + web provider config
  if (req.method === 'GET' && pathname === '/api/settings') {
    const stored = await store.getSetting<Partial<AgentRunConfig>>(DEFAULT_RUN_CONFIG_KEY);
    const webProviderSecrets = await store.getSetting<WebProviderSecrets>(WEB_PROVIDER_SECRETS_KEY) ?? {};
    sendJson(res, 200, {
      config: publicRunConfig(await options.getDefaultRunConfig()),
      stored: Boolean(stored),
      webProvider: publicWebProviderConfig(webProviderSecrets),
    });
    return true;
  }

  // PATCH /api/settings — 更新配置（含清除/写入 firecrawl 密钥）
  // — Chinese: PATCH /api/settings — update config (including clear/write firecrawl key)
  if (req.method !== 'PATCH' || pathname !== '/api/settings') return false;
  const body = await readJson<{
    config?: Partial<AgentRunConfig>;
    webProvider?: { firecrawlApiKey?: string | null; clearFirecrawlApiKey?: boolean };
  }>(req);
  const config = await options.saveDefaultRunConfig(body.config ?? {});
  let webProviderSecrets = await store.getSetting<WebProviderSecrets>(WEB_PROVIDER_SECRETS_KEY) ?? {};
  if (body.webProvider?.clearFirecrawlApiKey) {
    const { firecrawlApiKey: _firecrawlApiKey, ...rest } = webProviderSecrets;
    webProviderSecrets = rest;
    await store.setSetting(WEB_PROVIDER_SECRETS_KEY, webProviderSecrets);
    options.resetDefaultAgent();
  } else if (typeof body.webProvider?.firecrawlApiKey === 'string' && body.webProvider.firecrawlApiKey.trim()) {
    webProviderSecrets = { ...webProviderSecrets, firecrawlApiKey: body.webProvider.firecrawlApiKey.trim() };
    await store.setSetting(WEB_PROVIDER_SECRETS_KEY, webProviderSecrets);
    options.resetDefaultAgent();
  }
  sendJson(res, 200, {
    ok: true,
    config: publicRunConfig(config),
    webProvider: publicWebProviderConfig(webProviderSecrets),
  });
  return true;
}
