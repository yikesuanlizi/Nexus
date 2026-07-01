import type { RuntimeTurnContext } from '@nexus/runtime';
import type { ThreadStore } from '@nexus/storage';
import { BOT_CONFIG_KEY, normalizeBotConfig } from '../config/botConfig.js';

export function createDynamicContextProvider(store: ThreadStore): (ctx: RuntimeTurnContext) => Promise<string[]> {
  return async (ctx) => {
    const botConfig = normalizeBotConfig(await store.getSetting(BOT_CONFIG_KEY));
    return [
      [
        '远程助手绑定状态：',
        `weixin.enabled=${botConfig.weixin.enabled}`,
        `weixin.bridgeMode=${botConfig.weixin.bridgeMode}`,
        `weixin.activeThreadMatched=${botConfig.weixin.activeThreadId === ctx.threadId}`,
        `weixin.syncHistoryOnConnect=${botConfig.weixin.syncHistoryOnConnect}`,
        `dingtalk.enabled=${botConfig.dingtalk.enabled}`,
        `dingtalk.configured=${Boolean(botConfig.dingtalk.clientId && botConfig.dingtalk.clientSecret)}`,
        `dingtalk.connectionMode=${botConfig.dingtalk.connectionMode}`,
        `dingtalk.activeThreadMatched=${botConfig.dingtalk.activeThreadId === ctx.threadId}`,
      ].join(' '),
    ];
  };
}
