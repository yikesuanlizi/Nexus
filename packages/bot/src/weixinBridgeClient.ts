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
    return this.call('web.login.start', {}) as unknown as Promise<WeixinLoginStartResult>;
  }

  async waitLogin(sessionKey: string): Promise<WeixinLoginWaitResult> {
    return this.call('web.login.wait', { sessionKey }) as unknown as Promise<WeixinLoginWaitResult>;
  }

  async startMonitor(accountId: string): Promise<JsonRecord> {
    return this.call('channels.start', { channel: 'openclaw-weixin', accountId });
  }

  async stopMonitor(accountId?: string): Promise<JsonRecord> {
    return this.call('channels.stop', accountId ? { accountId } : {});
  }

  async sendMessage(params: { accountId: string; to: string; text: string; contextToken?: string }): Promise<WeixinBridgeSendResult> {
    return this.call('web.message.send', params) as unknown as Promise<WeixinBridgeSendResult>;
  }

  private async call(method: string, params: JsonRecord): Promise<JsonRecord> {
    if (!this.rpcUrl) throw new Error('Weixin bridge URL is empty');
    const response = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
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
