import { describe, expect, it } from 'vitest';
import {
  AUTH_TOKENS_KEY,
  authenticateRequest,
  createAuthToken,
  createJwtForToken,
  hashToken,
  listPublicAuthTokens,
  verifyLoginToken,
  verifyJwt,
  type AuthTokenRecord,
} from './auth.js';

describe('token auth', () => {
  it('logs in with a raw token and returns a JWT-bound tenant identity', async () => {
    const now = '2026-06-17T00:00:00.000Z';
    const record = await createAuthToken({
      name: 'tenant A',
      role: 'tenant',
      tenantId: 'tenantA',
      scopes: ['threads:write'],
      now,
      createId: () => 'token_1',
      createRawToken: () => 'nexus_tenant_secret',
    });

    const login = await verifyLoginToken('nexus_tenant_secret', [record.record], now);
    expect(login?.tenantId).toBe('tenantA');
    expect(login?.role).toBe('tenant');

    const jwt = await createJwtForToken(login!, 'jwt_secret', now, 60);
    const identity = await verifyJwt(jwt, [record.record], 'jwt_secret', now);

    expect(identity).toMatchObject({
      tokenId: 'token_1',
      tenantId: 'tenantA',
      role: 'tenant',
      scopes: ['threads:write'],
    });
  });

  it('rejects disabled tokens and old JWTs after token rotation', async () => {
    const now = '2026-06-17T00:00:00.000Z';
    const record: AuthTokenRecord = {
      id: 'token_1',
      name: 'tenant A',
      role: 'tenant',
      tenantId: 'tenantA',
      scopes: ['threads:write'],
      tokenHash: await hashToken('raw-token'),
      tokenPrefix: 'raw-',
      tokenVersion: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      lastUsedAt: null,
    };
    const jwt = await createJwtForToken(record, 'jwt_secret', now, 60);

    await expect(verifyJwt(jwt, [{ ...record, tokenVersion: 2 }], 'jwt_secret', now)).resolves.toBeNull();
    await expect(verifyLoginToken('raw-token', [{ ...record, enabled: false }], now)).resolves.toBeNull();
  });

  it('uses JWT tenant as source of truth and rejects mismatched tenant headers', async () => {
    const now = '2026-06-17T00:00:00.000Z';
    const record = (await createAuthToken({
      name: 'tenant A',
      role: 'tenant',
      tenantId: 'tenantA',
      scopes: ['*'],
      now,
      createId: () => 'token_1',
      createRawToken: () => 'nexus_tenant_secret',
    })).record;
    const jwt = await createJwtForToken(record, 'jwt_secret', now, 60);

    const ok = await authenticateRequest({
      headers: { authorization: `Bearer ${jwt}`, 'x-nexus-tenant-id': 'tenantA' },
      records: [record],
      jwtSecret: 'jwt_secret',
      now,
      storageMode: 'multi',
      authMode: 'token',
    });
    expect(ok.ok).toBe(true);
    expect(ok.ok ? ok.tenantContext.tenantId : '').toBe('tenantA');

    const mismatch = await authenticateRequest({
      headers: { authorization: `Bearer ${jwt}`, 'x-nexus-tenant-id': 'tenantB' },
      records: [record],
      jwtSecret: 'jwt_secret',
      now,
      storageMode: 'multi',
      authMode: 'token',
    });
    expect(mismatch).toMatchObject({ ok: false, status: 403 });
  });

  it('accepts access_token query values for EventSource authentication', async () => {
    const now = '2026-06-17T00:00:00.000Z';
    const record = (await createAuthToken({
      name: 'tenant A',
      role: 'tenant',
      tenantId: 'tenantA',
      now,
      createId: () => 'token_1',
      createRawToken: () => 'raw-token',
    })).record;
    const jwt = await createJwtForToken(record, 'jwt_secret', now, 60);

    const result = await authenticateRequest({
      headers: {},
      accessToken: jwt,
      records: [record],
      jwtSecret: 'jwt_secret',
      now,
      storageMode: 'multi',
      authMode: 'token',
    });

    expect(result.ok ? result.tenantContext.tenantId : '').toBe('tenantA');
  });

  it('redacts token hashes from admin token list', async () => {
    const record = (await createAuthToken({
      name: 'admin',
      role: 'admin',
      tenantId: 'default',
      scopes: ['*'],
      now: '2026-06-17T00:00:00.000Z',
      createId: () => 'admin_1',
      createRawToken: () => 'nexus_admin_secret',
    })).record;

    expect(AUTH_TOKENS_KEY).toBe('auth.tokens.v1');
    expect(listPublicAuthTokens([record])[0]).toEqual(expect.not.objectContaining({ tokenHash: expect.any(String) }));
    expect(listPublicAuthTokens([record])[0]).toMatchObject({
      id: 'admin_1',
      role: 'admin',
      tenantId: 'default',
      tokenPrefix: 'nexus_ad',
    });
  });
});
