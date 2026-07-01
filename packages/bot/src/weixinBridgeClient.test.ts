import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WeixinBridgeClient } from './index.js';

let server: ReturnType<typeof createServer> | null = null;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {}));
  });
}

function writeJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function withBridge(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Promise<string> {
  server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}/rpc`;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe('WeixinBridgeClient', () => {
  it('calls bridge health and login rpc methods', async () => {
    const calls: string[] = [];
    const rpcUrl = await withBridge(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        writeJson(res, { ok: true, status: 'live' });
        return;
      }
      const body = await readBody(req);
      calls.push(String(body.method));
      if (body.method === 'web.login.start') writeJson(res, { ok: true, qrDataUrl: 'data:image/png;base64,qr', sessionKey: 's1' });
      else if (body.method === 'web.login.wait') {
        expect(body).toMatchObject({ params: { sessionKey: 's1', timeoutMs: 6_500 } });
        writeJson(res, { connected: true, accountId: 'wx_1', sessionKey: 's1' });
      }
      else writeJson(res, { ok: true });
    });
    const client = new WeixinBridgeClient({ rpcUrl, timeoutMs: 5_000 });

    await expect(client.health()).resolves.toMatchObject({ ok: true });
    await expect(client.startLogin()).resolves.toMatchObject({ sessionKey: 's1' });
    await expect(client.waitLogin('s1')).resolves.toMatchObject({ connected: true, accountId: 'wx_1' });
    expect(calls).toEqual(['web.login.start', 'web.login.wait']);
  });

  it('sends WeChat text through the bridge', async () => {
    let payload: Record<string, unknown> | null = null;
    const rpcUrl = await withBridge(async (req, res) => {
      payload = await readBody(req);
      writeJson(res, { ok: true, messageId: 'wx_msg_1' });
    });
    const client = new WeixinBridgeClient({ rpcUrl, timeoutMs: 5_000 });

    await expect(client.sendMessage({ accountId: 'wx', to: 'friend', text: '你好' })).resolves.toMatchObject({
      ok: true,
      messageId: 'wx_msg_1',
    });
    expect(payload).toMatchObject({
      method: 'web.message.send',
      params: { accountId: 'wx', to: 'friend', text: '你好' },
    });
  });

  it('throws when the bridge rejects a WeChat send request', async () => {
    const rpcUrl = await withBridge(async (_req, res) => {
      writeJson(res, { ok: true, result: { ok: false, message: 'WeChat account is not configured.' } });
    });
    const client = new WeixinBridgeClient({ rpcUrl, timeoutMs: 5_000 });

    await expect(client.sendMessage({ accountId: 'missing', to: 'friend', text: '你好' })).rejects.toThrow(
      'WeChat account is not configured.',
    );
  });

  it('reads monitor diagnostics from the bridge', async () => {
    let payload: Record<string, unknown> | null = null;
    const rpcUrl = await withBridge(async (req, res) => {
      payload = await readBody(req);
      writeJson(res, { monitors: [{ accountId: 'wx', running: true, webhookCount: 1 }] });
    });
    const client = new WeixinBridgeClient({ rpcUrl, timeoutMs: 5_000 });

    await expect(client.status()).resolves.toMatchObject({
      monitors: [{ accountId: 'wx', running: true, webhookCount: 1 }],
    });
    expect(payload).toMatchObject({ method: 'channels.status' });
  });
});
