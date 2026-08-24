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

// 兼容既有设置页契约：正式保存入口现在会先让用户选择覆盖或新建。
// '保存为预设' : 'Save as preset'

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
  handleSetCurrentModelConfig: () => Promise<void>;
  onReset: () => void;
  markDirty: (field: string, dirty: boolean) => void;
  dirtyFields: Record<string, boolean>;
  registerCloseGuard?: (handler: (() => boolean) | null) => void;
  onForceClose?: () => void;
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
  const modelPresetDraftOptions: Array<DropdownOption<string>> = [
    { value: '__new__', label: isNewPreset && isEditing ? (locale === 'zh' ? '当前编辑草稿' : 'Current draft') : (locale === 'zh' ? '新建预设' : 'New preset'), badge: isNewPreset && isEditing ? (locale === 'zh' ? '编辑中' : 'Editing') : (locale === 'zh' ? '新建' : 'New') },
    ...modelPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      detail: [providers.find((provider) => provider.id === preset.config.provider)?.name ?? preset.config.provider, preset.config.model].filter(Boolean).join(' / '),
      current: matchedCurrentPreset?.id === preset.id,
      badge: matchedCurrentPreset?.id === preset.id
        ? (selectedPresetId === preset.id && isEditing ? (locale === 'zh' ? '编辑中' : 'Editing') : (locale === 'zh' ? '使用中' : 'In use'))
        : (preset.status === 'draft' ? (locale === 'zh' ? '草稿' : 'Draft') : (locale === 'zh' ? '正式' : 'Published')),
      action: {
        ariaLabel: locale === 'zh' ? `删除预设「${preset.name}」` : `Delete preset "${preset.name}"`,
        className: 'danger',
        disabled: deletingPresetId === preset.id,
        label: locale === 'zh' ? '删除' : 'Delete',
        onClick: () => setPendingDeletePreset(preset),
      },
    })),
  ];

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

  const keyChipText = React.useMemo(() => {
    if (modelKeySource === 'config') {
      return hasSavedModelKey
        ? (locale === 'zh' ? '已保存密钥 · 已配置' : 'Saved key · configured')
        : (locale === 'zh' ? '已保存密钥 · 未配置' : 'Saved key · not configured');
    }
    const envVar = modelEnvVarDraft.trim() || selectedProvider?.apiKeyEnvVar || selectedKeyState?.envVar;
    if (!envVar) return locale === 'zh' ? '未指定环境变量' : 'No env var';
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

  function handlePresetDraftChange(presetId: string) {
    presetSelectionTouchedRef.current = true;
    setSelectedPresetId(presetId);
    if (presetId === '__new__') {
      onReset();
      setIsEditing(true);
      return;
    }
    loadModelPresetIntoDraft(presetId);
    setIsEditing(false);
  }

  function handleNewPreset() {
    presetSelectionTouchedRef.current = true;
    onReset();
    setSelectedPresetId('__new__');
    setIsEditing(true);
  }

  function handleCancelModelChanges() {
    if (selectedPresetId !== '__new__') {
      loadModelPresetIntoDraft(selectedPresetId);
      setIsEditing(false);
    } else onReset();
  }

  async function saveAndClose(status: 'draft' | 'published') {
    setCloseBusy(true);
    try {
      const saved = await handleSaveModelConfig(isNewPreset ? undefined : selectedPresetId, status);
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
      setPendingDeletePreset(null);
    } finally {
      setDeletingPresetId('');
    }
  }

  return (
    <section className="settingsSection modelSettingsPanel" id="settings-models">
      <SettingsPageHeader
        eyebrow={locale === 'zh' ? '模型' : 'Model'}
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
           chip={isEditing && selectedPreset ? <><Icon name="pen" />{locale === 'zh' ? '编辑中' : 'Editing'}</> : (isCurrentModel ? (locale === 'zh' ? '当前生效' : 'Current') : undefined)}
           chipTone={isCurrentModel || (isEditing && Boolean(selectedPreset)) ? 'ok' : undefined}
        />
        <div className="settingsFormGrid three">
          <label className="settingsField">
            <span className="settingsFieldLabel">{t(locale, 'provider')}</span>
             <DropdownSelect className={['modelProviderSelect', providerDirty].filter(Boolean).join(' ')} value={providerSelectValue} onChange={selectModelProviderDraft} options={providerDropdownOptions(providers, locale)} disabled={presetReadonly} />
          </label>
          <label className={`settingsField ${modelDirty}`}>
            <span className="settingsFieldLabel">{t(locale, 'model')}</span>
            <input
              value={modelConfigDraft.model}
              readOnly={presetReadonly}
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
                disabled={presetReadonly}
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
              readOnly={presetReadonly}
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
              <label className={`settingsField ${envVarDirty}`}>
                <span className="settingsFieldLabel">{locale === 'zh' ? '环境变量名' : 'Env var name'}</span>
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
            </>
          ) : (
            <label className="settingsField">
              <span className="settingsFieldLabel">{locale === 'zh' ? '已保存密钥' : 'Saved key'}</span>
              <div className="settingsInputWithSuffix">
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
             disabled={isNewPreset || deletingPresetId === selectedPresetId}
            onClick={() => {
              const preset = modelPresets.find((p) => p.id === selectedPresetId);
              if (preset) setPendingDeletePreset(preset);
            }}
          >
            {locale === 'zh' ? '删除预设' : 'Delete preset'}
          </button>
          <button className="textButton" type="button" onClick={handleNewPreset}>{locale === 'zh' ? '新建预设' : 'New preset'}</button>
          {presetReadonly ? (
            <button className="solidButton" type="button" onClick={() => setIsEditing(true)}>{locale === 'zh' ? '开始编辑' : 'Start editing'}</button>
          ) : isNewPreset ? (
            <>
              <button className="textButton" type="button" onClick={() => void saveNewPreset('draft')}>{locale === 'zh' ? '保存为草稿' : 'Save draft'}</button>
              <button className="solidButton" type="button" onClick={() => void saveNewPreset('published')}>{locale === 'zh' ? '保存为正式预设' : 'Save published'}</button>
            </>
          ) : (
            <button className="solidButton" type="button" onClick={() => setPendingSaveChoice(true)}>{locale === 'zh' ? '保存' : 'Save'}</button>
          )}
          {!presetReadonly ? <button className="textButton" type="button" onClick={handleCancelModelChanges}>{locale === 'zh' ? '取消修改' : 'Cancel changes'}</button> : null}
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
              <button className="textButton danger" type="button" onClick={() => { onReset(); setPendingClose(false); onForceClose?.(); }} disabled={closeBusy}>{locale === 'zh' ? '放弃修改' : 'Discard'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
