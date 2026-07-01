import { describe, expect, it } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import { tenantEventKey, parseTenantContext, scopedSettingKey } from './tenant.js';

describe('TenantContext', () => {
  it('defaults to the local default tenant when the header is absent', () => {
    expect(parseTenantContext({} as IncomingHttpHeaders)).toEqual({ tenantId: 'default' });
  });

  it('accepts safe tenant ids and rejects path-like values', () => {
    expect(parseTenantContext({ 'x-nexus-tenant-id': 'team_A-1' })).toEqual({ tenantId: 'team_A-1' });
    expect(() => parseTenantContext({ 'x-nexus-tenant-id': '../other' })).toThrow(/Invalid tenant id/);
    expect(() => parseTenantContext({ 'x-nexus-tenant-id': 'team/a' })).toThrow(/Invalid tenant id/);
  });

  it('builds tenant-scoped setting keys and event keys without exposing other tenants', () => {
    expect(scopedSettingKey('tenantA', 'runConfig.default')).toBe('tenant:tenantA:runConfig.default');
    expect(scopedSettingKey('default', 'storage.schemaVersion')).toBe('storage.schemaVersion');
    expect(scopedSettingKey('tenantA', 'auth.tokens.v1')).toBe('auth.tokens.v1');
    expect(tenantEventKey('tenantA', 'thread-1')).toBe('tenantA:thread-1');
  });
});
