import * as os from 'node:os';
import * as path from 'node:path';
import type { ThreadId, ThreadMeta } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { describe, expect, it } from 'vitest';
import { createConfigRepository, defaultConfig, publicWebProviderConfig, resolveConfig, resolveWebProviderRuntimeConfig } from './config.js';

class FakeThreadStore {
  settings = new Map<string, unknown>();
  threads = new Map<ThreadId, ThreadMeta>();

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T) ?? null;
  }

  async setSetting<T = unknown>(key: string, value: T): Promise<void> {
    this.settings.set(key, value);
  }

  async getThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    return this.threads.get(threadId) ?? null;
  }

  async updateThreadMetadata(threadId: ThreadId, patch: Partial<ThreadMeta>): Promise<void> {
    const current = this.threads.get(threadId);
    if (current) this.threads.set(threadId, { ...current, ...patch });
  }
}

function fakeThread(threadId: ThreadId, patch: Partial<ThreadMeta> = {}): ThreadMeta {
  const now = new Date().toISOString();
  return {
    threadId,
    title: 'Test thread',
    workspaceRoot: '',
    status: 'active',
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ephemeral: false,
    tags: {},
    ...patch,
  };
}

describe('AgentRunConfig skillsRoot', () => {
  it('defaults skillsRoot to the current user home directory', () => {
    expect(defaultConfig.skillsRoot).toBe(path.join(os.homedir(), '.nexus', 'skills'));
  });

  it('resolves configured skillsRoot to an absolute path', () => {
    expect(resolveConfig({ skillsRoot: '.nexus/skills' }).skillsRoot).toBe(
      path.resolve('.nexus/skills'),
    );
  });

  it('treats an empty stored skillsRoot as unset', () => {
    expect(resolveConfig({ skillsRoot: '' }).skillsRoot).toBe(defaultConfig.skillsRoot);
  });
});

describe('AgentRunConfig runProfile', () => {
  it('defaults to the long-running Runtime OS profile', () => {
    expect(defaultConfig.runProfile).toBe('runtime_os');
  });

  it('accepts cache_first and falls back invalid values to runtime_os', () => {
    expect(resolveConfig({ runProfile: 'cache_first' }).runProfile).toBe('cache_first');
    expect(resolveConfig({ runProfile: 'bad-value' as never }).runProfile).toBe('runtime_os');
  });

  it('accepts harness profile for autonomous loop', () => {
    expect(resolveConfig({ runProfile: 'harness' }).runProfile).toBe('harness');
  });
});

describe('AgentRunConfig themeMode', () => {
  it('defaults to light and falls back invalid values to light', () => {
    expect(defaultConfig.themeMode).toBe('light');
    expect(resolveConfig({ themeMode: 'dark' }).themeMode).toBe('dark');
    expect(resolveConfig({ themeMode: 'system' }).themeMode).toBe('system');
    expect(resolveConfig({ themeMode: 'bad-value' as never }).themeMode).toBe('light');
  });
});

describe('AgentRunConfig web provider', () => {
  it('defaults to local native fetch and accepts Firecrawl as explicit enhanced mode', () => {
    expect(defaultConfig.webProvider).toBe('native_fetch');
    expect(defaultConfig.webProviderKeySource).toBe('config');
    expect(resolveConfig({ webProvider: 'firecrawl' }).webProvider).toBe('firecrawl');
    expect(resolveConfig({ webProvider: 'bad_provider' as never }).webProvider).toBe('native_fetch');
  });

  it('resolves Firecrawl key from project config before falling back to env mode', () => {
    const fromConfig = resolveWebProviderRuntimeConfig(
      { webProvider: 'firecrawl', webProviderKeySource: 'config' },
      { firecrawlApiKey: 'stored-key' },
      { FIRECRAWL_API_KEY: 'env-key' },
    );
    expect(fromConfig.firecrawl.apiKey).toBe('stored-key');
    expect(fromConfig.source).toBe('config');

    const fromEnv = resolveWebProviderRuntimeConfig(
      { webProvider: 'firecrawl', webProviderKeySource: 'env' },
      { firecrawlApiKey: 'stored-key' },
      { FIRECRAWL_API_KEY: 'env-key' },
    );
    expect(fromEnv.firecrawl.apiKey).toBe('env-key');
    expect(fromEnv.source).toBe('env');
  });

  it('masks Firecrawl key in public settings output', () => {
    const publicConfig = publicWebProviderConfig(
      { firecrawlApiKey: 'fc-1234567890' },
      { FIRECRAWL_API_KEY: 'env-key' },
    );
    expect(publicConfig.firecrawl.configured).toBe(true);
    expect(publicConfig.firecrawl.source).toBe('config');
    expect(publicConfig.firecrawl.masked).toBe('fc-1...7890');
    expect(JSON.stringify(publicConfig)).not.toContain('fc-1234567890');
  });
});

describe('thread appearance persistence', () => {
  it('ignores legacy thread-level themeMode and resolves from global defaults', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-1' as ThreadId;

    store.threads.set(threadId, fakeThread(threadId, {
      tags: {
        runConfig: JSON.stringify({ model: 'thread-model', themeMode: 'light' }),
      },
    }));
    await repo.saveDefaultRunConfig({ themeMode: 'dark' });

    const config = await repo.getThreadRunConfig(threadId);

    expect(config.model).toBe('thread-model');
    expect(config.themeMode).toBe('dark');
  });

  it('does not persist themeMode into thread metadata when saving thread config', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-2' as ThreadId;

    store.threads.set(threadId, fakeThread(threadId, {
      tags: {},
    }));
    await repo.saveDefaultRunConfig({ themeMode: 'dark' });
    await repo.saveThreadRunConfig(threadId, { model: 'thread-model' });

    const saved = store.threads.get(threadId)?.tags?.runConfig;

    expect(saved).toBeTruthy();
    expect(JSON.parse(saved ?? '{}')).not.toHaveProperty('themeMode');
  });
});
