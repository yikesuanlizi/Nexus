import { describe, expect, it } from 'vitest';
import { redactSshDiagnostics, sanitizeSshProfileInput, sanitizeSshSessionConnection } from './sshProfile.js';

describe('SSH profile contract', () => {
  it('keeps only credential references and rejects secret values', () => {
    expect(() => sanitizeSshProfileInput({
      profileId: 'prod', name: 'Production', host: 'example.test', port: 22, user: 'ops',
      password: 'never-store', auth: { method: 'credential_store', credentialRef: 'windows:ops/prod' },
    })).toThrow();
    const profile = sanitizeSshProfileInput({
      profileId: 'prod', name: 'Production', host: 'example.test', port: 22, user: 'ops',
      auth: { method: 'credential_store', credentialRef: 'windows:ops/prod' },
    });
    expect(profile.auth.credentialRef).toBe('windows:ops/prod');
    expect(JSON.stringify(profile)).not.toContain('never-store');
  });

  it('redacts secret-shaped diagnostic text', () => {
    const result = redactSshDiagnostics({
      ok: false, status: 'failed', host: 'example.test', port: 22, user: 'ops',
      authMethod: 'password', message: 'password=top-secret',
    });
    expect(result.message).toContain('[redacted]');
    expect(result.message).not.toContain('top-secret');
  });

  it('keeps temporary connections session-only', () => {
    const connection = sanitizeSshSessionConnection({
      name: 'temporary', host: 'localhost', port: 22, user: 'ops',
      auth: { method: 'agent' },
    });
    expect(connection.sessionOnly).toBe(true);
    expect(connection).not.toHaveProperty('profileId');
  });
});
