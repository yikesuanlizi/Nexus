export const DEFAULT_TENANT_ID = 'default';

export interface TenantContext {
  tenantId: string;
}

export function parseTenantContext(_source?: unknown): TenantContext {
  return { tenantId: DEFAULT_TENANT_ID };
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
