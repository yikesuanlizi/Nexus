import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CorsOptions {
  authEnabled: boolean;
  origins: string[];
}

const ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-CSRF-Token',
  'x-nexus-tenant-id',
  'x-nexus-auth-token',
  'x-nexus-admin-token',
  'x-nexus-admin-bootstrap-token',
].join(', ');

export function resolveCorsOptions(
  env: Record<string, string | undefined> = process.env,
  authEnabled = false,
): CorsOptions {
  const origins = (env.NEXUS_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return { authEnabled, origins };
}

export function corsHeadersForOrigin(origin: string | undefined, options: CorsOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    Vary: 'Origin',
  };
  if (!options.authEnabled && options.origins.length === 0) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  if (origin && options.origins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, options: CorsOptions): boolean {
  const origin = headerValue(req.headers.origin);
  const headers = corsHeadersForOrigin(origin, options);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  return !options.authEnabled || !origin || options.origins.includes(origin);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}
