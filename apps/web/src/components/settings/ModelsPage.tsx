// 设置面板：模型页（provider、API key、model preset、env var）
// P3：三区卡片布局（预设管理 / 密钥状态 / 默认模型配置）
import React from 'react';
import type { Locale, SecretSource, RunConfig } from '../../config/config.js';
import type { ApiKeyState, ModelPreset, ProviderEntry } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { DropdownSelect, type DropdownOption } from '../DropdownSelect.js';
import { ConfirmPanel } from './ConfirmPanel.js';
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
  modelEnvVarDraft: string;
  setModelEnvVarDraft: React.Dispatch<React.SetStateAction<string>>;
  modelEnvVarOptions: string[];
  customProviderName: string;
  setCustomProviderName: React.Dispatch<React.SetStateAction<string>>;
  selectModelProviderDraft: (providerId: string) => void;
  loadModelPresetIntoDraft: (presetId: string) => void;
  handleSaveModelConfig: () => Promise<void>;
  handleSetCurrentModelConfig: () => Promise<void>;
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
  modelEnvVarDraft,
  setModelEnvVarDraft,
  modelEnvVarOptions,
  customProviderName,
  setCustomProviderName,
  selectModelProviderDraft,
  loadModelPresetIntoDraft,
  handleSaveModelConfig,
  handleSetCurrentModelConfig,
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
  const modelPresetDraftOptions: Array<DropdownOption<string>> = [
    { value: '__draft__', label: locale === 'zh' ? '当前编辑草稿' : 'Current draft' },
    ...modelPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      detail: [providers.find((provider) => provider.id === preset.config.provider)?.name ?? preset.config.provider, preset.config.model].filter(Boolean).join(' / '),
      current: matchedDraftPreset?.id === preset.id,
      action: {
        ariaLabel: locale === 'zh' ? `删除预设「${preset.name}」` : `Delete preset "${preset.name}"`,
        className: 'danger',
        disabled: deletingPresetId === preset.id,
        label: locale === 'zh' ? '删除' : 'Delete',
        onClick: () => setPendingDeletePreset(preset),
      },
    })),
  ];

  function modelKeyEnvStatus() {
    const envVar = modelEnvVarDraft.trim() || selectedProvider?.apiKeyEnvVar || selectedKeyState?.envVar;
    if (!envVar) {
      return locale === 'zh' ? '未指定环境变量' : 'No env var';
    }
    const boundEnvVar = selectedKeyState?.envVar || selectedProvider?.apiKeyEnvVar;
    if (selectedKeyState?.configured && selectedKeyState.source === 'env' && boundEnvVar === envVar) {
      return `${envVar} · ${locale === 'zh' ? '已配置' : 'configured'}`;
    }
    if (boundEnvVar === envVar) {
      return `${envVar} · ${locale === 'zh' ? '未发现' : 'missing'}`;
    }
    return `${envVar} · ${locale === 'zh' ? '保存后生效' : 'after saving'}`;
  }

  function savedModelKeyPlaceholder() {
    const hasSavedKey = selectedKeyState?.configured && selectedKeyState.source === 'config';
    if (!hasSavedKey) return locale === 'zh' ? '未保存密钥' : 'No saved key';
    if (showSavedModelKey) return selectedKeyState.masked ?? (locale === 'zh' ? '已保存密钥' : 'Saved key');
    return '••••••••••••••••';
  }

  const providerDirty = dirtyFields.provider ? 'fieldDirty' : '';
  const modelDirty = dirtyFields.model ? 'fieldDirty' : '';
  const baseUrlDirty = dirtyFields.baseUrl ? 'fieldDirty' : '';
  const envVarDirty = dirtyFields.modelEnvVar ? 'fieldDirty' : '';

  const applyButtonLabel = locale === 'zh' ? '应用设置' : 'Apply settings';
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
    <section className="settingsSection modelSettingsPanel" id="settings-agent">
      <h3>{locale === 'zh' ? '模型' : 'Model'}</h3>

      <div className="settingsCard scopeApplyCard">
        <div className="settingsCardHeader">
          <h3>{locale === 'zh' ? '默认模型' : 'Default model'}</h3>
        </div>
        <div className="formGrid modelSettingsList">
          <label className="wideField">
            {t(locale, 'provider')}
            <DropdownSelect className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')} value={providerSelectValue} onChange={selectModelProviderDraft} options={providerDropdownOptions(providers, locale)} />
          </label>
          {providerSelectValue === 'openai_compatible' ? (
            <label className="wideField">
              {locale === 'zh' ? '厂商名称' : 'Vendor name'}
              <input
                placeholder={locale === 'zh' ? '例如：ai.gitee、OpenRouter、LMStudio' : 'e.g. ai.gitee, OpenRouter, LMStudio'}
                value={displayedCustomProviderName}
                onChange={(event) => {
                  setCustomProviderName(event.target.value);
                  markDirty('provider', true);
                }}
              />
            </label>
          ) : null}
          <label className={`wideField ${modelDirty}`}>
            {t(locale, 'model')}
            <input
              value={modelConfigDraft.model}
              onChange={(event) => {
                setModelConfigDraft((current) => ({ ...current, model: event.target.value }));
                markDirty('model', true);
              }}
            />
          </label>
          <label className={`wideField ${baseUrlDirty}`}>
            {t(locale, 'baseUrl')}
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
        <div className="scopeApplyActions">
          <button
            className="solidButton"
            onClick={() => void handleSetCurrentModelConfig()}
          >
            {applyButtonLabel}
          </button>
        </div>
      </div>

      <div className="settingsCard providerKeyCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'providerKeyTitle')}</h3>
        </div>
        <div className={`modelKeyLayout ${modelKeySource === 'env' ? 'envMode' : 'savedMode'}`}>
          <label>
            {locale === 'zh' ? '来源' : 'Source'}
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
              <label className={envVarDirty}>
                {locale === 'zh' ? '环境变量名' : 'Env var name'}
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
              <p className="modelKeyStatusLine">{modelKeyEnvStatus()}</p>
              {modelKeyNotice ? <p className="botNotice">{modelKeyNotice}</p> : null}
            </>
          ) : (
            <div className="savedModelKeyField">
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
          )}
        </div>
      </div>

      <div className="settingsCard modelPresetManagementCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'presetsTitle')}</h3>
        </div>
        <div className="formGrid">
          <label className="wideField">
            <DropdownSelect
              className="modelPresetSelect"
              value={matchedDraftPreset?.id ?? '__draft__'}
              onChange={loadModelPresetIntoDraft}
              options={modelPresetDraftOptions}
            />
          </label>
          <button className="solidButton" onClick={() => void handleSaveModelConfig()}>
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
