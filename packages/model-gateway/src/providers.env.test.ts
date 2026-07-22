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

  it('parses Windows user and system environment registry output', async () => {
    // @ts-expect-error Vitest can load TS source modules in tests.
    const providers = await import('./providers.ts');

    expect(providers.parseWindowsRegistryEnvironmentOutput(`
HKEY_CURRENT_USER\\Environment
    OPENAI_API_KEY    REG_SZ    sk-user
    MINIMAX_API_KEY    REG_EXPAND_SZ    eyJhbGciOiJIUzI1NiJ9
    Path    REG_EXPAND_SZ    C:\\Tools
`)).toEqual({
      OPENAI_API_KEY: 'sk-user',
      MINIMAX_API_KEY: 'eyJhbGciOiJIUzI1NiJ9',
      Path: 'C:\\Tools',
    });
  });
});
