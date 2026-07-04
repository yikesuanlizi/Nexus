import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT_CONFIG } from '../config/botConfig.js';
import { BOT_CONFIG_KEY } from '../config/botConfig.js';
import { DINGTALK_TOOL_NAME } from '../services/dingtalkForwardTool.js';
import { createTenantToolRegistry } from './tenantRuntime.js';

describe('tenant runtime tools', () => {
  it('adds the DingTalk group forwarding connector to ordinary Nexus agents', async () => {
    const store = {
      async getSetting<T>(key: string): Promise<T | null> {
        if (key !== BOT_CONFIG_KEY) return null;
        return {
          ...DEFAULT_BOT_CONFIG,
          dingtalk: {
            ...DEFAULT_BOT_CONFIG.dingtalk,
            enabled: true,
            clientId: 'ding_app_key',
            clientSecret: 'ding_secret',
            robotCode: 'ding_robot',
            targetGroupConversationId: 'cid_group_target',
          },
        } as T;
      },
    };

    const registry = createTenantToolRegistry(store as never);

    expect(registry.get(DINGTALK_TOOL_NAME)).toBeTruthy();
    expect(registry.get('dingtalk_send_group_message')).toBeUndefined();
    expect(registry.get('read_file')).toBeTruthy();
  });
});
