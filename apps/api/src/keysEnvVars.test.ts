import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('model key environment variables', () => {
  it('supports provider env-var overrides and batch process env updates', () => {
    const providerSource = readFileSync(join(process.cwd(), 'packages', 'model-gateway', 'src', 'providers.ts'), 'utf-8');
    const routeSource = readFileSync(join(process.cwd(), 'apps', 'api', 'src', 'routes', 'keysRoute.ts'), 'utf-8');

    expect(providerSource).toContain('apiKeyEnvVars?: Record<string, string>');
    expect(providerSource).toContain('saveProviderApiKeyEnvVar');
    expect(providerSource).toContain('saveRuntimeEnvironmentVariables');
    expect(providerSource).toContain('listApiKeyEnvVarCandidates');
    expect(providerSource).toContain('readApiKeyEnvironmentValue');
    expect(providerSource).toContain('parseWindowsRegistryEnvironmentOutput');
    expect(routeSource).toContain('/api/keys/env-vars');
    expect(routeSource).toContain('/api/keys/env');
    expect(routeSource).toContain('readApiKeyEnvironmentValue(envVar)');
  });
});
