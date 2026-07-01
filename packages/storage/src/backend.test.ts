import { describe, expect, it } from 'vitest';
import { resolveStorageOptions } from './index.js';

describe('storage backend mode', () => {
  it('defaults to lightweight single-machine sqlite mode', () => {
    expect(resolveStorageOptions({})).toEqual({
      mode: 'single',
      backend: 'sqlite',
      postgresUrl: null,
    });
  });

  it('uses postgres for explicit multi-tenant mode and requires DATABASE_URL', () => {
    expect(() => resolveStorageOptions({ NEXUS_STORAGE_MODE: 'multi' })).toThrow(/DATABASE_URL/);
    expect(resolveStorageOptions({
      NEXUS_STORAGE_MODE: 'multi',
      DATABASE_URL: 'postgresql://nexus:nexus@localhost:5432/nexus',
    })).toEqual({
      mode: 'multi',
      backend: 'postgres',
      postgresUrl: 'postgresql://nexus:nexus@localhost:5432/nexus',
    });
  });

  it('allows explicit backend override for local production-like testing', () => {
    expect(resolveStorageOptions({
      NEXUS_STORAGE_BACKEND: 'postgres',
      DATABASE_URL: 'postgresql://localhost/nexus',
    })).toEqual({
      mode: 'single',
      backend: 'postgres',
      postgresUrl: 'postgresql://localhost/nexus',
    });
  });
});
