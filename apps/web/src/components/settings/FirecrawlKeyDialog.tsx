// Firecrawl API Key 输入 dialog
import type { Locale } from '../../config/config.js';
import type { WebProviderPublicConfig } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';

export interface FirecrawlKeyDialogProps {
  locale: Locale;
  open: boolean;
  webProviderState: WebProviderPublicConfig | null;
  firecrawlMasked: string;
  firecrawlHasPreview: boolean;
  firecrawlConfigured: boolean;
  webKeyDraft: string;
  setWebKeyDraft: (value: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onClear: () => Promise<void>;
}

export function FirecrawlKeyDialog({
  locale,
  open,
  webProviderState,
  firecrawlMasked,
  firecrawlHasPreview,
  firecrawlConfigured,
  webKeyDraft,
  setWebKeyDraft,
  onClose,
  onSave,
  onClear,
}: FirecrawlKeyDialogProps) {
  if (!open) return null;

  return (
    <div className="dialogLayer" role="presentation" onMouseDown={onClose}>
      <section
        className="appDialog pluginModalDialog firecrawlKeyDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="firecrawl-key-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <div>
            <h2 id="firecrawl-key-title">Firecrawl API Key</h2>
            <p className="dialogMessage">
              {firecrawlConfigured
                ? (locale === 'zh' ? `当前已检测到密钥 ${firecrawlMasked}` : `Detected key ${firecrawlMasked}`)
                : (locale === 'zh' ? '未检测到可用密钥，填写后才可开启 Firecrawl。' : 'No usable key detected. Fill in a key before enabling Firecrawl.')}
            </p>
          </div>
          <button className="iconButton" title={t(locale, 'cancel')} aria-label={t(locale, 'cancel')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="mcpPanelForm">
          <label className="pluginModalField">
            {locale === 'zh' ? 'API Key' : 'API Key'}
            <input
              placeholder="fc-..."
              value={webKeyDraft}
              onChange={(event) => setWebKeyDraft(event.target.value)}
              type="password"
            />
          </label>
          <div className="pluginModalSummary">
            <strong>{locale === 'zh' ? '密钥来源' : 'Key source'}</strong>
            <span>
              {webProviderState?.firecrawl.source === 'env'
                ? 'FIRECRAWL_API_KEY'
                : (locale === 'zh' ? '项目配置' : 'Project config')}
            </span>
          </div>
        </div>
        <div className="dialogActions">
          {webProviderState?.firecrawl.source === 'config' && firecrawlHasPreview ? (
            <button className="textButton" onClick={() => void onClear()}>
              {t(locale, 'clearKey')}
            </button>
          ) : null}
          <button className="textButton" onClick={onClose}>{t(locale, 'cancel')}</button>
          <button className="solidButton" onClick={() => void onSave()}>
            {locale === 'zh' ? '保存并开启' : 'Save and enable'}
          </button>
        </div>
      </section>
    </div>
  );
}
