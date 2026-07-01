import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ThreadStore } from '@nexus/storage';
import { AUTH_TOKENS_KEY, verifyJwt, type AuthIdentity } from '../auth/auth.js';
import { handleAuthRoute, readAuthTokenRecords } from './authRoute.js';

class AuthRouteStore implements Partial<ThreadStore> {
  settings = new Map<string, unknown>();

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T | undefined) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }
}

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  return Object.assign(Readable.from(chunks), { method, url: path, headers }) as IncomingMessage;
}

function res(): ServerResponse & { status?: number; body?: unknown } {
  const output = {
    writeHead(status: number) {
      output.status = status;
      return output;
    },
    setHeader() {
      return output;
    },
    end(raw: string) {
      output.body = raw ? JSON.parse(raw) : undefined;
    },
  } as unknown as ServerResponse & { status?: number; body?: unknown };
  return output;
}

function routePath(path: string) {
  const url = new URL(path, 'http://localhost');
  return { url, segments: url.pathname.split('/').filter(Boolean) };
}

const authConfig = {
  mode: 'token' as const,
  jwtSecret: 'jwt_secret',
  jwtTtlSeconds: 600,
  adminBootstrapToken: 'bootstrap-admin',
};

const adminIdentity: AuthIdentity = {
  tokenId: 'admin_1',
  id: 'admin_1',
  name: 'admin',
  role: 'admin',
  tenantId: 'default',
  scopes: ['*'],
  tokenPrefix: 'admin',
  tokenVersion: 1,
  enabled: true,
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
};

describe('auth route', () => {
  it('creates tenant tokens through the admin bootstrap token and logs in with the raw token', async () => {
    const store = new AuthRouteStore();
    const createRes = res();
    const path = routePath('/api/admin/tokens');

    await handleAuthRoute({
      req: req('POST', path.url.pathname, {
        name: 'Tenant A',
        role: 'tenant',
        tenantId: 'tenantA',
        scopes: ['threads:write'],
      }, { 'x-nexus-admin-bootstrap-token': 'bootstrap-admin' }),
      res: createRes,
      url: path.url,
      segments: path.segments,
      store: store as unknown as ThreadStore,
      authConfig,
      now: () => '2026-06-17T00:00:00.000Z',
      createId: () => 'token_tenant_a',
      createRawToken: () => 'nexus_tenant_a_raw',
    });

    expect(createRes.status).toBe(200);
    expect(createRes.body).toMatchObject({
      ok: true,
      token: 'nexus_tenant_a_raw',
      record: {
        id: 'token_tenant_a',
        role: 'tenant',
        tenantId: 'tenantA',
        tokenPrefix: 'nexus_te',
      },
    });
    expect(createRes.body).not.toEqual(expect.objectContaining({ tokenHash: expect.any(String) }));

    const loginRes = res();
    const loginPath = routePath('/api/auth/login');
    await handleAuthRoute({
      req: req('POST', loginPath.url.pathname, { token: 'nexus_tenant_a_raw' }),
      res: loginRes,
      url: loginPath.url,
      segments: loginPath.segments,
      store: store as unknown as ThreadStore,
      authConfig,
      now: () => '2026-06-17T00:00:00.000Z',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toMatchObject({ ok: true, identity: { tenantId: 'tenantA', role: 'tenant' } });
    const records = await readAuthTokenRecords(store as unknown as ThreadStore);
    await expect(verifyJwt(String((loginRes.body as { jwt: string }).jwt), records, 'jwt_secret', '2026-06-17T00:00:01.000Z')).resolves.toMatchObject({
      tenantId: 'tenantA',
    });
  });

  it('requires admin identity for token list management after bootstrap', async () => {
    const store = new AuthRouteStore();
    const records = [{
      ...adminIdentity,
      tokenHash: 'hash',
      lastUsedAt: null,
    }];
    await store.setSetting(AUTH_TOKENS_KEY, records);
    const path = routePath('/api/admin/tokens');
    const listRes = res();

    await handleAuthRoute({
      req: req('GET', path.url.pathname),
      res: listRes,
      url: path.url,
      segments: path.segments,
      store: store as unknown as ThreadStore,
      authConfig,
      identity: { ...adminIdentity, role: 'tenant', tenantId: 'tenantA' },
    });

    expect(listRes.status).toBe(403);
    expect(listRes.body).toEqual({ error: 'Admin token is required' });

    const adminRes = res();
    await handleAuthRoute({
      req: req('GET', path.url.pathname),
      res: adminRes,
      url: path.url,
      segments: path.segments,
      store: store as unknown as ThreadStore,
      authConfig,
      identity: adminIdentity,
    });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body).toMatchObject({ tokens: [expect.objectContaining({ id: 'admin_1' })] });
  });
});
