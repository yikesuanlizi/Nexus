import { useCallback, useState } from 'react';
import type { BotConfig, BotStatus } from './types.js';

export interface WeixinLoginState {
  qr?: string;
  sessionKey?: string;
  message?: string;
  polling?: boolean;
  error?: string;
}

export function useBotControls() {
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);

  const refreshBotStatus = useCallback(async () => {
    const response = await fetch('/api/bot/status');
    if (!response.ok) return;
    const data = (await response.json()) as { config?: BotConfig; status?: BotStatus };
    if (data.config) setBotConfig(data.config);
    setBotStatus(data.status ?? null);
  }, []);

  const saveBotConfig = useCallback(async (next: BotConfig) => {
    const response = await fetch('/api/bot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: next }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { config?: BotConfig };
    if (data.config) setBotConfig(data.config);
    await refreshBotStatus();
  }, [refreshBotStatus]);

  const startWeixinLogin = useCallback(async (threadId?: string) => {
    const response = await fetch('/api/bot/weixin/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: threadId || null }),
    });
    if (!response.ok) return null;
    return (await response.json()) as { result?: { qrDataUrl?: string; qrcode?: string; qrcodeUrl?: string; sessionKey?: string; message?: string } };
  }, []);

  const waitWeixinLogin = useCallback(async (sessionKey: string) => {
    const response = await fetch('/api/bot/weixin/login/wait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: { connected?: boolean; accountId?: string; message?: string } };
    await refreshBotStatus();
    return data;
  }, [refreshBotStatus]);

  const connectWeixin = useCallback(async (
    threadId: string | undefined,
    onUpdate: (state: WeixinLoginState | null) => void,
  ) => {
    onUpdate({ polling: true, message: '正在连接微信桥接...' });
    const started = await startWeixinLogin(threadId);
    const result = started?.result;
    const sessionKey = result?.sessionKey;
    if (!result || !sessionKey) {
      onUpdate({ polling: false, error: result?.message || '微信桥接不可用。' });
      return;
    }
    onUpdate({
      qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
      sessionKey,
      message: result.message,
      polling: true,
    });
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1800 : 2500));
      const waited = await waitWeixinLogin(sessionKey);
      const waitResult = waited?.result;
      if (waitResult?.connected) {
        onUpdate({
          qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
          sessionKey,
          message: waitResult.message || '微信已连接。',
          polling: false,
        });
        await refreshBotStatus();
        return;
      }
      if (waitResult?.message) {
        onUpdate({
          qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
          sessionKey,
          message: waitResult.message,
          polling: true,
        });
      }
    }
    onUpdate({
      qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
      sessionKey,
      message: '登录确认超时，请重新连接。',
      polling: false,
    });
  }, [refreshBotStatus, startWeixinLogin, waitWeixinLogin]);

  return {
    botConfig,
    botStatus,
    refreshBotStatus,
    saveBotConfig,
    connectWeixin,
  };
}
