import React from 'react';
import type { RunConfig } from '../config/config.js';
import { runProfileLabel } from '../config/runProfiles.js';
import { extractUrlTokens, summarizeUrlToken } from '../features/input/composerInput.js';
import type { SlashCommandOption } from '../features/slash/slashCommands.js';
import { resizeTextareaToContent } from '../shared/composer.js';
import { t } from '../shared/i18n.js';
import { DropdownSelect } from './DropdownSelect.js';
import { Icon } from './Icon.js';
import type { RightPaneTab } from './RightPane.js';
import type { BotConfig, BotStatus, ModelPreset } from '../shared/types.js';

export type RemoteAssistantPlatform = 'weixin' | 'dingtalk';

// 输入栏选项类型：普通命令 / 插入 Skill / 启用 MCP。
// Composer palette option type: plain command / insert Skill / enable MCP.
export type PaletteOption = SlashCommandOption & (
  | { action?: 'command' }
  | { action: 'insert_skill'; skillName: string; hideCommand: true }
  | { action: 'enable_mcp'; mcpId: string; hideCommand: true }
);

// 输入历史在 localStorage 中的键。
// Storage key for composer history in localStorage.
export const COMPOSER_HISTORY_STORAGE_KEY = 'nexus.composer.history.v1';
// 输入草稿在 localStorage 中的键（用于刷新后恢复）。
// Storage key for composer draft in localStorage (used to restore after refresh).
export const COMPOSER_DRAFT_STORAGE_KEY = 'nexus.composer.draft.v1';
// 保留的历史条目上限。
// Maximum number of history entries to keep.
const COMPOSER_HISTORY_LIMIT = 100;

export function ComposerBar({
  activeSlashOption,
  activeThreadId,
  applyModelPreset,
  botConfig,
  botStatus,
  busy,
  actionBusy = false,
  composerInputRef,
  config,
  draggingImage,
  filteredSlashOptions,
  handleDrop,
  handleFileSelect,
  handlePaste,
  images,
  input,
  modelPresets,
  openRemoteAssistants,
  removeImage,
  rightPaneTab,
  rightPaneVisible,
  selectSlashOption,
  setActiveSlashOption,
  setConfig,
  setDraggingImage,
  setInput,
  slashVisible,
  stopTurn,
  submitComposer,
  workflowMode = false,
  workflowPlanning = false,
}: {
  activeSlashOption: SlashCommandOption | null;
  activeThreadId: string;
  applyModelPreset: (preset: ModelPreset) => void;
  botConfig: BotConfig | null;
  botStatus: BotStatus | null;
  busy: boolean;
  actionBusy?: boolean;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  config: RunConfig;
  draggingImage: boolean;
  filteredSlashOptions: PaletteOption[];
  handleDrop: (event: React.DragEvent<HTMLElement>) => void;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  images: Array<{ name: string; dataUrl: string }>;
  input: string;
  modelPresets: ModelPreset[];
  openRemoteAssistants: (platform: RemoteAssistantPlatform) => void;
  removeImage: (index: number) => void;
  rightPaneTab: RightPaneTab;
  rightPaneVisible: boolean;
  selectSlashOption: (option: PaletteOption) => void;
  setActiveSlashOption: (option: SlashCommandOption | null) => void;
  setConfig: React.Dispatch<React.SetStateAction<RunConfig>>;
  setDraggingImage: (dragging: boolean) => void;
  setInput: (value: string) => void;
  slashVisible: boolean;
  stopTurn: () => Promise<void>;
  submitComposer: () => Promise<void>;
  workflowMode?: boolean;
  workflowPlanning?: boolean;
}) {
  const historyRef = React.useRef<string[]>([]);
  const [historyCursor, setHistoryCursor] = React.useState<number | null>(null);
  const [assistantMenuOpen, setAssistantMenuOpen] = React.useState(false);
  const remoteBinding = remoteBindingView(botConfig, botStatus, activeThreadId, config.locale);
  const matchedModelPreset = modelPresets.find((preset) => modelPresetMatchesConfig(preset, config));
  const modelPresetValue = matchedModelPreset?.id ?? '__current__';
  const currentModelPresetOptions = matchedModelPreset
    ? []
    : [{
      value: '__current__',
      label: config.model,
      detail: modelPresetSummary(config),
      title: modelPresetTooltip(config),
      current: true,
    }];
  const modelPresetOptions = [
    ...currentModelPresetOptions,
    ...modelPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      detail: modelPresetSummary({ ...config, ...preset.config }),
      title: modelPresetTooltip({ ...config, ...preset.config }),
      group: config.locale === 'zh' ? '已保存' : 'Saved',
      current: matchedModelPreset?.id === preset.id,
    })),
  ];
  const workflowBusy = workflowMode && workflowPlanning;
  const urlTokens = React.useMemo(() => extractUrlTokens(input), [input]);
  const commandInputClassName = [
    'commandInputRow',
    !workflowMode && activeSlashOption ? 'active' : '',
    urlTokens.length > 0 ? 'withTokens' : '',
  ].filter(Boolean).join(' ');

  React.useEffect(() => {
    historyRef.current = readComposerHistory();
    const draft = readComposerDraft();
    if (draft && !input.trim()) {
      setInput(draft);
      window.requestAnimationFrame(() => resizeTextareaToContent(composerInputRef.current));
    }
  }, []);

  function updateComposerInput(next: string) {
    setHistoryCursor(null);
    setInput(next);
    writeComposerDraft(next);
    window.requestAnimationFrame(() => resizeTextareaToContent(composerInputRef.current));
  }

  async function handleSubmitComposer() {
    const text = input.trim();
    await submitComposer();
    if (text) {
      historyRef.current = writeComposerHistory(text, historyRef.current);
    }
    setHistoryCursor(null);
    clearComposerDraft();
  }

  function browseComposerHistory(direction: 'up' | 'down'): boolean {
    const history = historyRef.current;
    if (history.length === 0) return false;
    if (direction === 'up') {
      if (input.trim() && historyCursor === null) return false;
      const nextCursor = historyCursor === null ? history.length - 1 : Math.max(0, historyCursor - 1);
      setHistoryCursor(nextCursor);
      setInput(history[nextCursor]);
      writeComposerDraft(history[nextCursor]);
      window.requestAnimationFrame(() => resizeTextareaToContent(composerInputRef.current));
      return true;
    }
    if (historyCursor === null) return false;
    const nextCursor = historyCursor + 1;
    if (nextCursor >= history.length) {
      setHistoryCursor(null);
      setInput('');
      clearComposerDraft();
    } else {
      setHistoryCursor(nextCursor);
      setInput(history[nextCursor]);
      writeComposerDraft(history[nextCursor]);
    }
    window.requestAnimationFrame(() => resizeTextareaToContent(composerInputRef.current));
    return true;
  }

  function selectRemoteAssistant(platform: RemoteAssistantPlatform): void {
    setAssistantMenuOpen(false);
    openRemoteAssistants(platform);
  }

  const sendButtonClassName = ['sendButton', busy || workflowPlanning ? 'busy' : '', busy ? 'stopButton' : '', workflowPlanning ? 'planningButton' : ''].filter(Boolean).join(' ');

  return (
    <footer
      className={['composer', draggingImage ? 'dragging' : '', !rightPaneVisible ? 'compactWidth' : rightPaneTab === 'files' ? 'wideWidth' : 'balancedWidth'].filter(Boolean).join(' ')}
      onDragEnter={(event) => { event.preventDefault(); setDraggingImage(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDraggingImage(false)}
      onDrop={handleDrop}
    >
      <div className="composerMain">
        <div className="composerInner">
          {images.length > 0 ? (
            <div className="imageStrip">
              {images.map((img, i) => (
                <div className="imageThumb" key={i}>
                  <img src={img.dataUrl} alt={img.name} />
                  <button className="imageRemove" onClick={() => removeImage(i)} title={t(config.locale, 'remove')} aria-label={t(config.locale, 'remove')}>
                    <Icon name="x" />
                  </button>
                  <span>{img.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!workflowMode && slashVisible && filteredSlashOptions.length > 0 ? (
            <div className="slashPalette" role="listbox" aria-label="Slash commands">
              {filteredSlashOptions.map((option) => (
                <button className={'hideCommand' in option && option.hideCommand ? 'slashOption compact' : 'slashOption'} key={option.id} onClick={() => selectSlashOption(option)}>
                  <strong>{option.title}</strong>
                  {'hideCommand' in option && option.hideCommand ? null : <span>{option.command}</span>}
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
          <div className={commandInputClassName}>
            {!workflowMode && activeSlashOption ? (
              <div className="commandInputMeta">
                <div className="commandChip" title={activeSlashOption.command.trim()}>
                  <span>{activeSlashOption.command.trim()}</span>
                  <button type="button" title={t(config.locale, 'cancel')} aria-label={t(config.locale, 'cancel')} onClick={() => { setActiveSlashOption(null); setInput(''); composerInputRef.current?.focus(); }}>
                    <Icon name="x" />
                  </button>
                </div>
                {urlTokens.length > 0 ? (
                  <div className="commandTokenRow" aria-label={config.locale === 'zh' ? '已识别链接' : 'Detected links'}>
                    {urlTokens.map((token) => (
                      <span className="commandUrlChip" key={token.value} title={token.value}>
                        <span>{summarizeUrlToken(token.value)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : urlTokens.length > 0 ? (
              <div className="commandTokenRow" aria-label={config.locale === 'zh' ? '已识别链接' : 'Detected links'}>
                {urlTokens.map((token) => (
                  <span className="commandUrlChip" key={token.value} title={token.value}>
                    <span>{summarizeUrlToken(token.value)}</span>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={composerInputRef}
              value={input}
              rows={1}
              onChange={(event) => updateComposerInput(event.target.value)}
              onInput={() => resizeTextareaToContent(composerInputRef.current)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' && browseComposerHistory('up')) {
                  event.preventDefault();
                  return;
                }
                if (event.key === 'ArrowDown' && browseComposerHistory('down')) {
                  event.preventDefault();
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!busy && !actionBusy) void handleSubmitComposer();
                }
              }}
              placeholder={workflowMode
                ? (config.locale === 'zh' ? '输入工作流目标或节点修改要求...' : 'Describe a workflow goal or node change...')
                : activeSlashOption ? (config.locale === 'zh' ? '输入自然语言参数...' : 'Describe what to add...') : t(config.locale, 'placeholder')}
            />
          </div>
        </div>
        <button className={sendButtonClassName} onClick={() => busy ? void stopTurn() : actionBusy ? undefined : void handleSubmitComposer()} disabled={workflowBusy || actionBusy || (!busy && (!input.trim() && images.length === 0))} title={workflowBusy ? (config.locale === 'zh' ? '生成计划中' : 'Planning workflow') : busy ? t(config.locale, 'stop') : t(config.locale, 'send')} aria-label={workflowBusy ? (config.locale === 'zh' ? '生成计划中' : 'Planning workflow') : busy ? t(config.locale, 'stop') : t(config.locale, 'send')}>
          <Icon name={workflowBusy ? 'refresh' : busy ? 'stop' : 'send'} />
        </button>
      </div>
      <div className={workflowMode ? 'composerBottom workflowMode' : 'composerBottom'}>
        {workflowMode ? (
          <div className="workflowComposerPlan">
            <span>{config.locale === 'zh' ? '首次创建必须先生成计划' : 'First creation must start with a plan'}</span>
            <button className="solidButton" type="button" onClick={() => void handleSubmitComposer()} disabled={workflowBusy || busy || actionBusy || (!input.trim() && images.length === 0)}>
              {workflowBusy ? (config.locale === 'zh' ? '生成计划中' : 'Planning') : (config.locale === 'zh' ? '计划模式' : 'Plan mode')}
            </button>
          </div>
        ) : (
        <>
          <div className="composerMeta">
          <DropdownSelect
            ariaLabel={config.locale === 'zh' ? '模型配置' : 'Model preset'}
            className="modelPresetSelect"
            title={config.locale === 'zh' ? '模型配置' : 'Model preset'}
            value={modelPresetValue}
            onChange={(presetId) => {
              if (presetId === '__current__') return;
              const preset = modelPresets.find((item) => item.id === presetId);
              if (preset) applyModelPreset(preset);
            }}
            options={modelPresetOptions}
          />
          </div>
          <div className="composerActions">
          <div className="remoteAssistantPicker">
            <button
              className={`weixinBindingButton remoteBindingButton ${remoteBinding.tone}`}
              title={remoteBinding.title}
              aria-label={remoteBinding.title}
              aria-haspopup="menu"
              aria-expanded={assistantMenuOpen}
              onClick={() => setAssistantMenuOpen((open) => !open)}
              type="button"
            >
              {remoteBinding.boundPlatforms.length > 0 ? (
                remoteBinding.boundPlatforms.map((platform) => <RemotePlatformIcon key={platform} platform={platform} />)
              ) : (
                <span className="remoteBindingRobot" aria-hidden="true"><Icon name="puppet" /></span>
              )}
            </button>
            {assistantMenuOpen ? (
              <div className="remoteAssistantMenu" role="menu" aria-label={config.locale === 'zh' ? '选择远程助手' : 'Select remote assistant'}>
                <button type="button" role="menuitem" onClick={() => selectRemoteAssistant('weixin')}>
                  <RemotePlatformIcon platform="weixin" />
                  <span>
                    <strong>{config.locale === 'zh' ? '微信' : 'WeChat'}</strong>
                    <small>{remoteBinding.weixinHint}</small>
                  </span>
                </button>
                <button type="button" role="menuitem" onClick={() => selectRemoteAssistant('dingtalk')}>
                  <RemotePlatformIcon platform="dingtalk" />
                  <span>
                    <strong>{config.locale === 'zh' ? '钉钉' : 'DingTalk'}</strong>
                    <small>{remoteBinding.dingtalkHint}</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          <label className="fileButton" title={t(config.locale, 'attachImage')} aria-label={t(config.locale, 'attachImage')}>
            <input type="file" accept="image/*" multiple onChange={handleFileSelect} hidden />
            <Icon name="clip" />
          </label>
          <DropdownSelect ariaLabel={t(config.locale, 'mode')} className="modeSelect" title={t(config.locale, 'mode')} value={config.permissions} onChange={(permissions) => setConfig({ ...config, permissions })} options={[{ value: 'read_only', label: config.locale === 'zh' ? '只读' : 'Read' }, { value: 'workspace', label: config.locale === 'zh' ? '默认' : 'Default' }, { value: 'danger_full_access', label: config.locale === 'zh' ? '自主' : 'Auto' }]} />
          <DropdownSelect ariaLabel={config.locale === 'zh' ? '思考程度' : 'Reasoning effort'} className="modeSelect reasoningSelect" title={config.locale === 'zh' ? '思考程度' : 'Reasoning effort'} value={config.reasoningEffort} onChange={(reasoningEffort) => setConfig({ ...config, reasoningEffort })} options={[{ value: 'low', label: config.locale === 'zh' ? '快速' : 'Fast' }, { value: 'medium', label: config.locale === 'zh' ? '均衡' : 'Balanced' }, { value: 'high', label: config.locale === 'zh' ? '深度' : 'Deep' }]} />
          <DropdownSelect ariaLabel={config.locale === 'zh' ? '运行模式' : 'Run profile'} className="modeSelect runProfileSelect" title={config.locale === 'zh' ? '运行模式' : 'Run profile'} value={(config.runProfile as string) === 'harness' ? 'runtime_os' : config.runProfile} onChange={(runProfile) => setConfig({ ...config, runProfile })} options={[{ value: 'cache_first', label: runProfileLabel('cache_first', config.locale) }, { value: 'runtime_os', label: runProfileLabel('runtime_os', config.locale) }]} />
          </div>
        </>
        )}
      </div>
    </footer>
  );
}

function modelPresetMatchesConfig(preset: ModelPreset, config: RunConfig): boolean {
  const entries = Object.entries(preset.config) as Array<[keyof RunConfig, RunConfig[keyof RunConfig] | undefined]>;
  return entries.length > 0 && entries.every(([key, value]) => value === undefined || config[key] === value);
}

function readComposerHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeComposerHistory(text: string, current: string[]): string[] {
  const next = [...current.filter((item) => item !== text), text].slice(-COMPOSER_HISTORY_LIMIT);
  try {
    window.localStorage.setItem(COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can fail in private or constrained browser contexts.
  }
  return next;
}

function readComposerDraft(): string {
  try {
    return window.localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeComposerDraft(text: string): void {
  try {
    if (text) window.localStorage.setItem(COMPOSER_DRAFT_STORAGE_KEY, text);
    else window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
  } catch {
    // Draft persistence is best-effort UX state.
  }
}

function clearComposerDraft(): void {
  try {
    window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
  } catch {
    // Draft persistence is best-effort UX state.
  }
}

function modelPresetSummary(config: Partial<RunConfig>): string {
  return [config.provider, config.model].filter(Boolean).join(' / ') || 'model';
}

function modelPresetTooltip(config: Partial<RunConfig>): string {
  return [
    modelPresetSummary(config),
    config.baseUrl ? `API: ${config.baseUrl}` : '',
    config.reasoningEffort ? `Reasoning: ${config.reasoningEffort}` : '',
    config.runProfile ? `Run: ${config.runProfile}` : '',
  ].filter(Boolean).join('\n');
}

function RemotePlatformIcon({ platform }: { platform: RemoteAssistantPlatform }) {
  return (
    <span className={`remotePlatformIcon ${platform}`} aria-hidden="true">
      {platform === 'weixin' ? '微' : '钉'}
    </span>
  );
}

function remoteBindingView(
  botConfig: BotConfig | null,
  botStatus: BotStatus | null,
  activeThreadId: string,
  locale: RunConfig['locale'],
): {
  boundPlatforms: RemoteAssistantPlatform[];
  dingtalkHint: string;
  title: string;
  tone: 'ok' | 'warn' | 'muted';
  weixinHint: string;
} {
  const connected = Boolean(botConfig?.weixin.accountId) || botStatus?.weixin?.connected === true;
  const dingtalkConfigured = Boolean(botConfig?.dingtalk.enabled && botConfig.dingtalk.clientId && botConfig.dingtalk.clientSecret)
    || botStatus?.dingtalk?.configured === true;
  const platforms = [
    {
      name: locale === 'zh' ? '微信' : 'WeChat',
      platform: 'weixin' as const,
      boundThreadId: botConfig?.weixin.activeThreadId?.trim() ?? '',
    },
    {
      name: locale === 'zh' ? '钉钉' : 'DingTalk',
      platform: 'dingtalk' as const,
      boundThreadId: botConfig?.dingtalk.activeThreadId?.trim() ?? '',
    },
  ];
  const current = platforms.filter((platform) => activeThreadId && platform.boundThreadId === activeThreadId);
  const weixinHint = connected
    ? (locale === 'zh' ? '绑定到当前对话' : 'Bind to this chat')
    : (locale === 'zh' ? '扫码连接并绑定' : 'Scan to connect and bind');
  const dingtalkHint = dingtalkConfigured
    ? (locale === 'zh' ? '绑定到当前对话' : 'Bind to this chat')
    : (locale === 'zh' ? '先在设置中配置' : 'Configure in settings first');
  if (current.length > 0) {
    const names = current.map((platform) => platform.name).join(locale === 'zh' ? '、' : ', ');
    return {
      boundPlatforms: current.map((platform) => platform.platform),
      dingtalkHint,
      title: locale === 'zh' ? `${names}已绑定到当前对话` : `${names} bound to this chat`,
      tone: 'ok',
      weixinHint,
    };
  }
  const elsewhere = platforms.filter((platform) => platform.boundThreadId);
  if (elsewhere.length > 0) {
    return {
      boundPlatforms: [],
      dingtalkHint,
      title: locale === 'zh' ? '选择远程助手平台' : 'Select a remote assistant',
      tone: 'warn',
      weixinHint,
    };
  }
  return {
    boundPlatforms: [],
    dingtalkHint,
    title: locale === 'zh' ? '选择远程助手平台' : 'Select a remote assistant',
    tone: 'muted',
    weixinHint,
  };
}
