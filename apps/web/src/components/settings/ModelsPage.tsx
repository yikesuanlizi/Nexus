// 设置面板：模型页（provider、API key、model preset、env var）
// P3：按设置工作台样例结构组织：page header + section + chip + form-grid
import React from 'react';
import type { Locale, SecretSource, RunConfig } from '../../config/config.js';
import type { ApiKeyState, ModelPreset, ProviderEntry } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { DropdownSelect, type DropdownOption } from '../DropdownSelect.js';
import { ConfirmPanel } from './ConfirmPanel.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
import { SectionHeader } from './SectionHeader.js';
import { modelPresetMatchesRunConfig, normalizeModelConfigDraftForSettings, providerDropdownOptions, type ModelConfigDraft } from './shared.js';

export interface ModelsPageProps {
  locale: Locale;
  config: RunConfig;
  modelConfigDraft: ModelConfigDraft;
  setModelConfigDraft: React.Dispatch<React.SetStateAction<ModelConfigDraft>>;
  providers: ProviderEntry[];
  keyStates: ApiKeyState[];
  modelPresets: ModelPreset[];
  deleteModelPreset: (presetId: string) => Promise<void>;
  apiKeyDraft: string;
  setApiKeyDraft: React.Dispatch<React.SetStateAction<string>>;
  modelKeySource: SecretSource;
  setModelKeySource: React.Dispatch<React.SetStateAction<SecretSource>>;
  showSavedModelKey: boolean;
  setShowSavedModelKey: React.Dispatch<React.SetStateAction<boolean>>;
  modelKeyNotice: string;
  hasSavedModelKey: boolean;
  hasConfiguredModelEnvVar: boolean;
  modelEnvVarDraft: string;
  setModelEnvVarDraft: React.Dispatch<React.SetStateAction<string>>;
  modelEnvVarOptions: string[];
  customProviderName: string;
  setCustomProviderName: React.Dispatch<React.SetStateAction<string>>;
  selectModelProviderDraft: (providerId: string) => void;
  loadModelPresetIntoDraft: (presetId: string) => void;
  handleSaveModelConfig: () => Promise<void>;
  handleSetCurrentModelConfig: () => Promise<void>;
  onReset: () => void;
  markDirty: (field: string, dirty: boolean) => void;
  dirtyFields: Record<string, boolean>;
}

export function ModelsPage({
  locale,
  config,
  modelConfigDraft,
  setModelConfigDraft,
  providers,
  keyStates,
  modelPresets,
  deleteModelPreset,
  apiKeyDraft,
  setApiKeyDraft,
  modelKeySource,
  setModelKeySource,
  showSavedModelKey,
  setShowSavedModelKey,
  modelKeyNotice,
  hasSavedModelKey,
  hasConfiguredModelEnvVar,
  modelEnvVarDraft,
  setModelEnvVarDraft,
  modelEnvVarOptions,
  customProviderName,
  setCustomProviderName,
  selectModelProviderDraft,
  loadModelPresetIntoDraft,
  handleSaveModelConfig,
  handleSetCurrentModelConfig,
  onReset,
  markDirty,
  dirtyFields,
}: ModelsPageProps) {
  const selectedProvider = providers.find((provider) => provider.id === modelConfigDraft.provider);
  const selectedKeyState = keyStates.find((state) => state.providerId === modelConfigDraft.provider);
  const providerDisplay = normalizeModelConfigDraftForSettings(modelConfigDraft, providers);
  const providerSelectValue = providerDisplay.draft.provider;
  const displayedCustomProviderName = customProviderName || providerDisplay.customProviderName;
  const matchedDraftPreset = modelPresets.find((preset) => modelPresetMatchesRunConfig(preset, { ...config, ...modelConfigDraft }));
  const [deletingPresetId, setDeletingPresetId] = React.useState('');
  const [pendingDeletePreset, setPendingDeletePreset] = React.useState<ModelPreset | null>(null);
  const [selectedPresetId, setSelectedPresetId] = React.useState('__draft__');
  const modelPresetDraftOptions: Array<DropdownOption<string>> = [
    { value: '__draft__', label: locale === 'zh' ? '当前编辑草稿' : 'Current draft' },
    ...modelPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      detail: [providers.find((provider) => provider.id === preset.config.provider)?.name ?? preset.config.provider, preset.config.model].filter(Boolean).join(' / '),
      current: matchedDraftPreset?.id === preset.id,
    })),
  ];

  function modelKeyEnvStatus() {
    const envVar = modelEnvVarDraft.trim() || selectedProvider?.apiKeyEnvVar || selectedKeyState?.envVar;
    if (!envVar) {
      return locale === 'zh' ? '未指定环境变量' : 'No env var';
    }
    const boundEnvVar = selectedKeyState?.envVar || selectedProvider?.apiKeyEnvVar;
    if (hasConfiguredModelEnvVar) {
      return `${envVar} · ${locale === 'zh' ? '已配置' : 'configured'}`;
    }
    if (boundEnvVar === envVar) {
      return `${envVar} · ${locale === 'zh' ? '未发现' : 'missing'}`;
    }
    return `${envVar} · ${locale === 'zh' ? '保存后生效' : 'after saving'}`;
  }

  const keyChipText = React.useMemo(() => {
    if (modelKeySource === 'config') {
      return hasSavedModelKey
        ? (locale === 'zh' ? '已保存密钥 · 已配置' : 'Saved key · configured')
        : (locale === 'zh' ? '已保存密钥 · 未配置' : 'Saved key · not configured');
    }
    const envVar = modelEnvVarDraft.trim() || selectedProvider?.apiKeyEnvVar || selectedKeyState?.envVar;
    if (!envVar) return locale === 'zh' ? '未指定环境变量' : 'No env var';
    const boundEnvVar = selectedKeyState?.envVar || selectedProvider?.apiKeyEnvVar;
    const configured = hasConfiguredModelEnvVar;
    return `${envVar} · ${configured ? (locale === 'zh' ? '已配置' : 'configured') : (locale === 'zh' ? '未发现' : 'missing')}`;
  }, [modelKeySource, selectedKeyState, selectedProvider, modelEnvVarDraft, locale, hasSavedModelKey, hasConfiguredModelEnvVar]);

  function savedModelKeyPlaceholder() {
    if (!hasSavedModelKey) return locale === 'zh' ? '未保存密钥' : 'No saved key';
    if (showSavedModelKey) return selectedKeyState?.masked ?? (locale === 'zh' ? '已保存密钥' : 'Saved key');
    return '••••••••••••••••';
  }

  const providerDirty = dirtyFields.provider ? 'fieldDirty' : '';
  const modelDirty = dirtyFields.model ? 'fieldDirty' : '';
  const baseUrlDirty = dirtyFields.baseUrl ? 'fieldDirty' : '';
  const envVarDirty = dirtyFields.modelEnvVar ? 'fieldDirty' : '';

  const isCurrentModel = React.useMemo(() => {
    return (
      config.provider === modelConfigDraft.provider &&
      config.model === modelConfigDraft.model &&
      config.baseUrl === modelConfigDraft.baseUrl
    );
  }, [config, modelConfigDraft]);

  React.useEffect(() => {
    if (selectedPresetId === '__draft__') return;
    const selectedPreset = modelPresets.find((preset) => preset.id === selectedPresetId);
    if (!selectedPreset || !modelPresetMatchesRunConfig(selectedPreset, { ...config, ...modelConfigDraft })) {
      setSelectedPresetId('__draft__');
    }
  }, [
    selectedPresetId,
    modelPresets,
    config.provider,
    config.model,
    config.baseUrl,
    modelConfigDraft.provider,
    modelConfigDraft.model,
    modelConfigDraft.baseUrl,
  ]);

  function handlePresetDraftChange(presetId: string) {
    setSelectedPresetId(presetId);
    loadModelPresetIntoDraft(presetId);
  }

  async function handleDeletePreset() {
    if (!pendingDeletePreset) return;
    try {
      setDeletingPresetId(pendingDeletePreset.id);
      await deleteModelPreset(pendingDeletePreset.id);
      setPendingDeletePreset(null);
    } finally {
      setDeletingPresetId('');
    }
  }

  return (
    <section className="settingsSection modelSettingsPanel" id="settings-models">
      <SettingsPageHeader
        eyebrow="RUNTIME"
        title={locale === 'zh' ? '模型' : 'Model'}
        actions={[
          {
            label: locale === 'zh' ? '恢复草稿' : 'Restore draft',
            title: locale === 'zh' ? '恢复到当前生效配置' : 'Restore to current active config',
            onClick: onReset,
          },
          {
            label: locale === 'zh' ? '应用设置' : 'Apply settings',
            primary: true,
            onClick: () => void handleSetCurrentModelConfig(),
          },
        ]}
      />

      <div className="settingsSectionBlock">
        <SectionHeader
          title={locale === 'zh' ? '默认模型' : 'Default model'}
          chip={isCurrentModel ? (locale === 'zh' ? '当前生效' : 'Current') : undefined}
          chipTone={isCurrentModel ? 'ok' : undefined}
        />
        <div className="settingsFormGrid three">
          <label className="settingsField">
            <span className="settingsFieldLabel">{t(locale, 'provider')}</span>
            <DropdownSelect className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')} value={providerSelectValue} onChange={selectModelProviderDraft} options={providerDropdownOptions(providers, locale)} />
          </label>
          <label className={`settingsField ${modelDirty}`}>
            <span className="settingsFieldLabel">{t(locale, 'model')}</span>
            <input
              value={modelConfigDraft.model}
              onChange={(event) => {
                setModelConfigDraft((current) => ({ ...current, model: event.target.value }));
                markDirty('model', true);
              }}
            />
          </label>
          {providerSelectValue === 'openai_compatible' ? (
            <label className="settingsField">
              <span className="settingsFieldLabel">{locale === 'zh' ? '厂商名称' : 'Vendor name'}</span>
              <input
                placeholder={locale === 'zh' ? '例如：ai.gitee、OpenRouter、LMStudio' : 'e.g. ai.gitee, OpenRouter, LMStudio'}
                value={displayedCustomProviderName}
                onChange={(event) => {
                  setCustomProviderName(event.target.value);
                  markDirty('provider', true);
                }}
              />
            </label>
          ) : (
            <label className="settingsField">
              <span className="settingsFieldLabel">{locale === 'zh' ? '厂商名称' : 'Vendor name'}</span>
              <input readOnly value={selectedProvider?.name ?? ''} tabIndex={-1} />
            </label>
          )}
          <label className={`settingsField wide ${baseUrlDirty}`}>
            <span className="settingsFieldLabel">{t(locale, 'baseUrl')}</span>
            <input
              placeholder="provider default"
              value={modelConfigDraft.baseUrl}
              onChange={(event) => {
                setModelConfigDraft((current) => ({ ...current, baseUrl: event.target.value }));
                markDirty('baseUrl', true);
              }}
            />
          </label>
        </div>
      </div>

      <div className="settingsSectionBlock">
        <SectionHeader
          title={t(locale, 'providerKeyTitle')}
          chip={keyChipText}
          chipTone={(modelKeySource === 'config' ? hasSavedModelKey : hasConfiguredModelEnvVar) ? 'ok' : undefined}
        />
        <div className="settingsFormGrid three key">
          <label className="settingsField">
            <span className="settingsFieldLabel">{locale === 'zh' ? '来源' : 'Source'}</span>
            <DropdownSelect<SecretSource>
              value={modelKeySource}
              onChange={(source) => {
                markDirty('modelKeySource', true);
                setModelKeySource(source);
                if (source === 'env' && !modelEnvVarDraft.trim()) {
                  setModelEnvVarDraft(selectedKeyState?.envVar || selectedProvider?.apiKeyEnvVar || '');
                }
                setApiKeyDraft('');
                setShowSavedModelKey(false);
              }}
              options={[
                { value: 'env', label: locale === 'zh' ? '环境变量' : 'Environment' },
                { value: 'config', label: locale === 'zh' ? '已保存密钥' : 'Saved key' },
              ]}
            />
          </label>
          {modelKeySource === 'env' ? (
            <>
              <label className={`settingsField ${envVarDirty}`}>
                <span className="settingsFieldLabel">{locale === 'zh' ? '环境变量名' : 'Env var name'}</span>
                <input
                  list="model-env-var-options"
                  value={modelEnvVarDraft}
                  onChange={(event) => {
                    setModelEnvVarDraft(event.target.value);
                    markDirty('modelEnvVar', true);
                  }}
                  placeholder={selectedProvider?.apiKeyEnvVar || 'OPENAI_API_KEY'}
                />
              </label>
              <datalist id="model-env-var-options">
                {modelEnvVarOptions.map((envVar) => <option key={envVar} value={envVar} />)}
              </datalist>
            </>
          ) : (
            <label className="settingsField">
              <span className="settingsFieldLabel">{locale === 'zh' ? '已保存密钥' : 'Saved key'}</span>
              <div className="settingsInputWithSuffix">
                <input
                  placeholder={savedModelKeyPlaceholder()}
                  value={apiKeyDraft}
                  onChange={(event) => {
                    setApiKeyDraft(event.target.value);
                    markDirty('apiKey', true);
                  }}
                  type={showSavedModelKey ? 'text' : 'password'}
                />
                <button
                  aria-label={showSavedModelKey ? (locale === 'zh' ? '隐藏密钥' : 'Hide key') : (locale === 'zh' ? '显示密钥' : 'Show key')}
                  className="miniIconButton"
                  onClick={() => setShowSavedModelKey((current) => !current)}
                  type="button"
                >
                  <Icon name={showSavedModelKey ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </label>
          )}
          <div className="settingsField settingsFieldInlineEnd settingsRefreshField">
            <button
              className="miniIconButton settingsRefreshButton"
              type="button"
              title={locale === 'zh' ? '应用并刷新密钥状态' : 'Apply and refresh key status'}
              aria-label={locale === 'zh' ? '应用并刷新密钥状态' : 'Apply and refresh key status'}
              onClick={() => void handleSetCurrentModelConfig()}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </div>
        {modelKeyNotice ? <p className="settingsNotice">{modelKeyNotice}</p> : null}
      </div>

      <div className="settingsSectionBlock">
        <SectionHeader title={t(locale, 'presetsTitle')} />
        <div className="settingsPresetRow">
          <DropdownSelect
            className="modelPresetSelect"
            value={selectedPresetId}
            onChange={handlePresetDraftChange}
            options={modelPresetDraftOptions}
          />
          <button
            className="textButton danger"
            type="button"
            disabled={selectedPresetId === '__draft__' || deletingPresetId === selectedPresetId}
            onClick={() => {
              const preset = modelPresets.find((p) => p.id === selectedPresetId);
              if (preset) setPendingDeletePreset(preset);
            }}
          >
            {locale === 'zh' ? '删除预设' : 'Delete preset'}
          </button>
          <button className="solidButton" type="button" onClick={() => void handleSaveModelConfig()}>
            {locale === 'zh' ? '保存为预设' : 'Save as preset'}
          </button>
        </div>
      </div>

      <ConfirmPanel
        locale={locale}
        open={Boolean(pendingDeletePreset)}
        title={locale === 'zh' ? '删除这个预设？' : 'Delete this preset?'}
        description={pendingDeletePreset ? (locale === 'zh'
          ? `「${pendingDeletePreset.name}」会从预设列表中移除。`
          : `"${pendingDeletePreset.name}" will be removed from the preset list.`) : undefined}
        confirmLabel={locale === 'zh' ? '删除' : 'Delete'}
        cancelLabel={locale === 'zh' ? '取消' : 'Cancel'}
        tone="danger"
        busy={Boolean(pendingDeletePreset && deletingPresetId === pendingDeletePreset.id)}
        onCancel={() => setPendingDeletePreset(null)}
        onConfirm={() => void handleDeletePreset()}
      />
    </section>
  );
}
