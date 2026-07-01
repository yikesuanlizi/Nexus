import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_MODE_KEY, resolveDeploymentConfig, type DeploymentModeSetting } from './deployment.js';
import type { ThreadStore } from '@nexus/storage';

function storeWith(setting: DeploymentModeSetting | null = null): ThreadStore {
  const settings = new Map<string, unknown>();
  if (setting) settings.set(DEPLOYMENT_MODE_KEY, setting);
  return {
    tenantId: 'default',
    async getSetting<T>(key: string) { return (settings.get(key) as T | undefined) ?? null; },
    async setSetting(key: string, value: unknown) { settings.set(key, value); },
  } as ThreadStore;
}

describe('deployment config', () => {
  it('uses initialization mode before environment auth/storage settings', async () => {
    const config = await resolveDeploymentConfig(storeWith({
      mode: 'multi',
      jwtSecret: 'init-secret',
      initializedAt: '2026-01-01T00:00:00.000Z',
    }), 'multi', {
      NEXUS_AUTH_MODE: 'token',
      NEXUS_JWT_SECRET: 'env-secret',
      NEXUS_ADMIN_BOOTSTRAP_TOKEN: 'bootstrap',
    });

    expect(config).toMatchObject({
      initialized: true,
      deploymentMode: 'multi',
      source: 'init',
      authMode: 'token',
      authConfig: { jwtSecret: 'init-secret' },
    });
  });

  it('uses explicit environment mode when initialization is absent', async () => {
    const config = await resolveDeploymentConfig(storeWith(), 'single', {
      NEXUS_DEPLOYMENT_MODE: 'multi',
      NEXUS_JWT_SECRET: 'secret',
    });

    expect(config).toMatchObject({
      initialized: true,
      deploymentMode: 'multi',
      source: 'env',
      authMode: 'token',
    });
  });

  it('reports default single mode as not initialized', async () => {
    const config = await resolveDeploymentConfig(storeWith(), 'single', {});

    expect(config).toMatchObject({
      initialized: false,
      deploymentMode: 'single',
      source: 'default',
      authMode: 'off',
    });
  });

  it('does not treat storage mode alone as deployment initialization', async () => {
    const config = await resolveDeploymentConfig(storeWith(), 'multi', {
      NEXUS_STORAGE_MODE: 'multi',
    });

    expect(config).toMatchObject({
      initialized: false,
      deploymentMode: 'single',
      source: 'default',
      authMode: 'off',
    });
  });
});
