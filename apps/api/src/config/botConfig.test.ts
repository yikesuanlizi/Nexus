import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT_CONFIG, mergeBotConfig, normalizeBotConfig, publicBotConfig } from './botConfig.js';

describe('bot config', () => {
  it('normalizes Weixin bridge settings and hides account ids in public output', () => {
    const config = normalizeBotConfig({
      weixin: {
        enabled: true,
        bridgeMode: 'desktop_managed',
      bridgeUrl: '  http://127.0.0.1:18790/rpc  ',
        accountId: 'wx_account_123456',
        autoStartMonitor: false,
        syncHistoryOnConnect: false,
      },
    });

    expect(config.weixin).toMatchObject({
      enabled: true,
      bridgeMode: 'desktop_managed',
      bridgeUrl: 'http://127.0.0.1:18790/rpc',
      accountId: 'wx_account_123456',
      autoStartMonitor: false,
      syncHistoryOnConnect: false,
    });
    expect(publicBotConfig(config).weixin.accountId).toBe('wx_a...3456');
  });

  it('keeps future platforms disabled without fake credentials', () => {
    const config = normalizeBotConfig({});

    expect(config.weixin.bridgeUrl).toBe(DEFAULT_BOT_CONFIG.weixin.bridgeUrl);
    expect(config.weixin.bridgeMode).toBe('desktop_managed');
    expect(config.weixin.autoStartMonitor).toBe(true);
    expect(config.weixin.syncHistoryOnConnect).toBe(true);
    expect(config.feishu.enabled).toBe(false);
    expect(config.dingtalk.enabled).toBe(false);
    expect(config.dingtalk.targetGroupName).toBe('');
    expect(config.dingtalk.targetGroupConversationId).toBe('');
    expect(config.dingtalk.targetGroupSessionWebhook).toBe('');
    expect(config.dingtalk.lastDetectedGroupConversationId).toBe('');
    expect(config.dingtalk.lastDetectedGroupSessionWebhook).toBe('');
    expect(config.dingtalk.lastDetectedGroupAt).toBe('');
    expect(config.qq.enabled).toBe(false);
  });

  it('normalizes and exposes DingTalk target group settings', () => {
    const config = normalizeBotConfig({
      dingtalk: {
        enabled: true,
        targetGroupName: '  打完我去打DD·  ',
        targetGroupConversationId: '  cid_group_1  ',
        targetGroupSessionWebhook: '  https://oapi.dingtalk.com/robot/send?access_token=target-token  ',
        lastDetectedGroupConversationId: '  cid_detected  ',
        lastDetectedGroupSessionWebhook: '  https://oapi.dingtalk.com/robot/send?access_token=detected-token  ',
        lastDetectedGroupAt: '  2026-06-27T00:00:00.000Z  ',
      },
    });

    expect(config.dingtalk).toMatchObject({
      targetGroupName: '打完我去打DD·',
      targetGroupConversationId: 'cid_group_1',
      targetGroupSessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=target-token',
      lastDetectedGroupConversationId: 'cid_detected',
      lastDetectedGroupSessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=detected-token',
      lastDetectedGroupAt: '2026-06-27T00:00:00.000Z',
    });
    expect(publicBotConfig(config).dingtalk).toMatchObject({
      targetGroupName: '打完我去打DD·',
      targetGroupConversationId: 'cid_group_1',
      targetGroupSessionWebhook: 'http...oken',
      lastDetectedGroupConversationId: 'cid_detected',
      lastDetectedGroupSessionWebhook: 'http...oken',
    });
  });

  it('preserves external RPC mode and URL for server-managed channels', () => {
    const config = normalizeBotConfig({
      weixin: {
        enabled: true,
        bridgeMode: 'external_rpc',
        bridgeUrl: 'https://bot-gateway.example.com/rpc',
      },
    });

    expect(config.weixin.bridgeMode).toBe('external_rpc');
    expect(config.weixin.bridgeUrl).toBe('https://bot-gateway.example.com/rpc');
  });

  it('preserves the connected Weixin account when binding a thread', () => {
    const current = normalizeBotConfig({
      weixin: {
        enabled: true,
        accountId: 'wx_account_123456',
        activeThreadId: 'old_thread',
      },
    });

    const next = mergeBotConfig(current, {
      weixin: {
        enabled: true,
        activeThreadId: 'thread_current',
      },
    });

    expect(next.weixin.accountId).toBe('wx_account_123456');
    expect(next.weixin.activeThreadId).toBe('thread_current');
  });
});
