import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CorsOptions } from '../shared/cors.js';
import { applyCorsHeaders } from '../shared/cors.js';
import { sendError, sendJson } from '../shared/http.js';
import { DEFAULT_TENANT_ID, type TenantContext } from '../shared/tenant.js';

/** 本地单用户请求入口。default 仅兼容历史 SQLite 表结构，不是可选择的租户。 */
export interface RequestGateResult {
  handled: boolean;
  tenantContext: TenantContext;
  authIdentity: null;
}

export function handleRequestGate(options: {
  req: IncomingMessage;
  res: ServerResponse;
  corsOptions: CorsOptions;
}): RequestGateResult {
  const corsAllowed = applyCorsHeaders(options.req, options.res, options.corsOptions);
  if (options.req.method === 'OPTIONS') {
    if (!corsAllowed) sendError(options.res, 403, 'Origin is not allowed');
    else sendJson(options.res, 204, {});
    return handled();
  }
  if (!corsAllowed) {
    sendError(options.res, 403, 'Origin is not allowed');
    return handled();
  }
  return { handled: false, tenantContext: { tenantId: DEFAULT_TENANT_ID }, authIdentity: null };
}

function handled(): RequestGateResult {
  return { handled: true, tenantContext: { tenantId: DEFAULT_TENANT_ID }, authIdentity: null };
}
