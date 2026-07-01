import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { handleDeploymentRoute } from './deploymentRoute.js';
import { DEPLOYMENT_MODE_KEY } from '../config/deployment.js';
import { AUTH_TOKENS_KEY } from '../auth/auth.js';
import type { ThreadStore } from '@nexus/storage';

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';

  writeHead(status: number, headers: Record<string, string>) {
    this.statusCode = status;
    this.headers = headers;
  }

  end(body = '') {
    this.body = String(body);
    this.emit('finish');
  }
}

function request(method: string, body: unknown = {}) {
  const req = new EventEmitter() as EventEmitter & AsyncIterable<Buffer> & { method: string };
  req.method = method;
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify(body), 'utf8');
  };
  return req;
}

function store() {
  const settings = new Map<string, unknown>();
  const threadStore = {
    tenantId: 'default',
    async getSetting<T>(key: string) { return (settings.get(key) as T | undefined) ?? null; },
    async setSetting(key: string, value: unknown) { settings.set(key, value); },
  } as ThreadStore;
  return { threadStore, settings };
}

describe('deployment setup route', () => {
  it('initializes multi mode and returns a first admin token and jwt once', async () => {
    const { threadStore, settings } = store();
    const res = new MockResponse();

    const handled = await handleDeploymentRoute({
      req: request('POST', { mode: 'multi', jwtSecret: 'user-entered-secret' }) as never,
      res: res as never,
      pathname: '/api/setup/deployment',
      store: threadStore,
      storageMode: 'single',
      env: {},
      now: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'token_admin',
      createRawToken: () => 'nexus_initial_admin',
    });

    const body = JSON.parse(res.body) as { adminToken?: string; jwt?: string; deploymentMode?: string; authMode?: string };
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ deploymentMode: 'multi', authMode: 'token', adminToken: 'nexus_initial_admin' });
    expect(body.jwt).toBeTruthy();
    expect(settings.get(DEPLOYMENT_MODE_KEY)).toMatchObject({ mode: 'multi', jwtSecret: 'user-entered-secret' });
    expect(settings.get(AUTH_TOKENS_KEY)).toMatchObject({ tokens: [expect.objectContaining({ id: 'token_admin', role: 'admin' })] });
  });

  it('rejects setup when initialization already exists', async () => {
    const { threadStore, settings } = store();
    settings.set(DEPLOYMENT_MODE_KEY, { mode: 'single', initializedAt: '2026-01-01T00:00:00.000Z' });
    const res = new MockResponse();

    await handleDeploymentRoute({
      req: request('POST', { mode: 'multi' }) as never,
      res: res as never,
      pathname: '/api/setup/deployment',
      store: threadStore,
      storageMode: 'single',
      env: { NEXUS_JWT_SECRET: 'secret' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('does not persist multi setup when jwt secret is missing from the setup request', async () => {
    const { threadStore, settings } = store();
    const res = new MockResponse();

    await handleDeploymentRoute({
      req: request('POST', { mode: 'multi' }) as never,
      res: res as never,
      pathname: '/api/setup/deployment',
      store: threadStore,
      storageMode: 'single',
      env: { NEXUS_JWT_SECRET: 'env-secret' },
    });

    expect(res.statusCode).toBe(400);
    expect(settings.get(DEPLOYMENT_MODE_KEY)).toBeUndefined();
  });
});
