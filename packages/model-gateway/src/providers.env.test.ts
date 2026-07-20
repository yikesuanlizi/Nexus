import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOsState = vi.hoisted(() => ({ homeDir: '' }));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => mockOsState.homeDir,
  };
});

describe('provider API key environment variables', () => {
  const envName = 'NEXUS_TEST_OPENAI_API_KEY';

  beforeEach(() => {
    mockOsState.homeDir = mkdtempSync(join(tmpdir(), 'nexus-model-gateway-'));
    delete process.env[envName];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env[envName];
    if (mockOsState.homeDir) {
      rmSync(mockOsState.homeDir, { recursive: true, force: true });
    }
  });

  it('resolves provider keys from a user-selected env var and persisted runtime env', async () => {
    // Import the TS source directly: this workspace may contain stale untracked
    // src/*.js build artifacts, and this test must exercise the edited source.
    // @ts-expect-error Vitest can load TS source modules in tests.
    const providers = await import('./providers.ts');

    providers.saveProviderApiKeyEnvVar('openai', envName);
    providers.saveRuntimeEnvironmentVariables({ [envName]: 'sk-test-env' });

    expect(providers.resolveProviderApiKeyEnvVar('openai')).toBe(envName);
    expect(providers.resolveApiKey('openai')).toBe('sk-test-env');
    expect(providers.listApiKeyEnvVarCandidates('openai')).toContain(envName);
  });
});
