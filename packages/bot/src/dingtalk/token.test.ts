import { describe, expect, it } from 'vitest';
import { DingtalkTokenManager } from './token.js';

describe('DingtalkTokenManager', () => {
  it('includes DingTalk error code and message when token request fails', async () => {
    const manager = new DingtalkTokenManager({
      clientId: 'app-key',
      clientSecret: 'app-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        code: 'invalidClientIdOrSecret',
        message: '无效的clientId或者clientSecret',
        requestid: 'req-1',
      }), { status: 400 }) as Response,
    });

    await expect(manager.getToken()).rejects.toThrow(
      'DingTalk token request failed: HTTP 400 (code=invalidClientIdOrSecret, message=无效的clientId或者clientSecret, requestid=req-1)',
    );
  });
});
