import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StorageMode, ThreadStore } from '@nexus/storage';
import {
  createAuthToken,
  createJwtForToken,
  listPublicAuthTokens,
  resolveAuthConfig,
  type AuthTokenRecord,
} from '../auth/auth.js';
import {
  readDeploymentModeSetting,
  resolveDeploymentConfig,
  writeDeploymentModeSetting,
  type DeploymentMode,
} from '../config/deployment.js';
import { readAuthTokenRecords, writeAuthTokenRecords } from './authRoute.js';
import { readJson, sendError, sendJson } from '../shared/http.js';

// 处理部署初始化 — Chinese: handle deployment initialization
export async function handleDeploymentRoute(options: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  store: ThreadStore;
  storageMode: StorageMode;
  env?: Record<string, string | undefined>;
  now?(): string;
  createId?(): string;
  createRawToken?(): string;
}): Promise<boolean> {
  const { req, res, pathname, store, storageMode } = options;
  // 仅接受 POST /api/setup/deployment
  // — Chinese: only accept POST /api/setup/deployment
  if (req.method !== 'POST' || pathname !== '/api/setup/deployment') return false;

  // 重复初始化冲突
  // — Chinese: already initialized; reject with 409
  if (await readDeploymentModeSetting(store)) {
    sendError(res, 409, 'Deployment mode has already been initialized');
    return true;
  }

  const body = await readJson<{ mode?: string; jwtSecret?: string }>(req);
  const mode = parseDeploymentMode(body.mode);
  if (!mode) {
    sendError(res, 400, 'mode must be single or multi');
    return true;
  }

  const now = options.now?.() ?? new Date().toISOString();
  const jwtSecret = body.jwtSecret?.trim() ?? '';
  // 多租户模式：jwtSecret 必须至少 16 个字符，并在使用时通过 resolveAuthConfig 校验
  // — Chinese: multi-tenant: jwtSecret must be at least 16 chars
  if (mode === 'multi') {
    if (jwtSecret.length < 16) {
      sendError(res, 400, 'jwtSecret must be at least 16 characters');
      return true;
    }
    try {
      resolveAuthConfig('multi', { ...options.env, NEXUS_AUTH_MODE: 'token', NEXUS_JWT_SECRET: jwtSecret });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : String(error));
      return true;
    }
  }
  // 写入部署模式（以及可选的 JWT 密钥）
  // — Chinese: write deployment mode with optional JWT secret
  await writeDeploymentModeSetting(store, mode, now, mode === 'multi' ? jwtSecret : undefined);

  const deployment = await resolveDeploymentConfig(store, storageMode, options.env);
  // 若为多租户，创建初始管理员令牌和对应的 JWT
  // — Chinese: for multi-tenant, create initial admin token and JWT
  let createdAdmin: { record: AuthTokenRecord; token: string } | null = null;
  let jwt = '';
  if (mode === 'multi') {
    createdAdmin = await createAuthToken({
      name: 'Initial administrator',
      role: 'admin',
      tenantId: 'default',
      scopes: ['*'],
      now,
      createId: options.createId,
      createRawToken: options.createRawToken,
    });
    const records = await readAuthTokenRecords(store);
    await writeAuthTokenRecords(store, [createdAdmin.record, ...records]);
    jwt = await createJwtForToken(
      createdAdmin.record,
      deployment.authConfig.jwtSecret,
      now,
      deployment.authConfig.jwtTtlSeconds,
    );
  }

  sendJson(res, 200, {
    ok: true,
    initialized: true,
    deploymentMode: deployment.deploymentMode,
    source: deployment.source,
    authMode: deployment.authMode,
    adminToken: createdAdmin?.token,
    adminRecord: createdAdmin ? listPublicAuthTokens([createdAdmin.record])[0] : undefined,
    jwt: jwt || undefined,
  });
  return true;
}

// 解析部署模式字符串：single 或 multi（兼容 multi_tenant / multitenant）
// — Chinese: parse deployment mode string: single or multi (multi_tenant / multitenant also accepted)
function parseDeploymentMode(value: string | undefined): DeploymentMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'single') return 'single';
  if (normalized === 'multi' || normalized === 'multi_tenant' || normalized === 'multitenant') return 'multi';
  return null;
}
