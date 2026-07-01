// 机器人控制客户端：刷新状态、保存配置、触发微信登录流程等
// Bot control client: refresh status, save config, trigger WeChat login flows, etc.

import { useCallback, useState } from 'react';
import type { BotConfig, BotStatus } from '../shared/types.js';

export interface WeixinLoginState {
  dialogTitle?: string;
  qr?: string;
  sessionKey?: string;
  message?: string;
  polling?: boolean;
  error?: string;
  successTitle?: string;
}
// 微信登录状态：二维码、会话键、文本消息、轮询标志、错误信息
// WeChat login state: QR code, session key, text message, polling flag, error info

type RemoteBindablePlatform = 'weixin' | 'dingtalk';

export function buildRemoteAssistantBindingPatch(
  botConfig: BotConfig | null,
  botStatus: BotStatus | null,
  threadId?: string,
): { configPatch: Partial<BotConfig>; boundPlatforms: RemoteBindablePlatform[] } {
  if (!threadId) return { configPatch: {}, boundPlatforms: [] };
  const canBindWeixin = Boolean(botConfig?.weixin.accountId) || botStatus?.weixin?.connected === true;
  const canBindDingtalk = Boolean(botConfig?.dingtalk.enabled && botConfig.dingtalk.clientId && botConfig.dingtalk.clientSecret)
    || botStatus?.dingtalk?.configured === true;
  const boundPlatforms: RemoteBindablePlatform[] = [];
  const configPatch: Partial<BotConfig> = {};
  if (canBindWeixin && botConfig?.weixin) {
    configPatch.weixin = { ...botConfig.weixin, enabled: true, activeThreadId: threadId };
    boundPlatforms.push('weixin');
  }
  if (canBindDingtalk && botConfig?.dingtalk) {
    configPatch.dingtalk = { ...botConfig.dingtalk, enabled: true, activeThreadId: threadId };
    boundPlatforms.push('dingtalk');
  }
  return { configPatch, boundPlatforms };
}

export function useBotControls() {
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  // 机器人配置与状态（从服务端拉取）
  // Bot configuration and status (fetched from server)

  const refreshBotStatus = useCallback(async () => {
    const response = await fetch('/api/bot/status');
    if (!response.ok) return;
    const data = (await response.json()) as { config?: BotConfig; status?: BotStatus };
    if (data.config) setBotConfig(data.config);
    setBotStatus(data.status ?? null);
  }, []);
  // 刷新机器人状态（含配置和在线信息）
  // Refreshes bot status (includes config and online info)

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
  // 保存机器人配置（PATCH 覆盖当前配置）
  // Saves bot configuration (PATCH to overwrite current config)

  const bindBotThread = useCallback(async (platform: RemoteBindablePlatform, threadId?: string) => {
    const response = await fetch('/api/bot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          [platform]: {
            enabled: true,
            activeThreadId: threadId || '',
          },
        },
      }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { config?: BotConfig };
    if (data.config) setBotConfig(data.config);
    await refreshBotStatus();
    return true;
  }, [refreshBotStatus]);
  // 将远程助手平台绑定到指定对话线程
  // Binds a remote assistant platform to the specified conversation thread

  const bindWeixinThread = useCallback((threadId?: string) => bindBotThread('weixin', threadId), [bindBotThread]);
  const bindRemoteAssistant = useCallback((platform: RemoteBindablePlatform, threadId?: string) => bindBotThread(platform, threadId), [bindBotThread]);

  const bindRemoteAssistants = useCallback(async (threadId?: string): Promise<{ ok: boolean; boundPlatforms: RemoteBindablePlatform[] }> => {
    const { configPatch, boundPlatforms } = buildRemoteAssistantBindingPatch(botConfig, botStatus, threadId);
    if (boundPlatforms.length === 0) return { ok: false, boundPlatforms };
    const response = await fetch('/api/bot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configPatch }),
    });
    if (!response.ok) return { ok: false, boundPlatforms: [] };
    const data = (await response.json()) as { config?: BotConfig };
    if (data.config) setBotConfig(data.config);
    await refreshBotStatus();
    return { ok: true, boundPlatforms };
  }, [botConfig, botStatus, refreshBotStatus]);
  // 一次性绑定所有可用远程助手平台
  // Binds all currently available remote assistant platforms

  const startWeixinLogin = useCallback(async (threadId?: string) => {
    const response = await fetch('/api/bot/weixin/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: threadId || null }),
    });
    if (!response.ok) return { result: { message: await readFetchError(response) } };
    return (await response.json()) as { result?: { qrDataUrl?: string; qrcode?: string; qrcodeUrl?: string; sessionKey?: string; message?: string } };
  }, []);
  // 开始微信登录：返回二维码、会话键等信息；失败时返回错误文本
  // Starts WeChat login: returns QR code, session key, etc.; returns error text on failure

  const waitWeixinLogin = useCallback(async (sessionKey: string) => {
    const response = await fetch('/api/bot/weixin/login/wait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
    });
    if (!response.ok) return { result: { connected: false, message: await readFetchError(response) } };
    const data = (await response.json()) as { result?: { connected?: boolean; accountId?: string; message?: string } };
    await refreshBotStatus();
    return data;
  }, [refreshBotStatus]);
  // 轮询等待微信登录确认（后台会检测扫码状态）
  // Polls for WeChat login confirmation (backend detects scan status)

  const connectWeixin = useCallback(async (
    threadId: string | undefined,
    onUpdate: (state: WeixinLoginState | null) => void,
  ) => {
    const alreadyConnected = Boolean(botConfig?.weixin.accountId) || botStatus?.weixin?.connected === true;
    if (alreadyConnected) {
      const bound = threadId ? await bindWeixinThread(threadId) : true;
      onUpdate({
        polling: false,
        message: bound
          ? (threadId ? '微信已绑定到当前对话。' : '微信已登录。选择一个对话后可绑定到该对话。')
          : '微信已登录，但绑定当前对话失败。',
        error: bound ? undefined : '绑定当前对话失败。',
      });
      return;
    }
    // 已经登录：直接绑定到指定线程（或提示选择对话绑定）
    // Already signed in: bind to target thread (or prompt thread selection)

    onUpdate({ polling: true, message: '正在连接微信桥接...' });
    const started = await startWeixinLogin(threadId);
    const result = started?.result;
    const sessionKey = result?.sessionKey;
    if (!result || !sessionKey) {
      onUpdate({ polling: false, error: result?.message || '微信桥接不可用。' });
      return;
    }
    // 展示二维码，进入轮询阶段
    // Displays QR code and enters polling phase

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
  }, [bindWeixinThread, botConfig?.weixin.accountId, botStatus?.weixin?.connected, refreshBotStatus, startWeixinLogin, waitWeixinLogin]);
  // 一键连接微信：处理已登录/扫码/轮询/超时等完整状态机
  // One-click WeChat connection: handles signed in / QR scan / polling / timeout full state machine

  const startDingtalkStream = useCallback(async () => {
    const response = await fetch('/api/bot/dingtalk/start', { method: 'POST' });
    if (!response.ok) return { ok: false, error: await readFetchError(response) };
    const data = await response.json() as { ok?: boolean; result?: { connected?: boolean; error?: string } };
    await refreshBotStatus();
    return { ok: data.ok, error: data.result?.error };
  }, [refreshBotStatus]);

  const stopDingtalkStream = useCallback(async () => {
    await fetch('/api/bot/dingtalk/stop', { method: 'POST' });
    await refreshBotStatus();
  }, [refreshBotStatus]);

  const testDingtalkMessage = useCallback(async (conversationId: string, conversationType: 'dm' | 'group', text?: string) => {
    const response = await fetch('/api/bot/dingtalk/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, conversationType, text }),
    });
    if (!response.ok) return { ok: false, error: await readFetchError(response) };
    const data = await response.json() as { ok?: boolean; result?: { ok?: boolean; error?: string } };
    return { ok: data.ok && data.result?.ok, error: data.result?.error };
  }, []);

  return {
    botConfig,
    botStatus,
    bindRemoteAssistant,
    bindWeixinThread,
    bindRemoteAssistants,
    refreshBotStatus,
    saveBotConfig,
    connectWeixin,
    startDingtalkStream,
    stopDingtalkStream,
    testDingtalkMessage,
  };
}

async function readFetchError(response: Response): Promise<string> {
  // 将非 2xx 响应转为可读的错误文本
  // Converts a non-2xx response into a human-readable error message
  try {
    const data = await response.json() as { error?: string; message?: string };
    return data.error || data.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
