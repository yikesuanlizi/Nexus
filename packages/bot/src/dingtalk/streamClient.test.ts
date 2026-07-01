import { describe, expect, it, vi } from 'vitest';
import { TOPIC_ROBOT } from 'dingtalk-stream';
import { DingtalkStreamClient } from './streamClient.js';
import { CONVERSATION_TYPE_GROUP } from './types.js';

vi.mock('dingtalk-stream', () => {
  class MockDWClient {
    connected = false;
    config: { subscriptions: Array<{ type: string; topic: string }> };
    socketCallBackResponse = vi.fn();
    private readonly listeners = new Map<string, Array<(message: MockDownstream) => void>>();

    constructor(opts: { clientId: string; clientSecret: string; keepAlive?: boolean; debug?: boolean }) {
      void opts;
      this.config = { subscriptions: [{ type: 'EVENT', topic: '*' }] };
    }

    getConfig(): { subscriptions: Array<{ type: string; topic: string }> } {
      return this.config;
    }

    registerCallbackListener(topic: string, callback: (message: MockDownstream) => void): this {
      if (!this.config.subscriptions.some((item) => item.type === 'CALLBACK' && item.topic === topic)) {
        this.config.subscriptions.push({ type: 'CALLBACK', topic });
      }
      this.on(topic, callback);
      return this;
    }

    on(topic: string, callback: (message: MockDownstream) => void): this {
      const existing = this.listeners.get(topic) ?? [];
      existing.push(callback);
      this.listeners.set(topic, existing);
      return this;
    }

    emit(topic: string, message: MockDownstream): void {
      for (const callback of this.listeners.get(topic) ?? []) callback(message);
    }

    async connect(): Promise<void> {
      this.connected = true;
    }

    disconnect(): void {
      this.connected = false;
    }
  }

  return {
    DWClient: MockDWClient,
    TOPIC_ROBOT: '/v1.0/im/bot/messages/get',
  };
});

type MockDownstream = {
  specVersion: string;
  type: string;
  headers: {
    appId: string;
    connectionId: string;
    contentType: string;
    messageId: string;
    time: string;
    topic: string;
  };
  data: string;
};

type PreflightBody = { subscriptions?: Array<{ type: string; topic: string }> };

describe('DingtalkStreamClient', () => {
  it('uses DingTalk robot callback subscriptions and parses callback messages', async () => {
    const preflightBodies: PreflightBody[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      preflightBodies.push(JSON.parse(String(init?.body ?? '{}')) as PreflightBody);
      return new Response(JSON.stringify({ endpoint: 'wss://example.test', ticket: 'ticket' }), { status: 200 });
    }) as typeof fetch;

    const received: unknown[] = [];
    const client = new DingtalkStreamClient({
      clientId: 'ding-client',
      clientSecret: 'secret',
      getToken: async () => 'token',
      onMessage: (msg) => { received.push(msg); },
    });

    try {
      const result = await client.start();
      expect(result.connected).toBe(true);
      expect(preflightBodies[0]?.subscriptions).toEqual([{ type: 'CALLBACK', topic: TOPIC_ROBOT }]);

      const sdkClient = (client as unknown as { sdkClient: {
        getConfig(): { subscriptions: Array<{ type: string; topic: string }> };
        emit(topic: string, message: MockDownstream): void;
        socketCallBackResponse: ReturnType<typeof vi.fn>;
      } }).sdkClient;
      expect(sdkClient.getConfig().subscriptions).toContainEqual({ type: 'CALLBACK', topic: TOPIC_ROBOT });

      sdkClient.emit(TOPIC_ROBOT, {
        specVersion: '1.0',
        type: 'CALLBACK',
        headers: {
          appId: 'app',
          connectionId: 'conn',
          contentType: 'application/json',
          messageId: 'stream-message-id',
          time: '0',
          topic: TOPIC_ROBOT,
        },
        data: JSON.stringify({
          conversationType: CONVERSATION_TYPE_GROUP,
          conversationId: 'cid',
          senderStaffId: 'staff-1',
          senderNick: 'Alice',
          msgId: 'msg-1',
          chatbotUserId: 'bot-1',
          atUsers: [{ dingtalkId: 'bot-1' }],
          sessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=session-token',
          text: { content: ' hello ' },
        }),
      });

      expect(received).toEqual([expect.objectContaining({
        conversationType: CONVERSATION_TYPE_GROUP,
        conversationId: 'cid',
        senderStaffId: 'staff-1',
        senderNick: 'Alice',
        messageId: 'msg-1',
        text: 'hello',
        isAtBot: true,
        sessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=session-token',
      })]);
      expect(sdkClient.socketCallBackResponse).toHaveBeenCalledWith('stream-message-id', 'OK');
    } finally {
      client.stop();
      globalThis.fetch = originalFetch;
    }
  });

  it('parses DingTalk single-chat file messages with download codes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => (
      new Response(JSON.stringify({ endpoint: 'wss://example.test', ticket: 'ticket' }), { status: 200 })
    )) as typeof fetch;
    const received: unknown[] = [];
    const client = new DingtalkStreamClient({
      clientId: 'ding-client',
      clientSecret: 'secret',
      getToken: async () => 'token',
      onMessage: (msg) => { received.push(msg); },
    });

    try {
      await client.start();
      const sdkClient = (client as unknown as { sdkClient: {
        emit(topic: string, message: MockDownstream): void;
      } }).sdkClient;

      sdkClient.emit(TOPIC_ROBOT, {
        specVersion: '1.0',
        type: 'CALLBACK',
        headers: {
          appId: 'app',
          connectionId: 'conn',
          contentType: 'application/json',
          messageId: 'stream-file-message-id',
          time: '0',
          topic: TOPIC_ROBOT,
        },
        data: JSON.stringify({
          conversationType: '1',
          senderStaffId: 'staff-1',
          senderNick: 'Alice',
          msgId: 'msg-file-1',
          fileContent: {
            fileName: '方案.pdf',
            fileSize: 1234,
            downloadCode: 'download-code-1',
            mimeType: 'application/pdf',
          },
        }),
      });

      expect(received).toEqual([expect.objectContaining({
        conversationType: '1',
        conversationId: 'staff-1',
        senderStaffId: 'staff-1',
        text: '方案.pdf',
        messageType: 'file',
        attachments: [{
          type: 'file',
          fileName: '方案.pdf',
          fileSize: 1234,
          downloadCode: 'download-code-1',
          mimeType: 'application/pdf',
        }],
      })]);
    } finally {
      client.stop();
      globalThis.fetch = originalFetch;
    }
  });

  it('parses DingTalk picture messages with content download codes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => (
      new Response(JSON.stringify({ endpoint: 'wss://example.test', ticket: 'ticket' }), { status: 200 })
    )) as typeof fetch;
    const received: unknown[] = [];
    const client = new DingtalkStreamClient({
      clientId: 'ding-client',
      clientSecret: 'secret',
      getToken: async () => 'token',
      onMessage: (msg) => { received.push(msg); },
    });

    try {
      await client.start();
      const sdkClient = (client as unknown as { sdkClient: {
        emit(topic: string, message: MockDownstream): void;
      } }).sdkClient;

      sdkClient.emit(TOPIC_ROBOT, {
        specVersion: '1.0',
        type: 'CALLBACK',
        headers: {
          appId: 'app',
          connectionId: 'conn',
          contentType: 'application/json',
          messageId: 'stream-picture-message-id',
          time: '0',
          topic: TOPIC_ROBOT,
        },
        data: JSON.stringify({
          conversationType: '1',
          senderStaffId: 'staff-1',
          senderNick: 'Alice',
          msgId: 'msg-picture-1',
          msgtype: 'picture',
          content: {
            pictureDownloadCode: 'picture-code-1',
            downloadCode: 'download-code-1',
          },
        }),
      });

      expect(received).toEqual([expect.objectContaining({
        conversationType: '1',
        conversationId: 'staff-1',
        senderStaffId: 'staff-1',
        text: '图片',
        messageType: 'image',
        attachments: [{
          type: 'image',
          fileName: 'msg-picture-1.jpg',
          downloadCode: 'download-code-1',
        }],
      })]);
    } finally {
      client.stop();
      globalThis.fetch = originalFetch;
    }
  });

  it('parses DingTalk rich text messages with text and picture attachments', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => (
      new Response(JSON.stringify({ endpoint: 'wss://example.test', ticket: 'ticket' }), { status: 200 })
    )) as typeof fetch;
    const received: unknown[] = [];
    const client = new DingtalkStreamClient({
      clientId: 'ding-client',
      clientSecret: 'secret',
      getToken: async () => 'token',
      onMessage: (msg) => { received.push(msg); },
    });

    try {
      await client.start();
      const sdkClient = (client as unknown as { sdkClient: {
        emit(topic: string, message: MockDownstream): void;
      } }).sdkClient;

      sdkClient.emit(TOPIC_ROBOT, {
        specVersion: '1.0',
        type: 'CALLBACK',
        headers: {
          appId: 'app',
          connectionId: 'conn',
          contentType: 'application/json',
          messageId: 'stream-rich-message-id',
          time: '0',
          topic: TOPIC_ROBOT,
        },
        data: JSON.stringify({
          conversationType: '1',
          senderStaffId: 'staff-1',
          senderNick: 'Alice',
          msgId: 'msg-rich-1',
          msgtype: 'richText',
          content: {
            richText: [
              { text: '把这个发送到群里' },
              { type: 'picture', pictureDownloadCode: 'picture-code-1', downloadCode: 'download-code-1' },
              { text: '备注信息"好可爱的志志呀"' },
            ],
          },
        }),
      });

      expect(received).toEqual([expect.objectContaining({
        conversationType: '1',
        conversationId: 'staff-1',
        senderStaffId: 'staff-1',
        text: '把这个发送到群里 备注信息"好可爱的志志呀"',
        messageType: 'richText',
        attachments: [{
          type: 'image',
          fileName: 'msg-rich-1-1.jpg',
          downloadCode: 'download-code-1',
        }],
      })]);
    } finally {
      client.stop();
      globalThis.fetch = originalFetch;
    }
  });
});
