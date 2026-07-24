import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale, RunConfig, SecretSource } from '../../config/config.js';
import { t } from '../../shared/i18n.js';
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
  saveState: SettingsSaveState;
  handleSave: () => void;
  handleCancel: () => void;
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
  customProviderName: string;
  setCustomProviderName: React.Dispatch<React.SetStateAction<string>>;
  selectModelProviderDraft: (providerId: string) => void;
  loadModelPresetIntoDraft: (presetId: string) => void;
  handleSaveModelConfig: () => Promise<void>;
  handleSetCurrentModelConfig: () => Promise<void>;
  saveLabel: string;
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

function legacyCustomProviderName(providerId: string): string {
  return providerId.replace(/^custom_/, '').replace(/_/g, '.');
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
  const [modelKeySource, setModelKeySource] = useState<SecretSource>('env');
  const [showSavedModelKey, setShowSavedModelKey] = useState(false);
  const [modelKeyNotice, setModelKeyNotice] = useState('');
  const [modelEnvVarDraft, setModelEnvVarDraft] = useState('');
  const [modelEnvVarRemoteOptions, setModelEnvVarRemoteOptions] = useState<string[]>([]);
  const [customProviderName, setCustomProviderName] = useState('');

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === modelConfigDraft.provider),
    [providers, modelConfigDraft.provider],
  );
  const selectedKeyState = useMemo(
    () => keyStates.find((state) => state.providerId === modelConfigDraft.provider),
    [keyStates, modelConfigDraft.provider],
  );

  const modelEnvVarOptions = useMemo(() => [...new Set([
    selectedKeyState?.envVar,
    selectedKeyState?.defaultEnvVar,
    selectedProvider?.apiKeyEnvVar,
    ...(selectedKeyState?.envVarCandidates ?? []),
    ...modelEnvVarRemoteOptions,
  ].filter((value): value is string => Boolean(value?.trim())))], [selectedKeyState, selectedProvider, modelEnvVarRemoteOptions]);

  const scopeInfo: SettingsScopeInfo = useMemo(() => ({
    value: scope,
    onChange: (next) => {
      setScopeState(next);
      setDirtyFields({});
      setSaveError(null);
      setSavedToastAt(null);
    },
    currentThreadAvailable: Boolean(activeThreadId),
  }), [scope, activeThreadId]);

  const saveState: SettingsSaveState = useMemo(() => ({
    dirty: Object.values(dirtyFields).some(Boolean),
    saving,
    error: saveError,
    savedToastAt,
  }), [dirtyFields, saving, saveError, savedToastAt]);

  const markDirty = useCallback((field: string, dirty: boolean) => {
    setDirtyFields((current) => (current[field] === dirty ? current : { ...current, [field]: dirty }));
  }, []);

  const setScope = useCallback((s: SettingsScope) => {
    setScopeState(s);
    setDirtyFields({});
    setSaveError(null);
    setSavedToastAt(null);
  }, []);

  async function hydrateFromServer(targetScope: SettingsScope) {
    try {
      let nextDraft: ModelConfigDraft | null = null;
      if (targetScope === 'global') {
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const data = (await response.json()) as { config?: Partial<RunConfig> };
        if (data.config) {
          nextDraft = {
            provider: data.config.provider ?? config.provider,
            model: data.config.model ?? config.model,
            baseUrl: data.config.baseUrl ?? config.baseUrl,
          };
        }
      } else if (targetScope === 'currentThread' && activeThreadId) {
        const overrides = await fetchThreadConfigOverrides(activeThreadId);
        nextDraft = {
          provider: overrides.provider ?? config.provider,
          model: overrides.model ?? config.model,
          baseUrl: overrides.baseUrl ?? config.baseUrl,
        };
      } else if (targetScope === 'newThread') {
        try {
          const stored = window.localStorage.getItem('nexus.newThread.config');
          if (stored) {
            const parsed = JSON.parse(stored) as { provider?: string; model?: string; baseUrl?: string };
            nextDraft = {
              provider: parsed.provider ?? config.provider,
              model: parsed.model ?? config.model,
              baseUrl: parsed.baseUrl ?? config.baseUrl,
            };
          }
        } catch {
          // silently ignore
        }
      }
      if (nextDraft) {
        const provider = providers.find((item) => item.id === nextDraft.provider);
        const keyState = keyStates.find((state) => state.providerId === nextDraft.provider);
        const nextSource = modelKeySourceForProvider(provider, keyState);
        setModelConfigDraft(nextDraft);
        setModelKeySource(nextSource);
        setModelEnvVarDraft(modelEnvVarForProvider(provider, keyState, nextSource));
      }
      setDirtyFields({});
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  async function ensureCustomProvider(): Promise<string | null> {
    const existingDraftProvider = providers.find((provider) => provider.id === modelConfigDraft.provider);
    const missingLegacyCustomProvider = modelConfigDraft.provider.startsWith('custom_') && !existingDraftProvider;
    if (modelConfigDraft.provider !== 'openai_compatible' && !missingLegacyCustomProvider) return modelConfigDraft.provider;
    const name = customProviderName.trim() || (missingLegacyCustomProvider ? legacyCustomProviderName(modelConfigDraft.provider) : '');
    if (!name) return modelConfigDraft.provider;
    if (name === 'OpenAI-compatible') return modelConfigDraft.provider;
    const existing = providers.find((provider) => (
      provider.id.startsWith('custom_')
      && provider.name.trim().toLowerCase() === name.toLowerCase()
      && provider.baseUrl.trim() === modelConfigDraft.baseUrl.trim()
    ));
    if (existing) return existing.id;
    const response = await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        baseUrl: modelConfigDraft.baseUrl,
        protocol: 'openai',
      }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Failed to create custom provider: ${err.slice(0, 200)}`);
    }
    const data = (await response.json()) as { provider?: ProviderEntry };
    const newProvider = data.provider;
    if (!newProvider?.id) return modelConfigDraft.provider;
    await refreshProviders();
    setCustomProviderName('');
    return newProvider.id;
  }

  async function saveModelKeyDraftIfNeeded(providerId?: string) {
    if (modelKeySource !== 'config') return;
    const nextKey = apiKeyDraft.trim();
    if (!nextKey) return;
    await saveProviderKey(providerId ?? modelConfigDraft.provider, nextKey);
    setApiKeyDraft('');
  }

  async function saveModelEnvVarDraftIfNeeded(providerId?: string) {
    if (modelKeySource !== 'env') return;
    const envVar = modelEnvVarDraft.trim();
    if (!envVar) return;
    await saveProviderEnvVar(providerId ?? modelConfigDraft.provider, envVar);
    setModelEnvVarRemoteOptions((current) => current.includes(envVar) ? current : [...current, envVar].sort((a, b) => a.localeCompare(b)));
  }

  async function persistConfig() {
    setSaving(true);
    setSaveError(null);
    try {
      const targetProviderId = await ensureCustomProvider();
      const resolvedProviderId = targetProviderId ?? modelConfigDraft.provider;
      await saveModelKeyDraftIfNeeded(resolvedProviderId);
      await saveModelEnvVarDraftIfNeeded(resolvedProviderId);
      const modelPatch = {
        provider: resolvedProviderId,
        model: modelConfigDraft.model,
        baseUrl: modelConfigDraft.baseUrl || '',
      };
      const effectiveConfig = { ...config, ...modelPatch };
      if (scope === 'global') {
        await saveGlobalDefaults(effectiveConfig);
        setConfig(effectiveConfig);
      } else if (scope === 'currentThread' && activeThreadId) {
        await patchThreadConfigOverrides(activeThreadId, modelPatch);
        setConfig(effectiveConfig);
      } else if (scope === 'newThread') {
        try {
          window.localStorage.setItem('nexus.newThread.config', JSON.stringify(modelPatch));
        } catch {
          // silently ignore
        }
      }
      setDirtyFields({});
      setSavedToastAt(Date.now());
      window.setTimeout(() => setSavedToastAt(null), 2000);
      await Promise.all([refreshProviders(), refreshKeyStates()]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (saving) return;
    void persistConfig();
  }

  function handleCancel() {
    onClose?.();
  }

  function selectModelProviderDraft(providerId: string) {
    const normalizedProviderId = providerId === 'doubao' ? 'volcengine' : providerId;
    const provider = providers.find((item) => item.id === normalizedProviderId);
    setModelConfigDraft((current) => ({
      ...current,
      provider: normalizedProviderId,
      model: defaultModelForProvider(provider, current.model),
      baseUrl: provider?.baseUrl ?? current.baseUrl,
    }));
    if (normalizedProviderId !== 'openai_compatible') {
      setCustomProviderName('');
    }
    markDirty('provider', true);
    markDirty('model', true);
    markDirty('baseUrl', true);
    setApiKeyDraft('');
    setShowSavedModelKey(false);
    const keyState = keyStates.find((state) => state.providerId === normalizedProviderId);
    const nextSource = modelKeySourceForProvider(provider, keyState);
    setModelKeySource(nextSource);
    setModelEnvVarDraft(modelEnvVarForProvider(provider, keyState, nextSource));
  }

  function loadModelPresetIntoDraft(presetId: string) {
    if (presetId === '__draft__') return;
    const preset = modelPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setModelConfigDraft((current) => ({
      ...current,
      provider: (preset.config.provider ?? current.provider).trim(),
      model: (preset.config.model ?? current.model).trim(),
      baseUrl: (preset.config.baseUrl ?? current.baseUrl).trim(),
    }));
    const providerId = preset.config.provider.trim();
    const provider = providers.find((item) => item.id === providerId);
    const keyState = keyStates.find((state) => state.providerId === providerId);
    const nextSource = modelKeySourceForProvider(provider, keyState);
    setModelKeySource(nextSource);
    setModelEnvVarDraft(modelEnvVarForProvider(provider, keyState, nextSource));
    markDirty('provider', true);
    markDirty('model', true);
    markDirty('baseUrl', true);
  }

  async function handleSaveModelConfig() {
    const defaultName = [
      providers.find((p) => p.id === modelConfigDraft.provider)?.name ?? modelConfigDraft.provider,
      modelConfigDraft.model,
    ].filter(Boolean).join(' / ');

    await saveModelPresetDraft({
      requestName: () => requestModelPresetName(defaultName),
      ensureProvider: ensureCustomProvider,
      saveProviderKey: saveModelKeyDraftIfNeeded,
      saveProviderEnvVar: saveModelEnvVarDraftIfNeeded,
      savePreset: saveModelPreset,
      presetConfig: {
        provider: modelConfigDraft.provider.trim(),
        model: modelConfigDraft.model.trim(),
        baseUrl: (modelConfigDraft.baseUrl || '').trim(),
      },
    });
    await Promise.all([refreshProviders(), refreshKeyStates()]);
  }

  async function handleSetCurrentModelConfig() {
    setSaving(true);
    setSaveError(null);
    setModelKeyNotice('');
    try {
      const targetProviderId = await ensureCustomProvider();
      const resolvedProviderId = (targetProviderId ?? modelConfigDraft.provider).trim();
      await saveModelKeyDraftIfNeeded(resolvedProviderId);
      await saveModelEnvVarDraftIfNeeded(resolvedProviderId);
      const modelPatch = {
        provider: resolvedProviderId,
        model: modelConfigDraft.model.trim(),
        baseUrl: (modelConfigDraft.baseUrl || '').trim(),
      };
      const effectiveConfig = { ...config, ...modelPatch };
      if (scope === 'global') {
        await saveGlobalDefaults(effectiveConfig);
        setConfig(effectiveConfig);
      } else if (scope === 'currentThread' && activeThreadId) {
        await patchThreadConfigOverrides(activeThreadId, modelPatch);
        setConfig(effectiveConfig);
      } else if (scope === 'newThread') {
        try {
          window.localStorage.setItem('nexus.newThread.config', JSON.stringify(modelPatch));
        } catch {
          // silently ignore
        }
      }
      setDirtyFields((current) => {
        const next = { ...current };
        delete next.provider;
        delete next.model;
        delete next.baseUrl;
        delete next.apiKey;
        delete next.modelEnvVar;
        delete next.modelKeySource;
        return next;
      });
      setSavedToastAt(Date.now());
      setModelKeyNotice(locale === 'zh' ? '设置已应用。' : 'Settings applied.');
      window.setTimeout(() => setSavedToastAt(null), 2000);
      await Promise.all([refreshProviders(), refreshKeyStates()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      setModelKeyNotice(message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    setModelConfigDraft(modelConfigDraftFromConfig(config));
  }, [config.provider, config.model, config.baseUrl]);

  useEffect(() => {
    if (dirtyFields.modelKeySource || dirtyFields.modelEnvVar || dirtyFields.apiKey) return;
    const nextSource = modelKeySourceForProvider(selectedProvider, selectedKeyState);
    setModelKeySource(nextSource);
    setModelEnvVarDraft(modelEnvVarForProvider(selectedProvider, selectedKeyState, nextSource));
    setApiKeyDraft('');
    setShowSavedModelKey(false);
    setModelKeyNotice('');
  }, [
    modelConfigDraft.provider,
    selectedKeyState?.envVar,
    selectedKeyState?.source,
    selectedProvider?.apiKeyEnvVar,
    selectedProvider?.isLocal,
    dirtyFields.modelKeySource,
    dirtyFields.modelEnvVar,
    dirtyFields.apiKey,
  ]);

  useEffect(() => {
    fetch('/api/keys/env-vars')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { envVars?: string[] } | null) => setModelEnvVarRemoteOptions(data?.envVars ?? []))
      .catch(() => setModelEnvVarRemoteOptions([]));
  }, []);

  useEffect(() => {
    void hydrateFromServer(scope);
  }, [scope, activeThreadId]);

  const saveLabel = useMemo(() => t(locale, 'save'), [locale]);

  return {
    scope,
    setScope,
    scopeInfo,
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
    customProviderName,
    setCustomProviderName,
    selectModelProviderDraft,
    loadModelPresetIntoDraft,
    handleSaveModelConfig,
    handleSetCurrentModelConfig,
    saveLabel,
  };
}
