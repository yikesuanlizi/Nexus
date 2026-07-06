import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadStore, StorageOptions } from '@nexus/storage';
import { authenticateRequest, type AuthConfig, type AuthIdentity } from '../auth/auth.js';
import { applyCorsHeaders, type CorsOptions } from '../shared/cors.js';
import { sendError, sendJson } from '../shared/http.js';
import { DEFAULT_TENANT_ID, parseTenantContext, type TenantContext } from '../shared/tenant.js';
import { handleAuthRoute, readAuthTokenRecords } from './authRoute.js';

// 请求网关结果（handled=true 表示路由已完成响应；否则返回租户与认证身份）
// — Chinese: request gate result (handled=true means route is done; otherwise return tenant + auth identity)
export interface RequestGateResult {
  handled: boolean;
  tenantContext: TenantContext;
  authIdentity: AuthIdentity | null;
}

// 处理请求入口：CORS、登录、令牌认证、租户隔离
// — Chinese: handle request gate: CORS, login, token auth, tenant isolation
export async function handleRequestGate(options: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  segments: string[];
  rootStore: ThreadStore;
  storageOptions: StorageOptions;
  authConfig: AuthConfig;
  corsOptions: CorsOptions;
}): Promise<RequestGateResult> {
  const { req, res, url, segments, rootStore, storageOptions, authConfig } = options;
  const corsAllowed = applyCorsHeaders(req, res, options.corsOptions);
  // OPTIONS 预检请求 — Chinese: OPTIONS preflight
  if (req.method === 'OPTIONS') {
    if (!corsAllowed) sendError(res, 403, 'Origin is not allowed');
    else sendJson(res, 204, {});
    return handled();
  }
  if (!corsAllowed) {
    sendError(res, 403, 'Origin is not allowed');
    return handled();
  }
  // /api/auth/login 绕过令牌认证 — Chinese: /api/auth/login bypasses token auth
  if (segments[0] === 'api' && segments[1] === 'auth' && segments[2] === 'login') {
    await handleAuthRoute({ req, res, url, segments, store: rootStore, authConfig });
    return handled();
  }

  // /.well-known/agent-card.json 绕过认证（A2A 规范要求 Agent Card 公开可访问）
  // — Chinese: agent card discovery bypasses auth (required by A2A spec)
  if (url.pathname === '/.well-known/agent-card.json') {
    return { handled: false, tenantContext: parseTenantContext(req), authIdentity: null };
  }

  let tenantContext: TenantContext;
  let authIdentity: AuthIdentity | null = null;
  try {
    // token 模式：按 Bearer / 查询参数认证；失败时若目标为管理员令牌路由则返回默认租户（以允许初始管理员令牌创建）
    // — Chinese: token mode: authenticate by Bearer / query param; fall back to default tenant only for admin tokens route
    if (authConfig.mode === 'token') {
      const auth = await authenticateRequest({
        headers: req.headers,
        records: await readAuthTokenRecords(rootStore),
        jwtSecret: authConfig.jwtSecret,
        storageMode: storageOptions.mode,
        authMode: authConfig.mode,
        accessToken: url.searchParams.get('access_token'),
      });
      if (!auth.ok) {
        if (isAdminTokenRoute(segments)) tenantContext = { tenantId: DEFAULT_TENANT_ID };
        else {
          sendError(res, auth.status, auth.error);
          return handled();
        }
      } else {
        authIdentity = auth.identity;
        tenantContext = auth.tenantContext;
      }
    } else {
      // off 模式：仅解析租户上下文（若无则使用默认）
      // — Chinese: off mode: just parse tenant context (default if missing)
      tenantContext = parseTenantContext(req);
    }
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error));
    return handled();
  }
  // bot 角色仅限 /api/bot 和 /api/a2a 路由 — Chinese: bot role is restricted to /api/bot and /api/a2a routes
  if (authIdentity?.role === 'bot' && !(segments[0] === 'api' && (segments[1] === 'bot' || segments[1] === 'a2a'))) {
    sendError(res, 403, 'Bot tokens can only access bot and a2a routes');
    return handled();
  }
  // 其余认证相关路由（如 /api/auth/*、/api/admin/*）
  // — Chinese: other auth-related routes like /api/auth/* and /api/admin/*
  if (await handleAuthRoute({ req, res, url, segments, store: rootStore, authConfig, identity: authIdentity })) {
    return handled();
  }
  return { handled: false, tenantContext, authIdentity };
}

// 返回已处理的网关结果（默认租户、空身份）
// — Chinese: return handled gate result with default tenant + empty identity
function handled(): RequestGateResult {
  return { handled: true, tenantContext: { tenantId: DEFAULT_TENANT_ID }, authIdentity: null };
}

// 判断目标是否为管理员令牌路由（/api/admin/tokens）
// — Chinese: match admin tokens route
function isAdminTokenRoute(segments: string[]): boolean {
  return segments[0] === 'api' && segments[1] === 'admin' && segments[2] === 'tokens';
}
