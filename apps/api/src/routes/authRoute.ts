import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ThreadStore } from '@nexus/storage';
import {
  AUTH_TOKENS_KEY,
  createAuthToken,
  createJwtForToken,
  hashToken,
  listPublicAuthTokens,
  toIdentity,
  verifyLoginToken,
  type AuthConfig,
  type AuthIdentity,
  type AuthRole,
  type AuthTokenRecord,
} from '../auth/auth.js';
import { readJson, sendError, sendJson } from '../shared/http.js';
import { safeTenantId } from '../shared/tenant.js';

// 处理认证相关路由（登录、登录信息、管理令牌） — Chinese: handle auth routes (login, me, admin tokens)
export async function handleAuthRoute(options: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  segments: string[];
  store: ThreadStore;
  authConfig: AuthConfig;
  identity?: AuthIdentity | null;
  now?(): string;
  createId?(): string;
  createRawToken?(): string;
}): Promise<boolean> {
  const { req, res, segments, store, authConfig } = options;
  const now = options.now?.() ?? new Date().toISOString();

  if (segments[0] === 'api' && segments[1] === 'auth') {
    // POST /api/auth/login — 登录，交换令牌获取 JWT
    // — Chinese: login, exchange token for JWT
    if (req.method === 'POST' && segments[2] === 'login') {
      const body = await readJson<{ token?: string }>(req);
      const token = body.token?.trim() ?? '';
      if (!token) {
        sendError(res, 400, 'token is required');
        return true;
      }
      const records = await readAuthTokenRecords(store);
      const record = await verifyLoginToken(token, records, now);
      if (!record) {
        sendError(res, 401, 'Invalid token');
        return true;
      }
      const nextRecord = { ...record, lastUsedAt: now, updatedAt: now };
      await writeAuthTokenRecords(store, records.map((item) => item.id === record.id ? nextRecord : item));
      const jwt = await createJwtForToken(nextRecord, authConfig.jwtSecret, now, authConfig.jwtTtlSeconds);
      sendJson(res, 200, { ok: true, jwt, identity: toIdentity(nextRecord), expiresIn: authConfig.jwtTtlSeconds });
      return true;
    }

    // GET /api/auth/me — 返回当前登录身份
    // — Chinese: return current authenticated identity
    if (req.method === 'GET' && segments[2] === 'me') {
      if (!options.identity) {
        sendError(res, 401, 'Authentication token is required');
        return true;
      }
      sendJson(res, 200, { ok: true, identity: options.identity });
      return true;
    }
  }

  // 管理令牌路由（需要 admin 角色或 admin-bootstrap-token）
  // — Chinese: admin token routes (need admin role or admin bootstrap token)
  if (segments[0] !== 'api' || segments[1] !== 'admin' || segments[2] !== 'tokens') return false;
  if (!isAdminRequest(req, options.identity, authConfig)) {
    sendError(res, 403, 'Admin token is required');
    return true;
  }

  const records = await readAuthTokenRecords(store);

  // GET /api/admin/tokens — 列出所有令牌
  // — Chinese: list all tokens
  if (req.method === 'GET' && segments.length === 3) {
    sendJson(res, 200, { tokens: listPublicAuthTokens(records) });
    return true;
  }

  // POST /api/admin/tokens — 创建新令牌
  // — Chinese: create new token
  if (req.method === 'POST' && segments.length === 3) {
    const body = await readJson<{
      name?: string;
      role?: AuthRole;
      tenantId?: string;
      scopes?: string[];
      expiresAt?: string | null;
    }>(req);
    const role = parseRole(body.role);
    if (!role) {
      sendError(res, 400, 'role must be admin, tenant, or bot');
      return true;
    }
    const created = await createAuthToken({
      name: body.name ?? role,
      role,
      tenantId: body.tenantId ?? (role === 'admin' ? 'default' : ''),
      scopes: body.scopes,
      expiresAt: body.expiresAt ?? null,
      now,
      createId: options.createId,
      createRawToken: options.createRawToken,
    });
    await writeAuthTokenRecords(store, [created.record, ...records]);
    sendJson(res, 200, { ok: true, token: created.token, record: listPublicAuthTokens([created.record])[0] });
    return true;
  }

  const tokenId = segments[3];
  const record = records.find((item) => item.id === tokenId);
  if (!tokenId || !record) {
    sendError(res, 404, 'Auth token not found');
    return true;
  }

  // PATCH /api/admin/tokens/:id — 更新令牌属性
  // — Chinese: update token attributes
  if (req.method === 'PATCH' && segments.length === 4) {
    const body = await readJson<{
      name?: string;
      enabled?: boolean;
      scopes?: string[];
      expiresAt?: string | null;
      tenantId?: string;
    }>(req);
    const next: AuthTokenRecord = {
      ...record,
      name: body.name?.trim() || record.name,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : record.enabled,
      scopes: Array.isArray(body.scopes) ? [...new Set(body.scopes.map((scope) => scope.trim()).filter(Boolean))] : record.scopes,
      expiresAt: body.expiresAt === undefined ? record.expiresAt : body.expiresAt,
      tenantId: body.tenantId ? safeTenantId(body.tenantId) : record.tenantId,
      updatedAt: now,
    };
    await writeAuthTokenRecords(store, records.map((item) => item.id === record.id ? next : item));
    sendJson(res, 200, { ok: true, record: listPublicAuthTokens([next])[0] });
    return true;
  }

  // DELETE /api/admin/tokens/:id — 删除令牌
  // — Chinese: delete token
  if (req.method === 'DELETE' && segments.length === 4) {
    await writeAuthTokenRecords(store, records.filter((item) => item.id !== record.id));
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /api/admin/tokens/:id/rotate — 轮换令牌
  // — Chinese: rotate token
  if (req.method === 'POST' && segments.length === 5 && segments[4] === 'rotate') {
    const raw = options.createRawToken?.() ?? `nexus_${cryptoRandom()}`;
    const next: AuthTokenRecord = {
      ...record,
      tokenHash: await hashToken(raw),
      tokenPrefix: raw.slice(0, 8),
      tokenVersion: record.tokenVersion + 1,
      updatedAt: now,
      lastUsedAt: null,
    };
    await writeAuthTokenRecords(store, records.map((item) => item.id === record.id ? next : item));
    sendJson(res, 200, { ok: true, token: raw, record: listPublicAuthTokens([next])[0] });
    return true;
  }

  return false;
}

// 读取所有已存储的认证令牌记录 — Chinese: read all stored auth token records
export async function readAuthTokenRecords(store: ThreadStore): Promise<AuthTokenRecord[]> {
  const stored = await store.getSetting<unknown>(AUTH_TOKENS_KEY);
  if (Array.isArray(stored)) return stored.filter(isAuthTokenRecord);
  if (!stored || typeof stored !== 'object' || !Array.isArray((stored as { tokens?: unknown }).tokens)) return [];
  return (stored as { tokens: unknown[] }).tokens.filter(isAuthTokenRecord);
}

// 写入认证令牌记录 — Chinese: write auth token records
export async function writeAuthTokenRecords(store: ThreadStore, records: AuthTokenRecord[]): Promise<void> {
  await store.setSetting(AUTH_TOKENS_KEY, { tokens: records });
}

// 判断请求是否来自管理员（通过 identity 或 x-nexus-admin-bootstrap-token 头部）
// — Chinese: check if request is from admin (via identity or header bootstrap token)
export function isAdminRequest(req: IncomingMessage, identity: AuthIdentity | null | undefined, authConfig: AuthConfig): boolean {
  if (identity?.role === 'admin') return true;
  const raw = req.headers['x-nexus-admin-bootstrap-token'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return Boolean(authConfig.adminBootstrapToken && value === authConfig.adminBootstrapToken);
}

// 解析角色字符串 — Chinese: parse role string
function parseRole(value: unknown): AuthRole | null {
  return value === 'admin' || value === 'tenant' || value === 'bot' ? value : null;
}

// 类型保护：判断是否为合法的 AuthTokenRecord — Chinese: type guard for AuthTokenRecord
function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
  const record = value as Partial<AuthTokenRecord>;
  return Boolean(record && typeof record.id === 'string' && typeof record.tokenHash === 'string');
}

// 生成随机字符串（用作新令牌的 raw token） — Chinese: generate random raw token
function cryptoRandom(): string {
  return randomBytes(24).toString('base64url');
}
