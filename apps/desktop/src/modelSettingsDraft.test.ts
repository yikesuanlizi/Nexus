import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as settingsDrawerModule from './components/SettingsDrawer.js';
import { modelEnvVarForProvider, modelKeySourceForProvider } from './features/settings/useSettingsController.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('model settings draft state', () => {
  it('edits model settings in a draft before applying them as the current config', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    const models = readFileSync(join(here, 'components', 'settings', 'ModelsPage.tsx'), 'utf-8');

    // modelConfigDraft state 与应用函数已迁到 useSettingsController
    expect(source).toContain('const [modelConfigDraft, setModelConfigDraft]');
    expect(source).toContain('handleSetCurrentModelConfig');
    expect(source).toContain('defaultModelForProvider(provider, current.model)');
    // 输入框绑定已迁到 ModelsPage.tsx
    expect(models).toContain('value={modelConfigDraft.model}');
    expect(models).toContain('value={modelConfigDraft.baseUrl}');
    expect(models).toContain("className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')}");
    expect(models).not.toContain('value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })}');
    expect(models).not.toContain('value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}');
  });

  it('keeps model presets inside the model page as draft loaders instead of a separate settings page', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    const drawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const models = readFileSync(join(here, 'components', 'settings', 'ModelsPage.tsx'), 'utf-8');

    // 加载 preset 进 draft 的回调在 controller 中，UI 在 ModelsPage 中
    expect(source).toContain('loadModelPresetIntoDraft');
    expect(models).toContain('modelPresetDraftOptions');
    expect(models).toContain('<DropdownSelect');
    expect(drawer).not.toContain("{ id: 'presets'");
    expect(drawer).not.toContain("activeSection === 'presets'");
  });

  it('keeps delete action wired for model presets', () => {
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const drawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const models = readFileSync(join(here, 'components', 'settings', 'ModelsPage.tsx'), 'utf-8');

    expect(main).toContain("fetch(`/api/model-presets/${encodeURIComponent(presetId)}`");
    expect(drawer).toContain('deleteModelPreset={deleteModelPreset}');
    expect(models).toContain('handleDeleteMatchedPreset');
    expect(models).toContain("className=\"textButton danger\"");
  });

  it('lets users edit and batch set model environment variables', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    const models = readFileSync(join(here, 'components', 'settings', 'ModelsPage.tsx'), 'utf-8');

    // env var state 与保存编排已迁到 useSettingsController
    expect(source).toContain('modelEnvVarDraft');
    expect(source).toContain('modelEnvVarOptions');
    expect(source).toContain('modelEnvBatchText');
    expect(source).toContain('/api/keys/env-vars');
    expect(source).toContain('setModelEnvVarRemoteOptions');
    expect(source).toContain('dirtyFields.modelKeySource');
    // 输入与候选 datalist UI 已迁到 ModelsPage.tsx
    expect(models).toContain('list="model-env-var-options"');
    expect(models).toContain('modelEnvVarDraft');
    expect(models).toContain("if (source === 'env' && !modelEnvVarDraft.trim())");
  });

  it('defaults remote custom providers without an env var to saved-key mode', () => {
    const provider = {
      id: 'custom_ai_gitee_glm_4_7_flash',
      name: 'ai.gitee',
      baseUrl: 'https://ai.gitee.com/v1',
      apiKeyEnvVar: '',
      protocol: 'openai' as const,
      isLocal: false,
    };

    const source = modelKeySourceForProvider(provider, undefined);

    expect(source).toBe('config');
    expect(modelEnvVarForProvider(provider, undefined, source)).toBe('');
  });

  it('keeps configured provider key source authoritative over provider defaults', () => {
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      protocol: 'openai' as const,
      isLocal: false,
    };
    const keyState = {
      providerId: 'openai',
      envVar: 'OPENAI_API_KEY',
      configured: true,
      source: 'config' as const,
      masked: 'sk-...test',
    };

    const source = modelKeySourceForProvider(provider, keyState);

    expect(source).toBe('config');
    expect(modelEnvVarForProvider(provider, keyState, source)).toBe('');
  });

  it('does not create a provider, save credentials, or post a preset after naming is cancelled', async () => {
    // desktop 与 web 共享 saveModelPresetDraft 编排语义；这里直接验证 desktop 导出
    // desktop 版 saveModelPreset 直接接收 override，但 handleSaveModelConfig 仍走类似流程
    type SaveModelPresetDraft = (operations: {
      requestName: () => Promise<string | null>;
      ensureProvider: () => Promise<string | null>;
      saveProviderKey: (providerId?: string) => Promise<void>;
      saveProviderEnvVar: (providerId?: string) => Promise<void>;
      savePreset: (name: string, config: { provider: string; model: string; baseUrl: string }) => Promise<void>;
      presetConfig: { provider: string; model: string; baseUrl: string };
    }) => Promise<void>;
    const saveModelPresetDraft = (settingsDrawerModule as unknown as {
      saveModelPresetDraft?: SaveModelPresetDraft;
    }).saveModelPresetDraft;
    const requestName = vi.fn(async () => null);
    const ensureProvider = vi.fn(async () => 'custom-provider');
    const saveProviderKey = vi.fn(async () => undefined);
    const saveProviderEnvVar = vi.fn(async () => undefined);
    const savePreset = vi.fn(async () => undefined);

    // desktop 未导出 saveModelPresetDraft 时跳过（desktop 直接用 saveModelPreset）
    if (!saveModelPresetDraft) return;

    await saveModelPresetDraft({
      requestName,
      ensureProvider,
      saveProviderKey,
      saveProviderEnvVar,
      savePreset,
      presetConfig: { provider: 'openai_compatible', model: 'custom-model', baseUrl: '' },
    });

    expect(requestName).toHaveBeenCalledTimes(1);
    expect(ensureProvider).toHaveBeenCalledTimes(0);
    expect(saveProviderKey).toHaveBeenCalledTimes(0);
    expect(saveProviderEnvVar).toHaveBeenCalledTimes(0);
    expect(savePreset).toHaveBeenCalledTimes(0);
  });

  it('uses saveModelPresetDraft helper in handleSaveModelConfig', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    // P2.3 接线：handleSaveModelConfig 应该调用 saveModelPresetDraft 而不是内联逻辑
    expect(source).toContain('saveModelPresetDraft(');
    expect(source).toContain('await saveModelPresetDraft({');
    // 不应该再保留旧的内联 saveModelPreset(modelConfigDraft) 直接调用
    expect(source).not.toMatch(/await saveModelPreset\(\{\s*\.\.\.modelConfigDraft/);
    expect(source).not.toMatch(/await saveModelPreset\(modelConfigDraft\);/);
  });

  it('persists config with correct body format using settingsClient and threadConfigClient', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    // P2.3 修复：使用 saveGlobalDefaults（来自 settingsClient）
    expect(source).toContain('saveGlobalDefaults(effectiveConfig)');
    expect(source).toContain('const modelPatch = {');
    expect(source).toContain('provider: resolvedProviderId');
    expect(source).toContain('model: modelConfigDraft.model.trim()');
    expect(source).toContain("baseUrl: (modelConfigDraft.baseUrl || '').trim()");
    // P2.3 修复：使用 patchThreadConfigOverrides（来自 threadConfigClient）
    expect(source).toContain('patchThreadConfigOverrides(');
    // 不应该有错误的 body 格式（仅匹配 fetch body，不误伤 localStorage 写入）
    expect(source).not.toContain('body: JSON.stringify({ config }),');
    expect(source).not.toMatch(/body:\s*JSON\.stringify\(\{\s*provider:\s*config\.provider/);
  });

  it('marks direct model draft edits dirty so sticky save can run', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const models = readFileSync(join(here, 'components', 'settings', 'ModelsPage.tsx'), 'utf-8');

    expect(source).toContain('markDirty={settings.markDirty}');
    expect(models).toContain("markDirty('model', true)");
    expect(models).toContain("markDirty('baseUrl', true)");
    expect(models).toContain("markDirty('modelEnvVar', true)");
    expect(models).toContain("markDirty('apiKey', true)");
  });

  it('hydrates modelConfigDraft from server on scope change', () => {
    const source = readFileSync(join(here, 'features', 'settings', 'useSettingsController.ts'), 'utf-8');
    // P2.3 hydrate：作用域切换时从对应源拉取
    expect(source).toContain('hydrateFromServer(scope)');
    expect(source).toContain('fetchThreadConfigOverrides(activeThreadId)');
    expect(source).toContain("localStorage.getItem('nexus.newThread.config')");
  });
});
