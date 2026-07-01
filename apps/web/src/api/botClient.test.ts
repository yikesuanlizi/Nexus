import { describe, expect, it } from 'vitest';
import { buildRemoteAssistantBindingPatch } from './botClient.js';
import type { BotConfig, BotStatus } from '../shared/types.js';

function botConfig(): BotConfig {
  return {
    weixin: {
      enabled: true,
      bridgeMode: 'desktop_managed',
      bridgeUrl: '',
      accountId: 'wx-user',
      activeThreadId: 'old-weixin',
      autoStartMonitor: false,
      syncHistoryOnConnect: true,
    },
    feishu: { enabled: false },
    dingtalk: {
      enabled: true,
      connectionMode: 'stream',
      clientId: 'ding-client',
      clientSecret: 'ding-secret',
      robotCode: 'robot',
      cardTemplateId: 'card',
      targetGroupName: '',
      targetGroupConversationId: '',
      targetGroupSessionWebhook: '',
      lastDetectedGroupConversationId: '',
      lastDetectedGroupSessionWebhook: '',
      lastDetectedGroupAt: '',
      allowedUsers: [],
      webhookSecret: '',
      activeThreadId: 'old-dingtalk',
      autoStart: true,
    },
    qq: { enabled: false },
  };
}

describe('buildRemoteAssistantBindingPatch', () => {
  it('binds every currently available remote assistant to one thread', () => {
    const config = botConfig();
    const status: BotStatus = {
      weixin: { connected: true },
      dingtalk: { configured: true },
    };

    expect(buildRemoteAssistantBindingPatch(config, status, 'thread-1')).toEqual({
      boundPlatforms: ['weixin', 'dingtalk'],
      configPatch: {
        weixin: { ...config.weixin, enabled: true, activeThreadId: 'thread-1' },
        dingtalk: { ...config.dingtalk, enabled: true, activeThreadId: 'thread-1' },
      },
    });
  });
});
