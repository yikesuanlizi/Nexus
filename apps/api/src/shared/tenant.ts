import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const DEFAULT_TENANT_ID = 'default';
const TENANT_HEADER = 'x-nexus-tenant-id';

export interface TenantContext {
  tenantId: string;
}

export function parseTenantContext(source: IncomingMessage | IncomingHttpHeaders): TenantContext {
  const maybeRequest = source as Partial<IncomingMessage>;
  const headers: IncomingHttpHeaders = maybeRequest.headers && typeof maybeRequest.headers === 'object'
    ? maybeRequest.headers
    : source as IncomingHttpHeaders;
  const raw = headers[TENANT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const tenantId = safeTenantId(value);
  return { tenantId };
}

export function safeTenantId(value: string | undefined | null): string {
  const tenantId = value?.trim() || DEFAULT_TENANT_ID;
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${value ?? ''}`);
  }
  return tenantId;
}

export function tenantEventKey(tenantId: string, threadId: string): string {
  return `${safeTenantId(tenantId)}:${threadId}`;
}

export function scopedSettingKey(tenantId: string, key: string): string {
  if (key === 'storage.schemaVersion' || key === 'auth.tokens.v1') return key;
  return `tenant:${safeTenantId(tenantId)}:${key}`;
}
