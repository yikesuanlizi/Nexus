import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT_CONFIG, normalizeBotConfig, publicBotConfig } from './botConfig.js';

describe('bot config', () => {
  it('normalizes Weixin bridge settings and hides account ids in public output', () => {
    const config = normalizeBotConfig({
      weixin: {
        enabled: true,
        bridgeUrl: '  http://127.0.0.1:18790/rpc  ',
        accountId: 'wx_account_123456',
      },
    });

    expect(config.weixin).toMatchObject({
      enabled: true,
      bridgeUrl: 'http://127.0.0.1:18790/api/v1/admin/rpc',
      accountId: 'wx_account_123456',
    });
    expect(publicBotConfig(config).weixin.accountId).toBe('wx_a...3456');
  });

  it('keeps future platforms disabled without fake credentials', () => {
    const config = normalizeBotConfig({});

    expect(config.weixin.bridgeUrl).toBe(DEFAULT_BOT_CONFIG.weixin.bridgeUrl);
    expect(config.feishu.enabled).toBe(false);
    expect(config.dingtalk.enabled).toBe(false);
    expect(config.qq.enabled).toBe(false);
  });
});
