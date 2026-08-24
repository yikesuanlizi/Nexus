import { describe, expect, it } from 'vitest';
import { SECRET_REDACTION_VERSION, SecretRedactor, redactSecrets } from './secretRedactor.js';

describe('SecretRedactor', () => {
  it('redacts common API keys, bearer tokens, private keys and assignments', () => {
    const redactor = new SecretRedactor();
    const privateKey = [
      '-----BEGIN PRIVATE KEY-----',
      'super-private-material',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const source = [
      'Authorization: Bearer eyJlong-bearer-token-value_1234567890',
      'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnop',
      'github token: ghp_123456789012345678901234567890',
      privateKey,
      'password: "correct horse battery staple"',
      'refresh_token=refresh-token-123456789',
    ].join('\n');

    const result = redactor.redact(source, {
      taskId: 'task-1',
      runId: 'run-1',
      observedAt: '2026-08-19T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('redacted');
    expect(result.redactedContent).not.toContain('eyJlong-bearer-token-value_1234567890');
    expect(result.redactedContent).not.toContain('sk-proj-1234567890abcdefghijklmnop');
    expect(result.redactedContent).not.toContain('ghp_123456789012345678901234567890');
    expect(result.redactedContent).not.toContain('super-private-material');
    expect(result.redactedContent).not.toContain('correct horse battery staple');
    expect(result.redactedContent).toContain('Authorization: Bearer [REDACTED]');
    expect(result.metadata.detectorVersion).toBe(SECRET_REDACTION_VERSION);
    expect(result.metadata.rulesApplied.bearer_token).toBe(1);
    expect(result.metadata.rulesApplied.api_key).toBe(3);
    expect(result.metadata.rulesApplied.private_key).toBe(1);
    expect(result.metadata.rulesApplied.password).toBe(1);
    expect(result.metadata.matchCount).toBe(6);
  });

  it('redacts credentials in supported connection strings without hiding the host', () => {
    const result = redactSecrets(
      'DATABASE_URL=postgresql://app:db-password-123@db.internal:5432/app\nredis://cache:redis-secret-456@cache.internal',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redactedContent).toContain('postgresql://app:[REDACTED]@db.internal:5432/app');
    expect(result.redactedContent).toContain('redis://cache:[REDACTED]@cache.internal');
    expect(result.redactedContent).toContain('DATABASE_URL=');
    expect(result.redactedContent).not.toContain('db-password-123');
    expect(result.redactedContent).not.toContain('redis-secret-456');
    expect(result.metadata.rulesApplied.connection_string).toBe(2);
  });

  it('leaves ordinary text unchanged and reports stable metadata', () => {
    const result = redactSecrets('The service is healthy and listening on port 8080.', {
      detectorVersion: 'fixture-rules-v2',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'unchanged',
      redactedContent: 'The service is healthy and listening on port 8080.',
      metadata: {
        detectorVersion: 'fixture-rules-v2',
        matchCount: 0,
        rulesApplied: {},
      },
    });
  });

  it('returns an EvidenceAttempt and no content when input exceeds the safety limit', () => {
    const result = new SecretRedactor({ maxInputBytes: 8 }).redact('secret content', {
      taskId: 'task-2',
      runId: 'run-2',
      attemptId: 'attempt-2',
      observedAt: '2026-08-19T01:02:03.000Z',
      source: { adapterId: 'ssh', hostId: 'host-1', service: 'api' },
    });

    expect(result).toEqual({
      ok: false,
      status: 'redaction_failed',
      reasonCode: 'INPUT_TOO_LARGE',
      metadata: {
        detectorVersion: SECRET_REDACTION_VERSION,
        inputBytes: 14,
        matchCount: 0,
        rulesApplied: {},
      },
      attempt: {
        attemptId: 'attempt-2',
        taskId: 'task-2',
        runId: 'run-2',
        source: { adapterId: 'ssh', hostId: 'host-1', service: 'api' },
        status: 'redaction_failed',
        detectorVersion: SECRET_REDACTION_VERSION,
        reasonCode: 'INPUT_TOO_LARGE',
        observedAt: '2026-08-19T01:02:03.000Z',
      },
    });
    expect('secret content' in result).toBe(false);
  });

  it('rejects non-string adapter output without persisting the value', () => {
    const result = redactSecrets({ password: 'never-return-this' }, {}, { attemptId: 'attempt-3' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('INPUT_NOT_STRING');
    expect(result.attempt.attemptId).toBe('attempt-3');
    expect(JSON.stringify(result)).not.toContain('never-return-this');
  });
});
