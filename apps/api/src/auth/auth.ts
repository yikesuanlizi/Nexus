import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { safeTenantId, type TenantContext } from '../shared/tenant.js';
import type { StorageMode } from '@nexus/storage';

// 认证令牌存储键 — Chinese: auth token storage key
export const AUTH_TOKENS_KEY = 'auth.tokens.v1';

// 认证模式：关闭 | 令牌 — Chinese: auth mode: off | token
export type AuthMode = 'off' | 'token';
// 认证角色：管理员 | 租户 | 机器人 — Chinese: auth role: admin | tenant | bot
export type AuthRole = 'admin' | 'tenant' | 'bot';

export interface AuthConfig {
  mode: AuthMode;
  jwtSecret: string;
  jwtTtlSeconds: number;
  adminBootstrapToken: string;
}

// 解析认证配置：根据存储模式与环境变量推断 auth 模式 — Chinese: resolve auth config
export function resolveAuthConfig(
  storageMode: StorageMode,
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const rawMode = env.NEXUS_AUTH_MODE?.trim().toLowerCase();
  const mode: AuthMode = rawMode === 'off'
    ? 'off'
    : rawMode === 'token'
      ? 'token'
      : storageMode === 'multi' ? 'token' : 'off';
  if (rawMode && rawMode !== 'off' && rawMode !== 'token') {
    throw new Error(`Invalid NEXUS_AUTH_MODE: ${env.NEXUS_AUTH_MODE}`);
  }
  if (mode === 'off') {
    return {
      mode,
      jwtSecret: '',
      jwtTtlSeconds: parsePositiveInt(env.NEXUS_JWT_TTL_SECONDS, 12 * 60 * 60),
      // JWT 存活秒数 — Chinese: JWT TTL seconds
      adminBootstrapToken: env.NEXUS_ADMIN_BOOTSTRAP_TOKEN?.trim() ?? '',
      // 管理员启动令牌 — Chinese: admin bootstrap token
    };
  }
  // Token 模式下必须提供 JWT 密钥 — Chinese: JWT secret required in token mode
  const jwtSecret = env.NEXUS_JWT_SECRET?.trim();
  if (!jwtSecret) throw new Error('NEXUS_JWT_SECRET is required when token auth is enabled');
  return {
    mode,
    jwtSecret,
    jwtTtlSeconds: parsePositiveInt(env.NEXUS_JWT_TTL_SECONDS, 12 * 60 * 60),
    adminBootstrapToken: env.NEXUS_ADMIN_BOOTSTRAP_TOKEN?.trim() ?? '',
  };
}

export interface AuthTokenRecord {
  id: string;
  name: string;
  role: AuthRole;
  tenantId: string;
  scopes: string[];
  tokenHash: string;
  tokenPrefix: string;
  tokenVersion: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export type AuthIdentity = Omit<AuthTokenRecord, 'tokenHash'> & {
  tokenId: string;
};

export interface AuthSuccess {
  ok: true;
  identity: AuthIdentity;
  tenantContext: TenantContext;
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403;
  code: 'Unauthorized' | 'Forbidden';
  error: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

export interface CreateAuthTokenInput {
  name: string;
  role: AuthRole;
  tenantId: string;
  scopes?: string[];
  expiresAt?: string | null;
  now?: string;
  createId?(): string;
  createRawToken?(): string;
}

export async function createAuthToken(input: CreateAuthTokenInput): Promise<{ record: AuthTokenRecord; token: string }> {
  const token = input.createRawToken?.() ?? `nexus_${randomBytes(24).toString('base64url')}`;
  const now = input.now ?? new Date().toISOString();
  const tenantId = input.role === 'admin' ? safeTenantId(input.tenantId || 'default') : safeTenantId(input.tenantId);
  const record: AuthTokenRecord = {
    id: input.createId?.() ?? `token_${Date.now()}_${randomBytes(4).toString('hex')}`,
    name: input.name.trim() || tenantId,
    role: input.role,
    tenantId,
    scopes: normalizeScopes(input.scopes),
    tokenHash: await hashToken(token),
    tokenPrefix: token.slice(0, 8),
    tokenVersion: 1,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
  };
  return { record, token };
}

export async function hashToken(token: string): Promise<string> {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function verifyLoginToken(
  token: string,
  records: AuthTokenRecord[],
  now = new Date().toISOString(),
): Promise<AuthTokenRecord | null> {
  const hash = await hashToken(token.trim());
  return records.find((record) => tokenRecordUsable(record, now) && constantEqual(record.tokenHash, hash)) ?? null;
}

export async function createJwtForToken(
  record: AuthTokenRecord,
  jwtSecret: string,
  now = new Date().toISOString(),
  ttlSeconds = 12 * 60 * 60,
): Promise<string> {
  const issuedAt = Math.floor(new Date(now).getTime() / 1000);
  const payload = {
    sub: record.id,
    role: record.role,
    tenantId: record.tenantId,
    scopes: record.scopes,
    tokenVersion: record.tokenVersion,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  return signJwt(payload, jwtSecret);
}

export async function verifyJwt(
  jwt: string,
  records: AuthTokenRecord[],
  jwtSecret: string,
  now = new Date().toISOString(),
): Promise<AuthIdentity | null> {
  const payload = verifySignedJwt(jwt, jwtSecret);
  if (!payload) return null;
  const nowSeconds = Math.floor(new Date(now).getTime() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  const tokenId = typeof payload.sub === 'string' ? payload.sub : '';
  const record = records.find((candidate) => candidate.id === tokenId);
  if (!record || !tokenRecordUsable(record, now)) return null;
  if (record.tokenVersion !== payload.tokenVersion) return null;
  if (record.role !== payload.role || record.tenantId !== payload.tenantId) return null;
  return toIdentity(record);
}

export async function authenticateRequest(options: {
  headers: IncomingHttpHeaders;
  records: AuthTokenRecord[];
  jwtSecret: string;
  now?: string;
  storageMode: StorageMode;
  authMode: AuthMode;
  accessToken?: string | null;
}): Promise<AuthResult> {
  const rawTenant = headerValue(options.headers['x-nexus-tenant-id']);
  if (options.authMode === 'off') {
    const tenantId = safeTenantId(rawTenant);
    return {
      ok: true,
      tenantContext: { tenantId },
      identity: {
        tokenId: 'anonymous',
        id: 'anonymous',
        name: 'anonymous',
        role: 'tenant',
        tenantId,
        scopes: ['*'],
        tokenPrefix: '',
        tokenVersion: 0,
        enabled: true,
        createdAt: '',
        updatedAt: '',
        expiresAt: null,
        lastUsedAt: null,
      },
    };
  }

  const jwt = bearerToken(options.headers.authorization) || headerValue(options.headers['x-nexus-auth-token']) || options.accessToken?.trim() || '';
  if (!jwt) return authFailure(401, 'Unauthorized', 'Authentication token is required');
  const identity = await verifyJwt(jwt, options.records, options.jwtSecret, options.now);
  if (!identity) return authFailure(401, 'Unauthorized', 'Authentication token is invalid or expired');
  if (rawTenant && safeTenantId(rawTenant) !== identity.tenantId) {
    return authFailure(403, 'Forbidden', 'Tenant header does not match authenticated token');
  }
  return { ok: true, identity, tenantContext: { tenantId: identity.tenantId } };
}

export function listPublicAuthTokens(records: AuthTokenRecord[]): Array<Omit<AuthTokenRecord, 'tokenHash'>> {
  return records.map(({ tokenHash: _tokenHash, ...record }) => record);
}

export function tokenRecordUsable(record: AuthTokenRecord, now = new Date().toISOString()): boolean {
  if (!record.enabled) return false;
  if (record.expiresAt && record.expiresAt <= now) return false;
  return true;
}

export function toIdentity(record: AuthTokenRecord): AuthIdentity {
  const { tokenHash: _tokenHash, ...publicRecord } = record;
  return { ...publicRecord, tokenId: record.id };
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifySignedJwt(jwt: string, secret: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!constantEqual(signature, hmac(`${encodedHeader}.${encodedPayload}`, secret))) return null;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== 'HS256') return null;
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function constantEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const values = (scopes && scopes.length > 0 ? scopes : ['*'])
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set(values.length ? values : ['*'])];
}

function bearerToken(value: string | string[] | undefined): string {
  const raw = headerValue(value);
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() ?? '';
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}

function authFailure(status: 401 | 403, code: 'Unauthorized' | 'Forbidden', error: string): AuthFailure {
  return { ok: false, status, code, error };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
