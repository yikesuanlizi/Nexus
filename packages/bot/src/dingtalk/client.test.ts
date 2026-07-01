import { describe, expect, it, vi } from 'vitest';
import { DingtalkClient } from './client.js';

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('DingtalkClient', () => {
  it('sends text mentions through a DingTalk session webhook for highlighted group @', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ errcode: 0 });
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    const result = await client.sendWebhookText({
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=session-token',
      text: '@付守凡 糖b',
      atStaffIds: ['staff_fushoufan'],
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://oapi.dingtalk.com/robot/send?access_token=session-token');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      msgtype: 'text',
      text: { content: '@付守凡 糖b' },
      at: {
        atUserIds: ['staff_fushoufan'],
        isAtAll: false,
      },
    });
  });

  it('searches DingTalk contacts by display name and returns candidate user ids', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
        return response({ accessToken: 'token-1', expireIn: 7200 });
      }
      return response({ list: ['staff_fushoufan'] });
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    const result = await client.searchContactUserIds({ queryWord: '付守凡', fullMatch: true, size: 10 });

    expect(result).toEqual({ ok: true, userIds: ['staff_fushoufan'] });
    const searchCall = calls.find((call) => call.url.endsWith('/v1.0/contact/users/search'));
    expect(searchCall).toBeTruthy();
    expect(searchCall?.init.method).toBe('POST');
    expect(searchCall?.init.headers).toMatchObject({
      'x-acs-dingtalk-access-token': 'token-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(searchCall?.init.body))).toMatchObject({
      queryWord: '付守凡',
      fullMatch: true,
      size: 10,
      offset: 0,
    });
  });

  it('falls back to scanning organization departments when searching a user by exact name', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).startsWith('https://oapi.dingtalk.com/gettoken')) {
        return response({ errcode: 0, access_token: 'oapi-token', expires_in: 7200 });
      }
      if (String(url).includes('/topapi/v2/department/listsubid')) {
        const body = new URLSearchParams(String(init?.body ?? ''));
        return response({
          errcode: 0,
          result: body.get('dept_id') === '1' ? [200] : [],
        });
      }
      if (String(url).includes('/topapi/user/listsimple')) {
        const body = new URLSearchParams(String(init?.body ?? ''));
        return response({
          errcode: 0,
          result: {
            has_more: false,
            list: body.get('dept_id') === '200'
              ? [{ userid: 'staff_fushoufan', name: '付守凡' }]
              : [],
          },
        });
      }
      return response({}, false, 404);
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    const result = await client.searchOrgUserIdsByName({ name: '付守凡' });

    expect(result).toEqual({ ok: true, userIds: ['staff_fushoufan'] });
    const rootUserCall = calls.find((call) => call.url.includes('/topapi/user/listsimple') && String(call.init.body).includes('dept_id=1'));
    const childUserCall = calls.find((call) => call.url.includes('/topapi/user/listsimple') && String(call.init.body).includes('dept_id=200'));
    expect(rootUserCall).toBeTruthy();
    expect(childUserCall).toBeTruthy();
    expect(calls.some((call) => call.url.startsWith('https://oapi.dingtalk.com/gettoken'))).toBe(true);
    expect(rootUserCall?.url).toContain('access_token=oapi-token');
    expect(rootUserCall?.init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    });
  });

  it('passes at staff ids to the group message API when sending text', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
        return response({ accessToken: 'token-1', expireIn: 7200 });
      }
      return response({ processQueryKey: 'query-1' });
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    await client.sendText({
      conversationType: '2',
      conversationId: 'cid_group',
      text: '@安博魏 有人找你',
      atStaffIds: ['staff_ambowei'],
    });

    const sendCall = calls.find((call) => call.url.endsWith('/v1.0/robot/groupMessages/send'));
    expect(sendCall).toBeTruthy();
    const body = JSON.parse(String(sendCall?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      robotCode: 'ding_robot',
      openConversationId: 'cid_group',
      msgKey: 'sampleText',
      at: {
        atUserIds: ['staff_ambowei'],
        isAtAll: false,
      },
    });
    expect(JSON.parse(String(body.msgParam))).toMatchObject({
      content: '@安博魏 有人找你',
    });
  });

  it('downloads robot message files by download code', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
        return response({ accessToken: 'token-1', expireIn: 7200 });
      }
      if (String(url).endsWith('/v1.0/robot/messageFiles/download')) {
        return response({ downloadUrl: 'https://files.example.test/download/1' });
      }
      if (String(url) === 'https://files.example.test/download/1') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      return response({}, false, 404);
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    const result = await client.downloadFile({ downloadCode: 'download-code-1' });

    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    const downloadCall = calls.find((call) => call.url.endsWith('/v1.0/robot/messageFiles/download'));
    expect(downloadCall?.init.headers).toMatchObject({
      'x-acs-dingtalk-access-token': 'token-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(downloadCall?.init.body))).toMatchObject({
      downloadCode: 'download-code-1',
      robotCode: 'ding_robot',
    });
  });

  it('uploads image media through OAPI before sending a robot image message', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).startsWith('https://oapi.dingtalk.com/gettoken')) {
        return response({ errcode: 0, access_token: 'oapi-token', expires_in: 7200 });
      }
      if (String(url).startsWith('https://oapi.dingtalk.com/media/upload')) {
        return response({ errcode: 0, media_id: '@media-image-1' });
      }
      if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
        return response({ accessToken: 'token-1', expireIn: 7200 });
      }
      if (String(url).endsWith('/v1.0/robot/groupMessages/send')) {
        return response({ processQueryKey: 'query-1' });
      }
      return response({}, false, 404);
    }) as unknown as typeof fetch;
    const client = new DingtalkClient({
      clientId: 'ding_app_key',
      clientSecret: 'secret',
      robotCode: 'ding_robot',
      fetchImpl,
    });

    const result = await client.sendFile({
      conversationType: '2',
      conversationId: 'cid_group',
      fileName: 'photo.jpg',
      fileBytes: new Uint8Array([1, 2, 3]),
      fileSize: 3,
    });

    expect(result).toMatchObject({ ok: true, processQueryKey: 'query-1' });
    const uploadCall = calls.find((call) => call.url.startsWith('https://oapi.dingtalk.com/media/upload'));
    expect(uploadCall?.url).toContain('access_token=oapi-token');
    expect(uploadCall?.url).toContain('type=image');
    expect((uploadCall?.init.body as FormData).get('media')).toBeTruthy();
    const sendCall = calls.find((call) => call.url.endsWith('/v1.0/robot/groupMessages/send'));
    const body = JSON.parse(String(sendCall?.init.body ?? '{}')) as Record<string, unknown>;
    expect(body).toMatchObject({
      robotCode: 'ding_robot',
      openConversationId: 'cid_group',
      msgKey: 'sampleImageMsg',
    });
    expect(JSON.parse(String(body.msgParam))).toMatchObject({
      photoURL: '@media-image-1',
    });
  });
});
