import type React from 'react';
import type { Locale } from '../../config/config.js';
import { t } from '../../shared/i18n.js';

export interface AuthTokenPublic {
  id: string;
  name: string;
  role: 'admin' | 'tenant' | 'bot';
  tenantId: string;
  scopes: string[];
  tokenPrefix: string;
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AboutPageProps {
  locale: Locale;
  showAdminControls: boolean;
  adminBootstrapToken: string;
  setAdminBootstrapToken: (value: string) => void;
  newAuthToken: {
    name: string;
    role: 'admin' | 'tenant' | 'bot';
    tenantId: string;
    scopes: string;
  };
  setNewAuthToken: React.Dispatch<React.SetStateAction<{
    name: string;
    role: 'admin' | 'tenant' | 'bot';
    tenantId: string;
    scopes: string;
  }>>;
  authTokens: AuthTokenPublic[];
  authTokenNotice: string;
  refreshAuthTokens: () => Promise<void>;
  createAuthToken: () => Promise<void>;
  deleteAuthToken: (id: string) => Promise<void>;
  rotateAuthToken: (id: string) => Promise<void>;
  appVersion?: string;
}

export function AboutPage(props: AboutPageProps) {
  return (
    <section className="settingsSection" id="settings-about">
      <SettingsPageHeader
        eyebrow={props.locale === 'zh' ? 'ABOUT' : 'ABOUT'}
        title={props.locale === 'zh' ? '关于' : 'About'}
      />
      <div className="settingsSectionBlock">
        <div className="settingsFormGrid">
          <div className="settingsField">
            <span className="settingsFieldLabel">{props.locale === 'zh' ? '版本' : 'Version'}</span>
            <span className="settingsValue">Nexus{props.appVersion ? ` · v${props.appVersion}` : ''}</span>
          </div>
          <div className="settingsField">
            <span className="settingsFieldLabel">{props.locale === 'zh' ? '构建' : 'Build'}</span>
            <span className="settingsValue">local-dev</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AdminPage(props: AboutPageProps) {
  const { locale } = props;

  return (
    <section className="settingsSection" id="settings-admin">
      <SettingsPageHeader
        eyebrow={locale === 'zh' ? 'ADMIN' : 'ADMIN'}
        title={locale === 'zh' ? '管理员' : 'Admin'}
      />
      <div className="settingsSectionBlock">
        <div className="presetHeader">
          <div>
            <h3>{locale === 'zh' ? 'Token 管理' : 'Token management'}</h3>
          </div>
          <button className="textButton" onClick={() => void props.refreshAuthTokens()}>{t(locale, 'refresh')}</button>
        </div>
        <div className="settingsFormGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Bootstrap Token</span>
            <input type="password" value={props.adminBootstrapToken} onChange={(event) => props.setAdminBootstrapToken(event.target.value)} />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">{t(locale, 'name')}</span>
            <input value={props.newAuthToken.name} onChange={(event) => props.setNewAuthToken({ ...props.newAuthToken, name: event.target.value })} />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Role</span>
            <select value={props.newAuthToken.role} onChange={(event) => props.setNewAuthToken({ ...props.newAuthToken, role: event.target.value as 'admin' | 'tenant' | 'bot' })}>
              <option value="tenant">tenant</option>
              <option value="bot">bot</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Tenant</span>
            <input value={props.newAuthToken.tenantId} onChange={(event) => props.setNewAuthToken({ ...props.newAuthToken, tenantId: event.target.value })} />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Scopes</span>
            <input value={props.newAuthToken.scopes} onChange={(event) => props.setNewAuthToken({ ...props.newAuthToken, scopes: event.target.value })} />
          </label>
        </div>
        <div className="botActionRow">
          <button className="solidButton" onClick={() => void props.createAuthToken()}>
            {locale === 'zh' ? '创建 Token' : 'Create token'}
          </button>
        </div>
        {props.authTokenNotice ? <p className="botNotice">{props.authTokenNotice}</p> : null}
        <div className="mcpList">
          {props.authTokens.map((token) => (
            <article className="mcpItem" key={token.id}>
              <div>
                <strong>{token.name || token.id}</strong>
                <span>{token.role} · {token.tenantId} · {token.tokenPrefix}... · {token.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              <div className="mcpActions">
                <button className="textButton" onClick={() => void props.rotateAuthToken(token.id)}>{locale === 'zh' ? '轮换' : 'Rotate'}</button>
                <button className="textButton danger" onClick={() => void props.deleteAuthToken(token.id)}>{locale === 'zh' ? '删除' : 'Delete'}</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="settingsPageHeader">
      <div className="settingsPageHeaderTitles">
        <span className="settingsPageHeaderEyebrow">{eyebrow}</span>
        <h1 className="settingsPageHeaderTitle">{title}</h1>
      </div>
    </header>
  );
}
