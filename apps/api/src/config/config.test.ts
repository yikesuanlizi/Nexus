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

  it('legacy harness profile auto-downgrades to runtime_os', () => {
    // harness 不再是 RunProfile，已降级为 runtime 底座能力
    expect(resolveConfig({ runProfile: 'harness' as never }).runProfile).toBe('runtime_os');
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

  it('does not persist UI-only appearance fields into thread metadata when saving thread config', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-2' as ThreadId;

    store.threads.set(threadId, fakeThread(threadId, {
      tags: {},
    }));
    await repo.saveDefaultRunConfig({
      themeMode: 'dark',
      userAvatarId: 'asteroid',
      customUserAvatarDataUrl: 'data:image/png;base64,abc',
    } as never);
    await repo.saveThreadRunConfig(threadId, { model: 'thread-model' });

    const saved = store.threads.get(threadId)?.tags?.runConfig;

    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved ?? '{}');
    expect(parsed).not.toHaveProperty('themeMode');
    expect(parsed).not.toHaveProperty('userAvatarId');
    expect(parsed).not.toHaveProperty('customUserAvatarDataUrl');
  });
});

describe('model preset persistence', () => {
  it('stores only provider, model, and baseUrl', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);

    const { preset } = await repo.upsertModelPreset({
      name: 'OpenAI',
      config: {
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: 'https://example.test/v1',
        permissions: 'danger_full_access',
        workspaceRoot: 'E:/secret',
        memoryEnabled: false,
      },
    });

    expect(preset.config).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('rejects presets without provider or model', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);

    await expect(repo.upsertModelPreset({
      config: { provider: '', model: '' },
    })).rejects.toThrow('provider and model are required');
  });
});

describe('thread config overrides', () => {
  it('returns empty object by default', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-overrides-1' as ThreadId;

    const overrides = await repo.getThreadConfigOverrides(threadId);

    expect(overrides).toEqual({});
  });

  it('filters input to only provider, model, and baseUrl', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-overrides-2' as ThreadId;

    const overrides = await repo.updateThreadConfigOverrides(threadId, {
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://example.test/v1',
      permissions: 'danger_full_access',
      workspaceRoot: 'E:/secret',
      memoryEnabled: false,
      extraField: 'should-be-stripped',
    });

    expect(overrides).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('persists only the three whitelisted fields', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-overrides-3' as ThreadId;

    await repo.updateThreadConfigOverrides(threadId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      baseUrl: 'https://api.anthropic.com',
      permissions: 'workspace',
    });

    const stored = await repo.getThreadConfigOverrides(threadId);
    expect(stored).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(stored).not.toHaveProperty('permissions');
  });

  it('merges overrides into thread run config', async () => {
    const store = new FakeThreadStore();
    const repo = createConfigRepository(store as unknown as ThreadStore);
    const threadId = 'thread-overrides-4' as ThreadId;

    store.threads.set(threadId, fakeThread(threadId, { tags: {} }));
    await repo.saveDefaultRunConfig({ provider: 'ollama', model: 'qwen2.5-coder:7b' });
    await repo.updateThreadConfigOverrides(threadId, {
      provider: 'openai',
      model: 'gpt-5',
    });

    const config = await repo.getThreadRunConfig(threadId);

    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-5');
  });
});
