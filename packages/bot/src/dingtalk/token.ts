import { DINGTALK_API_BASE, DINGTALK_OAPI_BASE, TOKEN_REFRESH_MARGIN_MS, type DingtalkClientOptions, type DingtalkTokenResult } from './types.js';

export class DingtalkTokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private cachedToken = '';
  private tokenExpiresAt = 0;
  private refreshPromise: Promise<string> | null = null;
  private cachedOapiToken = '';
  private oapiTokenExpiresAt = 0;
  private oapiRefreshPromise: Promise<string> | null = null;

  constructor(options: DingtalkClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this._refreshToken();
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  async getOapiToken(): Promise<string> {
    if (this.cachedOapiToken && Date.now() < this.oapiTokenExpiresAt) {
      return this.cachedOapiToken;
    }
    if (this.oapiRefreshPromise) {
      return this.oapiRefreshPromise;
    }
    this.oapiRefreshPromise = this._refreshOapiToken();
    try {
      return await this.oapiRefreshPromise;
    } finally {
      this.oapiRefreshPromise = null;
    }
  }

  invalidate(): void {
    this.cachedToken = '';
    this.tokenExpiresAt = 0;
    this.cachedOapiToken = '';
    this.oapiTokenExpiresAt = 0;
  }

  private async _refreshToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: this.clientId, appSecret: this.clientSecret }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`DingTalk token request failed: HTTP ${response.status}${formatDingtalkErrorDetail(detail)}`);
      }
      const data = await response.json() as DingtalkTokenResult & { accessToken?: string; expireIn?: number };
      const accessToken = data.accessToken;
      if (!accessToken) throw new Error('DingTalk accessToken missing in response');
      const rawExpiresIn = typeof data.expireIn === 'number' ? data.expireIn : 7200;
      this.cachedToken = accessToken;
      this.tokenExpiresAt = Date.now() + rawExpiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS;
      return accessToken;
    } finally {
      clearTimeout(timer);
    }
  }

  private async _refreshOapiToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = new URL(`${DINGTALK_OAPI_BASE}/gettoken`);
    url.searchParams.set('appkey', this.clientId);
    url.searchParams.set('appsecret', this.clientSecret);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`DingTalk OAPI token request failed: HTTP ${response.status}${formatDingtalkErrorDetail(detail)}`);
      }
      const data = await response.json() as {
        errcode?: number;
        errmsg?: string;
        access_token?: string;
        expires_in?: number;
      };
      if (typeof data.errcode === 'number' && data.errcode !== 0) {
        throw new Error(`DingTalk OAPI token request failed: errcode=${data.errcode}, errmsg=${data.errmsg ?? 'unknown error'}`);
      }
      const accessToken = data.access_token;
      if (!accessToken) throw new Error('DingTalk OAPI access_token missing in response');
      const rawExpiresIn = typeof data.expires_in === 'number' ? data.expires_in : 7200;
      this.cachedOapiToken = accessToken;
      this.oapiTokenExpiresAt = Date.now() + rawExpiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS;
      return accessToken;
    } finally {
      clearTimeout(timer);
    }
  }
}

function formatDingtalkErrorDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; message?: unknown; requestid?: unknown };
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    const requestId = typeof parsed.requestid === 'string' ? parsed.requestid : '';
    const parts = [
      code ? `code=${code}` : '',
      message ? `message=${message}` : '',
      requestId ? `requestid=${requestId}` : '',
    ].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : `: ${trimmed.slice(0, 500)}`;
  } catch {
    return `: ${trimmed.slice(0, 500)}`;
  }
}
