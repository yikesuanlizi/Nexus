// 设置面板：模型页（provider、API key、model preset、env var）
// P3：三区卡片布局（预设管理 / 密钥状态 / 默认模型配置）
import React from 'react';
import type { Locale, SecretSource, RunConfig } from '../../config/config.js';
import type { ApiKeyState, ModelPreset, ProviderEntry } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { DropdownSelect, type DropdownOption } from '../DropdownSelect.js';
import { modelPresetMatchesRunConfig, providerDropdownOptions, type ModelConfigDraft } from './shared.js';

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
  modelEnvBatchText: string;
  setModelEnvBatchText: React.Dispatch<React.SetStateAction<string>>;
  customProviderName: string;
  setCustomProviderName: React.Dispatch<React.SetStateAction<string>>;
  selectModelProviderDraft: (providerId: string) => void;
  loadModelPresetIntoDraft: (presetId: string) => void;
  handleBatchSetModelEnv: () => Promise<void>;
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
  modelEnvBatchText,
  setModelEnvBatchText,
  customProviderName,
  setCustomProviderName,
  selectModelProviderDraft,
  loadModelPresetIntoDraft,
  handleBatchSetModelEnv,
  handleSaveModelConfig,
  handleSetCurrentModelConfig,
  markDirty,
  dirtyFields,
}: ModelsPageProps) {
  const selectedProvider = providers.find((provider) => provider.id === modelConfigDraft.provider);
  const selectedKeyState = keyStates.find((state) => state.providerId === modelConfigDraft.provider);
  const matchedDraftPreset = modelPresets.find((preset) => modelPresetMatchesRunConfig(preset, { ...config, ...modelConfigDraft }));
  const [deletingPresetId, setDeletingPresetId] = React.useState('');
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
  const selectedPresetSummary = matchedDraftPreset
    ? [providers.find((provider) => provider.id === matchedDraftPreset.config.provider)?.name ?? matchedDraftPreset.config.provider, matchedDraftPreset.config.model].filter(Boolean).join(' / ')
    : '';

  async function handleDeleteMatchedPreset() {
    if (!matchedDraftPreset) return;
    const ok = window.confirm(locale === 'zh' ? `删除预设「${matchedDraftPreset.name}」？` : `Delete preset "${matchedDraftPreset.name}"?`);
    if (!ok) return;
    try {
      setDeletingPresetId(matchedDraftPreset.id);
      await deleteModelPreset(matchedDraftPreset.id);
    } finally {
      setDeletingPresetId('');
    }
  }

  return (
    <section className="settingsSection modelSettingsPanel" id="settings-agent">
      <h3>{locale === 'zh' ? '模型' : 'Model'}</h3>

      <div className="settingsCard modelPresetManagementCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'presetsTitle')}</h3>
        </div>
        <div className="formGrid">
          <label className="wideField">
            <DropdownSelect
              value={matchedDraftPreset?.id ?? '__draft__'}
              onChange={loadModelPresetIntoDraft}
              options={modelPresetDraftOptions}
            />
          </label>
          <button className="solidButton" onClick={() => void handleSaveModelConfig()}>
            {locale === 'zh' ? '保存为预设' : 'Save as preset'}
          </button>
        </div>
        {matchedDraftPreset ? (
          <div className="modelPresetActionRow">
            <div className="modelPresetActionText">
              <strong>{matchedDraftPreset.name}</strong>
              {selectedPresetSummary && selectedPresetSummary !== matchedDraftPreset.name ? <span>{selectedPresetSummary}</span> : null}
            </div>
            <div className="modelPresetActionButtons">
              <button className="textButton" type="button" onClick={() => loadModelPresetIntoDraft(matchedDraftPreset.id)}>
                {locale === 'zh' ? '载入' : 'Load'}
              </button>
              <button
                className="textButton danger"
                disabled={deletingPresetId === matchedDraftPreset.id}
                onClick={() => void handleDeleteMatchedPreset()}
                type="button"
              >
                {locale === 'zh' ? '删除' : 'Delete'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="settingsCard providerKeyCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'providerKeyTitle')}</h3>
        </div>
        <div className="modelKeyLayout">
          <label>
            {locale === 'zh' ? '来源' : 'Source'}
            <DropdownSelect<SecretSource>
              value={modelKeySource}
              onChange={(source) => {
                setModelKeySource(source);
                if (source === 'env' && !modelEnvVarDraft.trim()) {
                  setModelEnvVarDraft(selectedKeyState?.envVar || selectedProvider?.apiKeyEnvVar || '');
                }
                setApiKeyDraft('');
                setShowSavedModelKey(false);
                markDirty('modelKeySource', true);
              }}
              options={[
                { value: 'env', label: locale === 'zh' ? '环境变量' : 'Environment' },
                { value: 'config', label: locale === 'zh' ? '已保存密钥' : 'Saved key' },
              ]}
            />
          </label>
          {modelKeySource === 'env' ? (
            <div className="modelKeyEnvGroup">
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
              <label className="wideField">
                {locale === 'zh' ? '批量设置环境变量' : 'Batch env vars'}
                <textarea
                  value={modelEnvBatchText}
                  onChange={(event) => setModelEnvBatchText(event.target.value)}
                  placeholder={'OPENAI_API_KEY=sk-...\nDEEPSEEK_API_KEY=...'}
                  rows={3}
                />
              </label>
              <button className="textButton" type="button" onClick={() => void handleBatchSetModelEnv()} disabled={!modelEnvBatchText.trim()}>
                {locale === 'zh' ? '一次性设置环境变量' : 'Set env vars'}
              </button>
              {modelKeyNotice ? <p className="botNotice">{modelKeyNotice}</p> : null}
            </div>
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

      <div className="settingsCard scopeApplyCard">
        <div className="settingsCardHeader">
          <h3>{locale === 'zh' ? '默认模型' : 'Default model'}</h3>
        </div>
        <div className="formGrid modelSettingsList">
          <label className="wideField">
            {t(locale, 'provider')}
            <DropdownSelect className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')} value={modelConfigDraft.provider} onChange={selectModelProviderDraft} options={providerDropdownOptions(providers, locale)} />
          </label>
          {modelConfigDraft.provider === 'openai_compatible' ? (
            <label className="wideField">
              {locale === 'zh' ? '提供方名称' : 'Provider name'}
              <input
                placeholder={locale === 'zh' ? '例如：NVIDIA、OpenRouter、LMStudio' : 'e.g. NVIDIA, OpenRouter, LMStudio'}
                value={customProviderName}
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
    </section>
  );
}
