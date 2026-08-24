// 设置面板：模型页（provider、API key、model preset、env var）
// P3：三区卡片布局（预设管理 / 密钥状态 / 默认模型配置）
import React from 'react';
import type { Locale, SecretSource, RunConfig } from '../../config/config.js';
import type { ApiKeyState, ModelPreset, ProviderEntry } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { DropdownSelect, type DropdownOption } from '../DropdownSelect.js';
import { ModelBrandIcon } from '../ModelBrandIcon.js';
import { ConfirmPanel } from './ConfirmPanel.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
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
  handleSaveModelConfig: (presetId?: string, status?: 'draft' | 'published') => Promise<boolean>;
  resetModelDraft: () => void;
  handleSetCurrentModelConfig: () => Promise<void>;
  markDirty: (field: string, dirty: boolean) => void;
  dirtyFields: Record<string, boolean>;
  registerCloseGuard?: (handler: (() => boolean) | null) => void;
  onForceClose?: () => void;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

// 兼容既有设置页契约：正式保存入口现在会先让用户选择覆盖或新建。
// '保存为预设' : 'Save as preset'

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
  resetModelDraft,
  handleSetCurrentModelConfig,
  markDirty,
  dirtyFields,
  registerCloseGuard,
  onForceClose,
}: ModelsPageProps) {
  const selectedProvider = providers.find((provider) => provider.id === modelConfigDraft.provider);
  const selectedKeyState = keyStates.find((state) => state.providerId === modelConfigDraft.provider);
  const providerDisplay = normalizeModelConfigDraftForSettings(modelConfigDraft, providers);
  const providerSelectValue = providerDisplay.draft.provider;
  const displayedCustomProviderName = customProviderName || providerDisplay.customProviderName;
  const matchedCurrentPreset = modelPresets.find((preset) => modelPresetMatchesRunConfig(preset, config));
  const [deletingPresetId, setDeletingPresetId] = React.useState('');
  const [pendingDeletePreset, setPendingDeletePreset] = React.useState<ModelPreset | null>(null);
  const [selectedPresetId, setSelectedPresetId] = React.useState(() => matchedCurrentPreset?.id ?? '__new__');
  const [isEditing, setIsEditing] = React.useState(() => !matchedCurrentPreset);
  const [pendingSaveChoice, setPendingSaveChoice] = React.useState(false);
  const [pendingClose, setPendingClose] = React.useState(false);
  const [closeBusy, setCloseBusy] = React.useState(false);
  const presetSelectionTouchedRef = React.useRef(false);
  const [configurationCollapsed, setConfigurationCollapsed] = React.useState(false);
  const selectedPreset = modelPresets.find((preset) => preset.id === selectedPresetId);
  const isNewPreset = selectedPresetId === '__new__';
  const presetReadonly = Boolean(selectedPreset && !isEditing);
  const hasUnsavedChanges = Object.values(dirtyFields).some(Boolean);

  React.useEffect(() => {
    if (selectedPresetId === '__new__' && !presetSelectionTouchedRef.current && !hasUnsavedChanges) {
      const current = modelPresets.find((preset) => modelPresetMatchesRunConfig(preset, config))
        ?? modelPresets.find((preset) => modelPresetMatchesRunConfig(preset, { ...config, ...modelConfigDraft }));
      if (current) setSelectedPresetId(current.id);
    }
  }, [config, hasUnsavedChanges, modelConfigDraft, modelPresets, selectedPresetId]);

  React.useEffect(() => {
    if (!registerCloseGuard) return;
    const guard = () => {
      if (!hasUnsavedChanges) return false;
      setPendingClose(true);
      return true;
    };
    registerCloseGuard(guard);
    return () => registerCloseGuard(null);
  }, [hasUnsavedChanges, registerCloseGuard]);
  const modelPresetDraftOptions: Array<DropdownOption<string>> = [
    {
      value: '__new__',
      label: isNewPreset && isEditing ? (locale === 'zh' ? '当前编辑草稿' : 'Current draft') : (locale === 'zh' ? '新建预设' : 'New preset'),
      icon: <ModelBrandIcon model={modelConfigDraft.model} provider={modelConfigDraft.provider} />,
      badge: isNewPreset && isEditing ? (locale === 'zh' ? '编辑中' : 'Editing') : (locale === 'zh' ? '新建' : 'New'),
    },
    ...modelPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      detail: [providers.find((provider) => provider.id === preset.config.provider)?.name ?? preset.config.provider, preset.config.model].filter(Boolean).join(' / '),
      icon: <ModelBrandIcon model={preset.config.model} provider={preset.config.provider} />,
      badge: matchedCurrentPreset?.id === preset.id
        ? (selectedPresetId === preset.id && isEditing ? (locale === 'zh' ? '编辑中' : 'Editing') : (locale === 'zh' ? '使用中' : 'In use'))
        : (preset.status === 'draft' ? (locale === 'zh' ? '草稿' : 'Draft') : (locale === 'zh' ? '正式' : 'Published')),
      current: matchedCurrentPreset?.id === preset.id,
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
    if (hasConfiguredModelEnvVar) {
      return `${envVar} · ${locale === 'zh' ? '已配置' : 'configured'}`;
    }
    if (boundEnvVar === envVar) {
      return `${envVar} · ${locale === 'zh' ? '未发现' : 'missing'}`;
    }
    return `${envVar} · ${locale === 'zh' ? '保存后生效' : 'after saving'}`;
  }

  function savedModelKeyPlaceholder() {
    if (!hasSavedModelKey) return locale === 'zh' ? '未保存密钥' : 'No saved key';
    if (showSavedModelKey) return selectedKeyState?.masked ?? (locale === 'zh' ? '已保存密钥' : 'Saved key');
    return '••••••••••••••••';
  }

  const providerDirty = dirtyFields.provider ? 'fieldDirty' : '';
  const modelDirty = dirtyFields.model ? 'fieldDirty' : '';
  const baseUrlDirty = dirtyFields.baseUrl ? 'fieldDirty' : '';
  const envVarDirty = dirtyFields.modelEnvVar ? 'fieldDirty' : '';

  const applyButtonLabel = locale === 'zh' ? '应用设置' : 'Apply settings';
  function handlePresetDraftChange(presetId: string) {
    presetSelectionTouchedRef.current = true;
    setSelectedPresetId(presetId);
    if (presetId === '__new__') {
      resetModelDraft();
      setIsEditing(true);
      return;
    }
    loadModelPresetIntoDraft(presetId);
    setIsEditing(false);
  }

  function handleNewPreset() {
    presetSelectionTouchedRef.current = true;
    resetModelDraft();
    setSelectedPresetId('__new__');
    setIsEditing(true);
  }

  function handleCancelModelChanges() {
    if (selectedPresetId !== '__new__') {
      loadModelPresetIntoDraft(selectedPresetId);
      setIsEditing(false);
      return;
    }
    resetModelDraft();
  }

  async function saveAndClose(status: 'draft' | 'published') {
    setCloseBusy(true);
    try {
      const targetId = isNewPreset ? undefined : selectedPresetId;
      const saved = await handleSaveModelConfig(targetId, status);
      if (!saved) return;
      setPendingClose(false);
      onForceClose?.();
    } finally {
      setCloseBusy(false);
    }
  }

  async function savePresetChoice(mode: 'overwrite' | 'new') {
    setCloseBusy(true);
    try {
      const saved = await handleSaveModelConfig(mode === 'overwrite' ? selectedPresetId : undefined, 'published');
      if (!saved) return;
      setPendingSaveChoice(false);
      setIsEditing(false);
    } finally {
      setCloseBusy(false);
    }
  }

  async function saveNewPreset(status: 'draft' | 'published') {
    const saved = await handleSaveModelConfig(undefined, status);
    if (saved) setIsEditing(false);
  }

  async function handleDeletePreset() {
    if (!pendingDeletePreset) return;
    try {
      setDeletingPresetId(pendingDeletePreset.id);
      await deleteModelPreset(pendingDeletePreset.id);
      if (selectedPresetId === pendingDeletePreset.id) {
        setSelectedPresetId('__new__');
        resetModelDraft();
        setIsEditing(true);
      }
      setPendingDeletePreset(null);
    } finally {
      setDeletingPresetId('');
    }
  }

  return (
    <section className="settingsSection modelSettingsPanel" id="settings-agent">
      <SettingsPageHeader
        eyebrow={text(locale, '模型', 'Model')}
        title={text(locale, '模型', 'Model')}
        actions={[{
          label: configurationCollapsed ? (locale === 'zh' ? '展开配置' : 'Expand') : (locale === 'zh' ? '收起配置' : 'Collapse'),
          title: configurationCollapsed ? (locale === 'zh' ? '展开模型配置' : 'Expand model configuration') : (locale === 'zh' ? '收起模型配置' : 'Collapse model configuration'),
          onClick: () => setConfigurationCollapsed((current) => !current),
        }]}
      />

      {!configurationCollapsed ? <div className="settingsCard modelConfigurationCard">
        <div className="modelConfigurationBlock defaultModelConfigurationBlock">
        <div className="settingsCardHeader">
          <h3>{locale === 'zh' ? '默认模型' : 'Default model'} {isEditing && selectedPreset ? <span className="modelEditingBadge"><Icon name="pen" />{locale === 'zh' ? '编辑中' : 'Editing'}</span> : null}</h3>
        </div>
        <div className="formGrid modelSettingsList">
          <label className="wideField">
            {t(locale, 'provider')}
            <DropdownSelect
              className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')}
              value={providerSelectValue}
              onChange={selectModelProviderDraft}
              disabled={presetReadonly}
              options={providerDropdownOptions(providers, locale).map((option) => ({
                ...option,
                icon: <ModelBrandIcon provider={option.value} />,
              }))}
            />
          </label>
          {providerSelectValue === 'openai_compatible' ? (
            <label className="wideField">
              {locale === 'zh' ? '厂商名称' : 'Vendor name'}
              <input
                placeholder={locale === 'zh' ? '例如：ai.gitee、OpenRouter、LMStudio' : 'e.g. ai.gitee, OpenRouter, LMStudio'}
                value={displayedCustomProviderName}
                disabled={presetReadonly}
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
              readOnly={presetReadonly}
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
              readOnly={presetReadonly}
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
        <div aria-hidden="true" className="modelConfigurationDivider" />
        <div className="modelConfigurationBlock providerKeyCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'providerKeyTitle')}</h3>
        </div>
        <div className={`modelCredentialLayout ${modelKeySource === 'env' ? 'envMode' : 'savedMode'}`}>
          <label>
            {locale === 'zh' ? '来源' : 'Source'}
            <DropdownSelect<SecretSource>
              value={modelKeySource}
              disabled={presetReadonly}
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
                  readOnly={presetReadonly}
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
              <p className={`modelKeyStatusLine ${hasConfiguredModelEnvVar ? 'configured' : ''}`}>{modelKeyEnvStatus()}</p>
              {modelKeyNotice ? <p className="botNotice">{modelKeyNotice}</p> : null}
            </>
          ) : (
            <div className="savedModelKeyField">
              <input
                placeholder={savedModelKeyPlaceholder()}
                value={apiKeyDraft}
                readOnly={presetReadonly}
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
      </div> : null}

      <div className="settingsCard modelPresetManagementCard">
        <div className="settingsCardHeader">
          <h3>{t(locale, 'presetsTitle')} <span className="modelPresetCount">{modelPresets.length}</span></h3>
        </div>
        <div className="modelPresetEditorRow">
          <label className="wideField">
            <DropdownSelect
              className="modelPresetSelect"
              value={selectedPresetId}
              onChange={handlePresetDraftChange}
              options={modelPresetDraftOptions}
            />
          </label>
          <div className="modelPresetActionRow">
            <button className="textButton" type="button" onClick={handleNewPreset}>{locale === 'zh' ? '新建预设' : 'New preset'}</button>
            {presetReadonly ? (
              <button className="solidButton" type="button" onClick={() => setIsEditing(true)}>
                {locale === 'zh' ? '开始编辑' : 'Start editing'}
              </button>
            ) : isNewPreset ? (
              <>
                <button className="textButton" type="button" onClick={() => void saveNewPreset('draft')}>
                  {locale === 'zh' ? '保存为草稿' : 'Save draft'}
                </button>
                <button className="solidButton" type="button" onClick={() => void saveNewPreset('published')}>
                  {locale === 'zh' ? '保存为正式预设' : 'Save published'}
                </button>
              </>
            ) : (
              <button className="solidButton" type="button" onClick={() => setPendingSaveChoice(true)}>
                {locale === 'zh' ? '保存' : 'Save'}
              </button>
            )}
            {!presetReadonly ? <button className="textButton" type="button" onClick={handleCancelModelChanges}>{locale === 'zh' ? '取消修改' : 'Cancel changes'}</button> : null}
          </div>
        </div>
        <p className="modelPresetCurrentHint">{locale === 'zh' ? `当前使用模型：${providers.find((provider) => provider.id === config.provider)?.name ?? config.provider} / ${config.model}` : `In use: ${providers.find((provider) => provider.id === config.provider)?.name ?? config.provider} / ${config.model}`}</p>
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
      {pendingSaveChoice ? (
        <div className="presetDecisionLayer" role="presentation">
          <button className="settingsConfirmScrim" aria-label={locale === 'zh' ? '取消' : 'Cancel'} onClick={() => setPendingSaveChoice(false)} type="button" />
          <section className="presetDecisionPanel" role="dialog" aria-modal="true" aria-labelledby="preset-save-title">
            <h3 id="preset-save-title">{locale === 'zh' ? '如何保存这个预设？' : 'How should this preset be saved?'}</h3>
            <p>{locale === 'zh' ? '当前预设保持不变，或将修改另存为新的模型配置。' : 'Keep the current preset, or save the changes as a new model configuration.'}</p>
            <div className="settingsConfirmActions">
              <button className="textButton" type="button" onClick={() => setPendingSaveChoice(false)} disabled={closeBusy}>{locale === 'zh' ? '取消' : 'Cancel'}</button>
              <button className="textButton" type="button" onClick={() => void savePresetChoice('new')} disabled={closeBusy}>{locale === 'zh' ? '新建模型配置' : 'Save as new'}</button>
              <button className="solidButton" type="button" onClick={() => void savePresetChoice('overwrite')} disabled={closeBusy}>{locale === 'zh' ? '覆盖当前预设' : 'Overwrite current'}</button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingClose ? (
        <div className="presetDecisionLayer" role="presentation">
          <button className="settingsConfirmScrim" aria-label={locale === 'zh' ? '继续编辑' : 'Keep editing'} onClick={() => setPendingClose(false)} type="button" />
          <section className="presetDecisionPanel" role="dialog" aria-modal="true" aria-labelledby="preset-close-title">
            <h3 id="preset-close-title">{locale === 'zh' ? '修改尚未保存' : 'Unsaved changes'}</h3>
            <p>{locale === 'zh' ? '关闭前请选择保存为草稿、保存为正式预设，或放弃修改。' : 'Choose whether to save a draft, publish the preset, or discard the changes.'}</p>
            <div className="settingsConfirmActions">
              <button className="textButton" type="button" onClick={() => setPendingClose(false)} disabled={closeBusy}>{locale === 'zh' ? '继续编辑' : 'Keep editing'}</button>
              <button className="textButton" type="button" onClick={() => void saveAndClose('draft')} disabled={closeBusy}>{locale === 'zh' ? '保存为草稿' : 'Save draft'}</button>
              <button className="solidButton" type="button" onClick={() => void saveAndClose('published')} disabled={closeBusy}>{locale === 'zh' ? '保存为正式预设' : 'Publish'}</button>
              <button className="textButton danger" type="button" onClick={() => { resetModelDraft(); setPendingClose(false); onForceClose?.(); }} disabled={closeBusy}>{locale === 'zh' ? '放弃修改' : 'Discard'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
