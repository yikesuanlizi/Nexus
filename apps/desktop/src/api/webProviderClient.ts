import { useCallback, useState } from 'react';
import type { WebProviderPublicConfig } from '../shared/types.js';

export interface SettingsResponseWithWebProvider {
  webProvider?: WebProviderPublicConfig;
}

// Hook：管理网页读取 provider（例如 Firecrawl）的密钥保存与清除
// Chinese translation: Hook for managing the web reader provider (e.g. Firecrawl): saving and clearing its API key.
export function useWebProviderSettings() {
  const [webProviderState, setWebProviderState] = useState<WebProviderPublicConfig | null>(null);

  const applyWebProviderState = useCallback((data: SettingsResponseWithWebProvider) => {
    if (data.webProvider) setWebProviderState(data.webProvider);
  }, []);

  // 保存 Firecrawl 等网页读取 provider 的 API 密钥到后端设置
  // Chinese translation: Persists the web reader provider API key (e.g. Firecrawl) into the backend settings.
  const saveWebProviderKey = useCallback(async (apiKey: string) => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webProvider: { firecrawlApiKey: apiKey } }),
    });
    if (response.ok) applyWebProviderState(await response.json() as SettingsResponseWithWebProvider);
  }, [applyWebProviderState]);

  // 清除网页读取 provider 的 API 密钥
  // Chinese translation: Clears the stored web reader provider API key.
  const clearWebProviderKey = useCallback(async () => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webProvider: { clearFirecrawlApiKey: true } }),
    });
    if (response.ok) applyWebProviderState(await response.json() as SettingsResponseWithWebProvider);
  }, [applyWebProviderState]);

  return { applyWebProviderState, clearWebProviderKey, saveWebProviderKey, webProviderState };
}
