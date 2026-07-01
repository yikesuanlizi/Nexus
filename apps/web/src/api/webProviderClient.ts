// 网页服务提供商状态 Hook：保存/清除 Firecrawl API Key，合并设置响应
// Web provider state hook: save/clear Firecrawl API Key, merge settings response

import { useCallback, useState } from 'react';
import type { WebProviderPublicConfig } from '../shared/types.js';

export interface SettingsResponseWithWebProvider {
  webProvider?: WebProviderPublicConfig;
}
// 合并到 /api/settings 响应中的 web provider 字段类型
// Type for the web provider field merged into the /api/settings response

export function useWebProviderSettings() {
  const [webProviderState, setWebProviderState] = useState<WebProviderPublicConfig | null>(null);
  // 当前网页服务提供商状态（例如 Firecrawl 是否已配置）
  // Current web provider state (e.g. whether Firecrawl is configured)

  const applyWebProviderState = useCallback((data: SettingsResponseWithWebProvider) => {
    if (data.webProvider) setWebProviderState(data.webProvider);
  }, []);
  // 从设置响应中提取 web provider 信息并更新本地状态
  // Extracts web provider info from the settings response and updates local state

  const saveWebProviderKey = useCallback(async (apiKey: string) => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webProvider: { firecrawlApiKey: apiKey } }),
    });
    if (response.ok) applyWebProviderState(await response.json() as SettingsResponseWithWebProvider);
  }, [applyWebProviderState]);
  // 保存 Firecrawl API Key（通过 PATCH /api/settings）
  // Saves the Firecrawl API Key (via PATCH /api/settings)

  const clearWebProviderKey = useCallback(async () => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webProvider: { clearFirecrawlApiKey: true } }),
    });
    if (response.ok) applyWebProviderState(await response.json() as SettingsResponseWithWebProvider);
  }, [applyWebProviderState]);
  // 清除已保存的 Firecrawl API Key
  // Clears the saved Firecrawl API Key

  return { applyWebProviderState, clearWebProviderKey, saveWebProviderKey, webProviderState };
}
