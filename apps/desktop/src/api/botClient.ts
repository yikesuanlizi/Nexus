import { useCallback, useRef, useState } from 'react';
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

// Hook：封装微信 bot 的状态获取、配置保存、登录/退出与对话绑定等操作
// Chinese translation: Hook exposing WeChat bot control actions: status fetching, config saving, login, logout, and chat binding.
export function useBotControls() {
  // 后端返回的 bot 配置对象，包含微信/飞书/钉钉/QQ 的启用状态
  // Chinese translation: Backend-provided bot config including enablement for WeChat/Feishu/DingTalk/QQ.
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  // 当前 bot 运行状态，包含桥接连接信息与监控数据
  // Chinese translation: Current bot runtime status including bridge connection info and monitor data.
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  // 正在进行中的登录流程：promise + 当前展示状态（供 Dialog 消费）
  // Chinese translation: In-flight login flow: promise + current display state (consumed by the dialog).
  const activeLoginRef = useRef<{
    promise: Promise<void>;
    state: WeixinLoginState;
  } | null>(null);
  // 登录代次：用于避免旧的异步回调覆盖用户主动取消后的新状态
  // Chinese translation: Login generation counter, used to prevent stale async callbacks from overwriting newer state after cancellation.
  const loginGenerationRef = useRef(0);

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

  // 登出微信账号，并在成功后刷新本地状态
  // Chinese translation: Logs out the WeChat account; refreshes local state on success.
  const logoutWeixin = useCallback(async () => {
    const response = await fetch('/api/bot/weixin/logout', { method: 'POST' });
    if (!response.ok) return;
    const data = (await response.json()) as { config?: BotConfig };
    if (data.config) setBotConfig(data.config);
    await refreshBotStatus();
  }, [refreshBotStatus]);

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

  const startWeixinLogin = useCallback(async (threadId?: string) => {
    const response = await fetch('/api/bot/weixin/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: threadId || null }),
    });
    if (!response.ok) return { result: { message: await readFetchError(response) } };
    return (await response.json()) as { result?: { qrDataUrl?: string; qrcode?: string; qrcodeUrl?: string; sessionKey?: string; message?: string } };
  }, []);

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

  // 主动连接微信：若已登录则直接尝试绑定给定对话；否则通过扫码—轮询的方式完成登录，并通过 onUpdate 回调通知 UI 更新状态
  // Chinese translation: Initiates a WeChat connection. If already signed in, it just binds the given thread; otherwise it scan-codes + polls to complete login, updating the UI via onUpdate.
  const connectWeixin = useCallback(async (
    threadId: string | undefined,
    onUpdate: (state: WeixinLoginState | null) => void,
  ) => {
    const alreadyConnected = Boolean(botConfig?.weixin.accountId) || botStatus?.weixin?.connected === true;
    if (alreadyConnected) {
      // 已登录：直接绑定到当前 threadId，没有则只提示用户
      // Chinese translation: Already signed in — directly bind to threadId if provided; otherwise just inform the user.
      const bound = threadId ? await bindWeixinThread(threadId) : true;
      onUpdate({
        polling: false,
        message: bound
          ? (threadId ? '微信已绑定到当前对话。' : '微信已登录。选择一个对话后可绑定到该对话。')
          : '微信已登录，但绑定当前对话失败。',
        error: bound ? undefined : '绑定当前对话失败。',
      });
      activeLoginRef.current = null;
      return;
    }
    if (activeLoginRef.current?.state.polling) {
      // 已有扫码轮询在进行：直接沿用上次结果，不重复发起
      // Chinese translation: A poll is already in progress — reuse the previous result instead of starting a new one.
      onUpdate(activeLoginRef.current.state);
      return activeLoginRef.current.promise;
    }
    // 递增登录代次，用于忽略掉被用户主动终止后的过期回调
    // Chinese translation: Increment the login generation counter, so stale callbacks after cancellation are ignored.
    const generation = loginGenerationRef.current + 1;
    loginGenerationRef.current = generation;
    const isCurrentLogin = () => loginGenerationRef.current === generation;
    // 设置登录状态：若当前登录代次已不是最新，则丢弃更新
    // Chinese translation: Updates login state; dropped if a newer generation has superseded the current login.
    const setLoginState = (state: WeixinLoginState) => {
      if (!isCurrentLogin()) return;
      activeLoginRef.current = activeLoginRef.current
        ? { ...activeLoginRef.current, state }
        : { promise: Promise.resolve(), state };
      onUpdate(state);
    };
    const runLogin = async () => {
      const started = await startWeixinLogin(threadId);
      const result = started?.result;
      const sessionKey = result?.sessionKey;
      if (!result || !sessionKey) {
        setLoginState({ polling: false, error: result?.message || '微信桥接不可用。' });
        return;
      }
      setLoginState({
        qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
        sessionKey,
        message: result.message,
        polling: true,
      });
      // 轮询最多 24 次，等待用户扫码确认
      // Chinese translation: Polls up to 24 times waiting for the user to scan and confirm.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1800 : 2500));
        if (!isCurrentLogin()) return;
        const waited = await waitWeixinLogin(sessionKey);
        if (!isCurrentLogin()) return;
        const waitResult = waited?.result;
        if (waitResult?.connected) {
          setLoginState({
            sessionKey,
            message: waitResult.message || '微信已连接。',
            polling: false,
          });
          await refreshBotStatus();
          return;
        }
        if (waitResult?.message) {
          setLoginState({
            qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
            sessionKey,
            message: waitResult.message,
            polling: true,
          });
        }
      }
      // 超过轮询上限仍未连接：提示用户重新连接
      // Chinese translation: Exceeded poll limit without connecting — ask the user to reconnect.
      setLoginState({
        qr: result.qrDataUrl || result.qrcodeUrl || result.qrcode,
        sessionKey,
        message: '登录确认超时，请重新连接。',
        polling: false,
      });
    };
    const initialState = { polling: true, message: '正在连接微信桥接...' };
    const promise = runLogin().finally(() => {
      if (isCurrentLogin() && activeLoginRef.current?.promise === promise && activeLoginRef.current.state.polling) {
        activeLoginRef.current = null;
      }
    });
    activeLoginRef.current = { promise, state: initialState };
    onUpdate(initialState);
    return promise;
  }, [bindWeixinThread, botConfig?.weixin.accountId, botStatus?.weixin?.connected, refreshBotStatus, startWeixinLogin, waitWeixinLogin]);

  const cancelWeixinLogin = useCallback(() => {
    loginGenerationRef.current += 1;
    activeLoginRef.current = null;
  }, []);

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
    refreshBotStatus,
    saveBotConfig,
    bindRemoteAssistant,
    bindWeixinThread,
    bindRemoteAssistants,
    connectWeixin,
    cancelWeixinLogin,
    logoutWeixin,
    startDingtalkStream,
    stopDingtalkStream,
    testDingtalkMessage,
  };
}

async function readFetchError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string; message?: string };
    return data.error || data.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
