import type {
  WeixinBridgeClientOptions,
  WeixinBridgeSendResult,
  WeixinLoginStartResult,
  WeixinLoginWaitResult,
} from './types.js';

type JsonRecord = Record<string, unknown>;

export class WeixinBridgeClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WeixinBridgeClientOptions) {
    this.rpcUrl = options.rpcUrl.trim();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<JsonRecord> {
    const url = new URL(this.rpcUrl);
    const response = await this.fetchImpl(`${url.origin}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(recordMessage(data) || `Weixin bridge health HTTP ${response.status}`);
    return data;
  }

  async startLogin(): Promise<WeixinLoginStartResult> {
    const result = await this.call('web.login.start', {}) as unknown as WeixinLoginStartResult & JsonRecord;
    const qr = readWeixinQrValue(result);
    return {
      ...result,
      ...(qr ? { qrDataUrl: qr, qrcodeUrl: result.qrcodeUrl || qr, qrcode: result.qrcode || qr } : {}),
    };
  }

  async waitLogin(sessionKey: string): Promise<WeixinLoginWaitResult> {
    return this.call('web.login.wait', { sessionKey, timeoutMs: 6_500 }, 10_000) as unknown as Promise<WeixinLoginWaitResult>;
  }

  async startMonitor(accountId: string, options?: { syncHistory?: boolean }): Promise<JsonRecord> {
    return this.call('channels.start', { channel: 'openclaw-weixin', accountId, syncHistory: options?.syncHistory !== false });
  }

  async status(): Promise<JsonRecord> {
    return this.call('channels.status', {});
  }

  async stopMonitor(accountId?: string): Promise<JsonRecord> {
    return this.call('channels.stop', accountId ? { accountId } : {});
  }

  async sendMessage(params: { accountId: string; to: string; text: string; contextToken?: string }): Promise<WeixinBridgeSendResult> {
    const result = await this.call('web.message.send', params);
    if (result.ok === false) {
      throw new Error(recordMessage(result) || 'Weixin bridge sendMessage failed');
    }
    return result as unknown as WeixinBridgeSendResult;
  }

  async logout(accountId?: string): Promise<JsonRecord> {
    return this.call('accounts.logout', accountId ? { accountId } : {});
  }

  private async call(method: string, params: JsonRecord, timeoutMs = this.timeoutMs): Promise<JsonRecord> {
    if (!this.rpcUrl) throw new Error('Weixin bridge URL is empty');
    const response = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(recordMessage(data) || `Weixin bridge HTTP ${response.status}`);
    }
    if (data.error && typeof data.error === 'object') {
      throw new Error(recordMessage(data.error as JsonRecord) || 'Weixin bridge RPC failed');
    }
    return (data.result && typeof data.result === 'object' ? data.result : data) as JsonRecord;
  }
}

async function readJsonResponse(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) as JsonRecord : {};
  } catch {
    return { message: text.trim() };
  }
}

function recordMessage(record: JsonRecord): string {
  const message = record.message;
  return typeof message === 'string' ? message : '';
}

function readWeixinQrValue(record: JsonRecord): string {
  for (const key of ['qrDataUrl', 'qrUrl', 'qrcode', 'qrCode', 'qrcodeUrl', 'url']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
