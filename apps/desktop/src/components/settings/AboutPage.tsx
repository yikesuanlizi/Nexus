import React from 'react';
import type { Locale } from '../../config/config.js';

export interface AuthTokenPublic {
  token: string;
  expiresAt?: string;
  scopes?: string[];
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function SettingsPageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string;
  title: string;
  actions?: Array<{ label: string; primary?: boolean; onClick: () => void }>;
}) {
  return (
    <header className="settingsPageHeader">
      <div className="settingsPageHeaderTitles">
        {eyebrow ? <span className="settingsPageHeaderEyebrow">{eyebrow}</span> : null}
        <h2 className="settingsPageHeaderTitle">{title}</h2>
      </div>
      {actions && actions.length > 0 ? (
        <div className="settingsPageHeaderActions">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={['settingsPageHeaderAction', action.primary ? 'primary' : 'ghost'].filter(Boolean).join(' ')}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

export function AboutPage({ locale }: { locale: Locale }) {
  return (
    <section className="settingsSection" id="settings-about">
      <SettingsPageHeader
        eyebrow="ABOUT"
        title={text(locale, '关于 Nexus', 'About Nexus')}
      />
      <div className="settingsCard settingsCardCompact">
        <div className="aboutRow">
          <span className="aboutLabel">{text(locale, '版本', 'Version')}</span>
          <span className="aboutValue">{text(locale, '开发版', 'Development build')}</span>
        </div>
        <div className="aboutRow">
          <span className="aboutLabel">{text(locale, '构建时间', 'Build time')}</span>
          <span className="aboutValue">—</span>
        </div>
        <div className="aboutRow">
          <span className="aboutLabel">{text(locale, '运行模式', 'Runtime mode')}</span>
          <span className="aboutValue">desktop</span>
        </div>
      </div>
    </section>
  );
}

export function AdminPage({
  locale,
  token,
  onCopyToken,
  onRegenerateToken,
}: {
  locale: Locale;
  token: AuthTokenPublic | null;
  onCopyToken: () => void;
  onRegenerateToken: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    if (!token?.token) return;
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopyToken();
    }
  }

  return (
    <section className="settingsSection" id="settings-admin">
      <SettingsPageHeader
        eyebrow="ADMIN"
        title={text(locale, '管理员', 'Admin')}
      />
      <div className="settingsCard settingsCardCompact">
        <div className="aboutRow">
          <span className="aboutLabel">{text(locale, '认证令牌', 'Auth token')}</span>
          <div className="adminTokenBlock">
            <code className="adminTokenValue">
              {token?.token ? token.token.slice(0, 8) + '••••••••••••' : text(locale, '未生成', 'Not generated')}
            </code>
            {token?.expiresAt ? (
              <span className="adminTokenExpiry">
                {text(locale, '过期时间', 'Expires')}: {token.expiresAt}
              </span>
            ) : null}
          </div>
        </div>
        <div className="adminTokenActions">
          <button className="textButton" type="button" onClick={() => void handleCopy()} disabled={!token?.token}>
            {copied ? text(locale, '已复制', 'Copied') : text(locale, '复制令牌', 'Copy token')}
          </button>
          <button className="solidButton" type="button" onClick={() => void onRegenerateToken()}>
            {text(locale, '重新生成', 'Regenerate')}
          </button>
        </div>
      </div>
    </section>
  );
}