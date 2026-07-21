import { describe, expect, it } from 'vitest';
import {
  modelPresetConfigFrom,
  threadRunConfigOverridesFrom,
  activeRunConfig,
  parseCompositeConfigSnapshot,
  defaultGlobalRunConfigDefaults,
  defaultAppearanceConfig,
  defaultCompositeConfigSnapshot,
} from './runConfig.js';

describe('modelPresetConfigFrom', () => {
  it('keeps only provider, model, and baseUrl', () => {
    expect(modelPresetConfigFrom({
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://example.test/v1',
      permissions: 'danger_full_access',
      workspaceRoot: 'E:/secret',
      memoryEnabled: false,
    })).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('projects only fields that may override a thread', () => {
    expect(threadRunConfigOverridesFrom({
      workspaceRoot: 'E:/repo',
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: '',
      permissions: 'workspace',
      webSearchMode: 'auto',
      reasoningEffort: 'high',
      runProfile: 'runtime_os',
      memoryEnabled: false,
      dataDir: 'E:/private',
    })).toEqual({
      workspaceRoot: 'E:/repo',
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: '',
      permissions: 'workspace',
      webSearchMode: 'auto',
      reasoningEffort: 'high',
      runProfile: 'runtime_os',
    });
  });

  it('rejects a preset without provider or model', () => {
    expect(() => modelPresetConfigFrom({ provider: '', model: '' }))
      .toThrow('provider and model are required');
  });
});

describe('activeRunConfig', () => {
  it('thread override overrides global default', () => {
    const composite = {
      globalDefaults: {
        ...defaultGlobalRunConfigDefaults,
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
      },
      appearance: defaultAppearanceConfig,
      newThreadDefaults: {},
      activeThreadOverrides: {
        provider: 'anthropic',
        model: 'claude-3-opus',
      },
    };
    const resolved = activeRunConfig(composite);
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.model).toBe('claude-3-opus');
    expect(resolved.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('uses global defaults when no overrides', () => {
    const composite = {
      globalDefaults: {
        ...defaultGlobalRunConfigDefaults,
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.5,
      },
      appearance: defaultAppearanceConfig,
      newThreadDefaults: {},
      activeThreadOverrides: {},
    };
    const resolved = activeRunConfig(composite);
    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-4o');
    expect(resolved.baseUrl).toBe('https://api.openai.com/v1');
    expect(resolved.temperature).toBe(0.5);
  });
});

describe('parseCompositeConfigSnapshot', () => {
  it('fills in defaults when fields are missing', () => {
    const parsed = parseCompositeConfigSnapshot({});
    expect(parsed.globalDefaults.provider).toBe('openai');
    expect(parsed.globalDefaults.model).toBe('gpt-4o');
    expect(parsed.appearance.themeMode).toBe('auto');
    expect(parsed.appearance.themePrimaryColor).toBe('6366f1');
    expect(parsed.activeThreadOverrides).toEqual({});
    expect(parsed.newThreadDefaults).toEqual({});
  });

  it('ignores extra fields (injection protection)', () => {
    const rawInput = {
      globalDefaults: {
        provider: 'custom-provider',
        injectedField: 'malicious',
      },
      appearance: {
        themeMode: 'dark',
        extraThemeSetting: true,
      },
      newThreadDefaults: {
        model: 'custom-model',
        unknownKey: 'should-be-ignored',
      },
      activeThreadOverrides: {
        baseUrl: 'https://custom.example.com',
        evilSetting: 'pwned',
      },
      unexpectedTopLevel: 'should be stripped',
    };
    const parsed = parseCompositeConfigSnapshot(rawInput) as unknown as Record<string, Record<string, unknown>>;

    expect(parsed.globalDefaults.provider).toBe('custom-provider');
    expect(parsed.globalDefaults.injectedField).toBeUndefined();
    expect(parsed.appearance.themeMode).toBe('dark');
    expect(parsed.appearance.extraThemeSetting).toBeUndefined();
    expect(parsed.newThreadDefaults.model).toBe('custom-model');
    expect(parsed.newThreadDefaults.unknownKey).toBeUndefined();
    expect(parsed.activeThreadOverrides.baseUrl).toBe('https://custom.example.com');
    expect(parsed.activeThreadOverrides.evilSetting).toBeUndefined();
    expect(parsed.unexpectedTopLevel).toBeUndefined();
  });

  it('produces a valid default composite snapshot', () => {
    const parsed = parseCompositeConfigSnapshot({});
    expect(parsed).toEqual(defaultCompositeConfigSnapshot);
  });
});
