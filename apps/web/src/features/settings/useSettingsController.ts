import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale, RunConfig, SecretSource } from '../../config/config.js';
import { t } from '../../shared/i18n.js';
import { RUN_CONFIG_STORAGE_KEY } from '../../config/config.js';
import type { ApiKeyState, ModelPreset, ModelPresetConfig, ProviderEntry } from '../../shared/types.js';
import { defaultModelForProvider, modelConfigDraftFromConfig, saveModelPresetDraft, type ModelConfigDraft } from '../../components/settings/shared.js';
import { saveGlobalDefaults } from './settingsClient.js';
import { fetchThreadConfigOverrides, patchThreadConfigOverrides } from '../../api/threadConfigClient.js';
import type { SettingsScope, SettingsScopeInfo, SettingsSaveState } from '../../components/settings/SettingsShell.js';

export interface UseSettingsControllerOptions {
  locale: Locale;
  config: RunConfig;
  activeThreadId: string;
  providers: ProviderEntry[];
  keyStates: ApiKeyState[];
  modelPresets: ModelPreset[];
  requestModelPresetName: (defaultName: string) => Promise<string | null>;
  saveModelPreset: (name: string, presetConfig: ModelPresetConfig) => Promise<void>;
  saveProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  saveProviderEnvVar: (providerId: string, envVar: string) => Promise<void>;
  saveEnvironmentVariables: (text: string) => Promise<void>;
  saveThreadModelOverrides: (overrides: { provider: string; model: string; baseUrl: string }) => Promise<void>;
  saveGlobalModelConfig: (config: RunConfig) => void;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  refreshProviders: () => Promise<void>;
  refreshKeyStates: () => Promise<void>;
  onClose?: () => void;
}

export interface UseSettingsControllerResult {
  scope: SettingsScope;
  setScope: (s: SettingsScope) => void;
  scopeInfo: SettingsScopeInfo;
  saveLabel: string;
  saveState: SettingsSaveState;
  handleSave: () => void;
  handleCancel: () => Promise<void>;
  markDirty: (field: string, dirty: boolean) => void;
  dirtyFields: Record<string, boolean>;
  modelConfigDraft: ModelConfigDraft;
  setModelConfigDraft: React.Dispatch<React.SetStateAction<ModelConfigDraft>>;
  apiKeyDraft: string;
  setApiKeyDraft: React.Dispatch<React.SetStateAction<string>>;
  modelKeySource: SecretSource;
  setModelKeySource: React.Dispatch<React.SetStateAction<SecretSource>>;
  showSavedModelKey: boolean;
  setShowSavedModelKey: React.Dispatch<React.SetStateAction<boolean>>;
  modelKeyNotice: string;
  setModelKeyNotice: React.Dispatch<React.SetStateAction<string>>;
  modelEnvVarDraft: string;
  setModelEnvVarDraft: React.Dispatch<React.SetStateAction<string>>;
  modelEnvVarOptions: string[];
  modelEnvBatchText: string;
  setModelEnvBatchText: React.Dispatch<React.SetStateAction<string>>;
  customProviderName: string;
  setCustomProviderName: React.Dispatch<React.SetStateAction<string>>;
  selectModelProviderDraft: (providerId: string) => void;
  loadModelPresetIntoDraft: (presetId: string) => void;
  ensureCustomProvider: () => Promise<string | null>;
  handleBatchSetModelEnv: () => Promise<void>;
  handleSaveModelConfig: () => Promise<void>;
  handleSetCurrentModelConfig: () => Promise<void>;
}

export function modelKeySourceForProvider(provider: ProviderEntry | undefined, keyState: ApiKeyState | undefined): SecretSource {
  if (keyState?.source === 'config' || keyState?.source === 'env') return keyState.source;
  if (provider?.apiKeyEnvVar?.trim()) return 'env';
  if (provider && !provider.isLocal) return 'config';
  return 'env';
}

export function modelEnvVarForProvider(
  provider: ProviderEntry | undefined,
  keyState: ApiKeyState | undefined,
  source: SecretSource,
): string {
  if (source !== 'env') return '';
  return keyState?.envVar || provider?.apiKeyEnvVar || '';
}

export function useSettingsController(options: UseSettingsControllerOptions): UseSettingsControllerResult {
  const {
    locale,
    config,
    activeThreadId,
    providers,
    keyStates,
    modelPresets,
    requestModelPresetName,
    saveModelPreset,
    saveProviderKey,
    saveProviderEnvVar,
    saveEnvironmentVariables,
    saveThreadModelOverrides: _saveThreadModelOverrides,
    saveGlobalModelConfig: _saveGlobalModelConfig,
    setConfig,
    refreshProviders,
    refreshKeyStates,
    onClose,
  } = options;

  const [scope, setScopeState] = useState<SettingsScope>('global');
  const [dirtyFields, setDirtyFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToastAt, setSavedToastAt] = useState<number | null>(null);

  const [modelConfigDraft, setModelConfigDraft] = useState<ModelConfigDraft>(() => modelConfigDraftFromConfig(config));
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [modelKeySource, setModelKeySource] = useState<SecretSource>(config.webProviderKeySource);
  const [showSavedModelKey, setShowSavedModelKey] = useState(false);
  const [modelKeyNotice, setModelKeyNotice] = useState('');
  const [modelEnvVarDraft, setModelEnvVarDraft] = useState('');
  const [modelEnvVarRemoteOptions, setModelEnvVarRemoteOptions] = useState<string[]>([]);
  const [modelEnvBatchText, setModelEnvBatchText] = useState('');
  const [customProviderName, setCustomProviderName] = useState('');

  const [_threadOverrides, setThreadOverrides] = useState<{ provider?: string; model?: string; baseUrl?: string }>({});

  const modelEnvVarOptions = useMemo(() => {
    const selected = providers.find((p) => p.id === modelConfigDraft.provider);
    const fromKeyState = keyStates.find((k) => k.providerId === modelConfigDraft.provider);
    const options = new Set<string>();
    if (selected?.apiKeyEnvVar) options.add(selected.apiKeyEnvVar);
    if (fromKeyState?.envVar) options.add(fromKeyState.envVar);
    if (fromKeyState?.defaultEnvVar) options.add(fromKeyState.defaultEnvVar);
    for (const envVar of fromKeyState?.envVarCandidates ?? []) options.add(envVar);
    for (const envVar of modelEnvVarRemoteOptions) options.add(envVar);
    options.add('OPENAI_API_KEY');
    options.add('DEEPSEEK_API_KEY');
    options.add('ZHIPU_API_KEY');
    options.add('MOONSHOT_API_KEY');
    options.add('DASHSCOPE_API_KEY');
    options.add('ANTHROPIC_API_KEY');
    options.add('GOOGLE_API_KEY');
    return Array.from(options).filter((value) => value.trim()).sort((a, b) => a.localeCompare(b));
  }, [providers, keyStates, modelConfigDraft.provider, modelEnvVarRemoteOptions]);

  const hydrateFromScope = useCallback(async (nextScope: SettingsScope) => {
    setDirtyFields({});
    setSaveError(null);
    setSavedToastAt(null);
    setModelKeyNotice('');
    setApiKeyDraft('');
    setModelEnvBatchText('');

    let draft: ModelConfigDraft;
    let keySource: SecretSource;
    let envVar = '';

    if (nextScope === 'currentThread' && activeThreadId) {
      try {
        const overrides = await fetchThreadConfigOverrides(activeThreadId);
        setThreadOverrides(overrides);
        draft = {
          provider: overrides.provider ?? config.provider,
          model: overrides.model ?? config.model,
          baseUrl: overrides.baseUrl ?? config.baseUrl,
        };
      } catch {
        draft = modelConfigDraftFromConfig(config);
      }
    } else if (nextScope === 'newThread') {
      try {
        const stored = localStorage.getItem(RUN_CONFIG_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<RunConfig>;
          draft = {
            provider: parsed.provider ?? config.provider,
            model: parsed.model ?? config.model,
            baseUrl: parsed.baseUrl ?? config.baseUrl,
          };
        } else {
          draft = modelConfigDraftFromConfig(config);
        }
      } catch {
        draft = modelConfigDraftFromConfig(config);
      }
    } else {
      draft = modelConfigDraftFromConfig(config);
    }

    const provider = providers.find((p) => p.id === draft.provider);
    const keyState = keyStates.find((k) => k.providerId === draft.provider);
    keySource = modelKeySourceForProvider(provider, keyState);
    envVar = modelEnvVarForProvider(provider, keyState, keySource);

    setModelConfigDraft(draft);
    setModelKeySource(keySource);
    setModelEnvVarDraft(envVar);
    setCustomProviderName(draft.provider.startsWith('custom_') ? '' : '');
  }, [config, activeThreadId, providers, keyStates]);

  useEffect(() => {
    void hydrateFromScope(scope);
  }, [scope, hydrateFromScope]);

  useEffect(() => {
    if (scope !== 'global') return;
    setModelConfigDraft(modelConfigDraftFromConfig(config));
  }, [config, scope]);

  useEffect(() => {
    if (dirtyFields.modelKeySource || dirtyFields.modelEnvVar || dirtyFields.apiKey) return;
    const selectedProvider = providers.find((p) => p.id === modelConfigDraft.provider);
    if (selectedProvider && !selectedProvider.apiKeyEnvVar && !selectedProvider.isLocal) {
      setModelKeySource('config');
      setModelEnvVarDraft('');
      return;
    }
    if (modelKeySource === 'env' && selectedProvider?.apiKeyEnvVar && !modelEnvVarDraft) {
      setModelEnvVarDraft(selectedProvider.apiKeyEnvVar);
    }
  }, [
    dirtyFields.modelKeySource,
    dirtyFields.modelEnvVar,
    dirtyFields.apiKey,
    modelConfigDraft.provider,
    providers,
    modelEnvVarDraft,
    modelKeySource,
  ]);

  const markDirty = useCallback((field: string, dirty: boolean) => {
    setDirtyFields((current) => {
      if (current[field] === dirty) return current;
      const next = { ...current };
      if (dirty) {
        next[field] = true;
      } else {
        delete next[field];
      }
      return next;
    });
  }, []);

  const dirty = Object.keys(dirtyFields).length > 0;

  const saveState: SettingsSaveState = useMemo(() => ({
    dirty,
    saving,
    error: saveError,
    savedToastAt,
  }), [dirty, saving, saveError, savedToastAt]);

  const currentThreadAvailable = Boolean(activeThreadId);

  const setScope = useCallback((next: SettingsScope) => {
    setScopeState(next);
    setDirtyFields({});
    setSaveError(null);
    setSavedToastAt(null);
  }, []);

  const scopeInfo: SettingsScopeInfo = useMemo(() => ({
    value: scope,
    onChange: setScope,
    currentThreadAvailable,
  }), [scope, currentThreadAvailable]);

  const saveLabel = t(locale, 'save');

  const selectModelProviderDraft = useCallback((providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    setModelConfigDraft((current) => {
      if (providerId === 'openai_compatible' && !customProviderName.trim()) {
        return current;
      }
      return {
        ...current,
        provider: providerId,
        model: defaultModelForProvider(provider, current.model),
        baseUrl: provider?.baseUrl ?? current.baseUrl,
      };
    });
    markDirty('provider', true);
    markDirty('model', true);
    setApiKeyDraft('');
    setShowSavedModelKey(false);
    const keyState = keyStates.find((state) => state.providerId === providerId);
    const nextSource = modelKeySourceForProvider(provider, keyState);
    setModelKeySource(nextSource);
    setModelEnvVarDraft(modelEnvVarForProvider(provider, keyState, nextSource));
  }, [providers, keyStates, customProviderName, markDirty]);

  const ensureCustomProvider = useCallback(async (): Promise<string | null> => {
    if (modelConfigDraft.provider !== 'openai_compatible') {
      return modelConfigDraft.provider;
    }
    const name = customProviderName.trim();
    if (!name) return 'openai_compatible';
    const customId = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const exists = providers.some((p) => p.id === customId);
    if (!exists) {
      await refreshProviders();
    }
    return customId;
  }, [modelConfigDraft.provider, customProviderName, providers, refreshProviders]);

  const saveModelKeyDraftIfNeeded = useCallback(async (providerId?: string) => {
    const targetProvider = providerId ?? modelConfigDraft.provider;
    if (modelKeySource === 'config' && apiKeyDraft.trim()) {
      await saveProviderKey(targetProvider, apiKeyDraft.trim());
    }
  }, [modelKeySource, apiKeyDraft, modelConfigDraft.provider, saveProviderKey]);

  const saveModelEnvVarDraftIfNeeded = useCallback(async (providerId?: string) => {
    const targetProvider = providerId ?? modelConfigDraft.provider;
    if (modelKeySource === 'env' && modelEnvVarDraft.trim()) {
      await saveProviderEnvVar(targetProvider, modelEnvVarDraft.trim());
    }
  }, [modelKeySource, modelEnvVarDraft, modelConfigDraft.provider, saveProviderEnvVar]);

  const loadModelPresetIntoDraft = useCallback((presetId: string) => {
    if (presetId === '__draft__') return;
    const preset = modelPresets.find((p) => p.id === presetId);
    if (!preset) return;
    setModelConfigDraft({
      provider: preset.config.provider.trim(),
      model: preset.config.model.trim(),
      baseUrl: (preset.config.baseUrl || '').trim(),
    });
    const providerId = preset.config.provider.trim();
    const provider = providers.find((p) => p.id === providerId);
    const keyState = keyStates.find((k) => k.providerId === providerId);
    const nextSource = modelKeySourceForProvider(provider, keyState);
    setModelKeySource(nextSource);
    setModelEnvVarDraft(modelEnvVarForProvider(provider, keyState, nextSource));
    markDirty('provider', true);
    markDirty('model', true);
    markDirty('baseUrl', true);
  }, [modelPresets, providers, keyStates, markDirty]);

  const handleBatchSetModelEnv = useCallback(async () => {
    const text = modelEnvBatchText.trim();
    if (!text) return;
    try {
      await saveEnvironmentVariables(text);
      const response = await fetch('/api/keys/env-vars');
      if (response.ok) {
        const data = (await response.json()) as { envVars?: string[] };
        setModelEnvVarRemoteOptions(data.envVars ?? []);
      }
      setModelEnvBatchText('');
      setModelKeyNotice(locale === 'zh' ? '环境变量已设置。' : 'Environment variables set.');
      await refreshKeyStates();
    } catch (error) {
      setModelKeyNotice(error instanceof Error ? error.message : String(error));
    }
  }, [modelEnvBatchText, saveEnvironmentVariables, refreshKeyStates, locale]);

  useEffect(() => {
    fetch('/api/keys/env-vars')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { envVars?: string[] } | null) => setModelEnvVarRemoteOptions(data?.envVars ?? []))
      .catch(() => setModelEnvVarRemoteOptions([]));
  }, []);

  const handleSaveModelConfig = useCallback(async () => {
    try {
      setModelKeyNotice('');
      await saveModelPresetDraft({
        requestName: () => requestModelPresetName(modelConfigDraft.model || 'My Preset'),
        ensureProvider: ensureCustomProvider,
        saveProviderKey: saveModelKeyDraftIfNeeded,
        saveProviderEnvVar: saveModelEnvVarDraftIfNeeded,
        savePreset: saveModelPreset,
        presetConfig: {
          provider: modelConfigDraft.provider.trim(),
          model: modelConfigDraft.model.trim(),
          baseUrl: modelConfigDraft.baseUrl.trim(),
        },
      });
      setApiKeyDraft('');
      markDirty('apiKey', false);
      markDirty('modelEnvVar', false);
      setModelKeyNotice(locale === 'zh' ? '预设已保存。' : 'Preset saved.');
      await refreshKeyStates();
    } catch (error) {
      setModelKeyNotice(error instanceof Error ? error.message : String(error));
    }
  }, [
    modelConfigDraft,
    requestModelPresetName,
    ensureCustomProvider,
    saveModelKeyDraftIfNeeded,
    saveModelEnvVarDraftIfNeeded,
    saveModelPreset,
    refreshKeyStates,
    markDirty,
    locale,
  ]);

  const handleSetCurrentModelConfig = useCallback(async () => {
    try {
      setSaving(true);
      setSaveError(null);

      const resolvedProvider = await ensureCustomProvider();
      const nextConfig = {
        provider: (resolvedProvider ?? modelConfigDraft.provider).trim(),
        model: modelConfigDraft.model.trim(),
        baseUrl: modelConfigDraft.baseUrl.trim(),
      };

      await saveModelKeyDraftIfNeeded(nextConfig.provider);
      await saveModelEnvVarDraftIfNeeded(nextConfig.provider);

      if (scope === 'global') {
        await saveGlobalDefaults(nextConfig);
        setConfig((current) => ({ ...current, ...nextConfig }));
      } else if (scope === 'currentThread' && activeThreadId) {
        const updated = await patchThreadConfigOverrides(activeThreadId, nextConfig);
        setThreadOverrides(updated);
        setConfig((current) => ({ ...current, ...nextConfig }));
      } else if (scope === 'newThread') {
        const stored = localStorage.getItem(RUN_CONFIG_STORAGE_KEY);
        const base = stored ? JSON.parse(stored) as Partial<RunConfig> : {};
        localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify({ ...base, ...nextConfig }));
      }

      setApiKeyDraft('');
      setDirtyFields({});
      setSavedToastAt(Date.now());
      await refreshKeyStates();
      setTimeout(() => setSavedToastAt(null), 2000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [
    scope,
    activeThreadId,
    modelConfigDraft,
    ensureCustomProvider,
    saveModelKeyDraftIfNeeded,
    saveModelEnvVarDraftIfNeeded,
    setConfig,
    _saveThreadModelOverrides,
    refreshKeyStates,
  ]);

  const handleSave = useCallback(() => {
    void handleSetCurrentModelConfig();
  }, [handleSetCurrentModelConfig]);

  const handleCancel = useCallback(async () => {
    await hydrateFromScope(scope);
    if (onClose) onClose();
  }, [hydrateFromScope, scope, onClose]);

  return {
    scope,
    setScope,
    scopeInfo,
    saveLabel,
    saveState,
    handleSave,
    handleCancel,
    markDirty,
    dirtyFields,
    modelConfigDraft,
    setModelConfigDraft,
    apiKeyDraft,
    setApiKeyDraft,
    modelKeySource,
    setModelKeySource,
    showSavedModelKey,
    setShowSavedModelKey,
    modelKeyNotice,
    setModelKeyNotice,
    modelEnvVarDraft,
    setModelEnvVarDraft,
    modelEnvVarOptions,
    modelEnvBatchText,
    setModelEnvBatchText,
    customProviderName,
    setCustomProviderName,
    selectModelProviderDraft,
    loadModelPresetIntoDraft,
    ensureCustomProvider,
    handleBatchSetModelEnv,
    handleSaveModelConfig,
    handleSetCurrentModelConfig,
  };
}
