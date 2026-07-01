import { describe, expect, it } from 'vitest';
import { resolveAuthConfig } from './auth.js';

describe('auth config', () => {
  it('keeps single-user mode unauthenticated by default', () => {
    expect(resolveAuthConfig('single', {})).toMatchObject({ mode: 'off' });
  });

  it('enables token auth by default in multi-tenant mode and requires a JWT secret', () => {
    expect(() => resolveAuthConfig('multi', {})).toThrow(/NEXUS_JWT_SECRET/);
    expect(resolveAuthConfig('multi', {
      NEXUS_JWT_SECRET: 'secret',
      NEXUS_ADMIN_BOOTSTRAP_TOKEN: 'bootstrap',
    })).toMatchObject({
      mode: 'token',
      jwtSecret: 'secret',
      adminBootstrapToken: 'bootstrap',
    });
  });

  it('allows explicit auth off for local tests and private deployments', () => {
    expect(resolveAuthConfig('multi', { NEXUS_AUTH_MODE: 'off' })).toMatchObject({ mode: 'off' });
  });
});
