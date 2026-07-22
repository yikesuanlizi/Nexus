// 设置面板：管理员/关于页（Token 管理 + 版本信息）
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
  // Bootstrap Token 输入
  adminBootstrapToken: string;
  setAdminBootstrapToken: (value: string) => void;
  // 新建 Token 表单
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
  // Auth token 列表与提示
  authTokens: AuthTokenPublic[];
  authTokenNotice: string;
  // 操作回调
  refreshAuthTokens: () => Promise<void>;
  createAuthToken: () => Promise<void>;
  deleteAuthToken: (id: string) => Promise<void>;
  rotateAuthToken: (id: string) => Promise<void>;
  // 版本信息（可选）
  appVersion?: string;
}

export function AboutPage({
  locale,
  showAdminControls,
  adminBootstrapToken,
  setAdminBootstrapToken,
  newAuthToken,
  setNewAuthToken,
  authTokens,
  authTokenNotice,
  refreshAuthTokens,
  createAuthToken,
  deleteAuthToken,
  rotateAuthToken,
  appVersion,
}: AboutPageProps) {
  if (!showAdminControls) {
    // 非 admin 部署模式：展示简单的关于信息
    return (
      <section className="settingsSection" id="settings-about">
        <div className="presetHeader">
          <div>
            <h3>{locale === 'zh' ? '关于' : 'About'}</h3>
            <span>{locale === 'zh' ? 'Nexus 当前部署未启用管理员控制' : 'This Nexus deployment does not enable admin controls'}</span>
          </div>
        </div>
        <div className="settingsInfoBlock">
          <p className="muted"><strong>Nexus</strong>{appVersion ? ` · v${appVersion}` : ''}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="settingsSection" id="settings-admin">
      <div className="presetHeader">
        <div>
          <h3>{locale === 'zh' ? 'Token 管理' : 'Token management'}</h3>
          <span>{locale === 'zh' ? '创建、轮换和删除租户/机器人/管理员 Token' : 'Create, rotate, and delete tenant, bot, and admin tokens'}</span>
        </div>
        <button className="textButton" onClick={() => void refreshAuthTokens()}>{t(locale, 'refresh')}</button>
      </div>
      <div className="formGrid">
        <label>
          Bootstrap Token
          <input type="password" value={adminBootstrapToken} onChange={(event) => setAdminBootstrapToken(event.target.value)} />
        </label>
        <label>
          {t(locale, 'name')}
          <input value={newAuthToken.name} onChange={(event) => setNewAuthToken({ ...newAuthToken, name: event.target.value })} />
        </label>
        <label>
          Role
          <select value={newAuthToken.role} onChange={(event) => setNewAuthToken({ ...newAuthToken, role: event.target.value as 'admin' | 'tenant' | 'bot' })}>
            <option value="tenant">tenant</option>
            <option value="bot">bot</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          Tenant
          <input value={newAuthToken.tenantId} onChange={(event) => setNewAuthToken({ ...newAuthToken, tenantId: event.target.value })} />
        </label>
        <label>
          Scopes
          <input value={newAuthToken.scopes} onChange={(event) => setNewAuthToken({ ...newAuthToken, scopes: event.target.value })} />
        </label>
      </div>
      <div className="botActionRow">
        <button className="solidButton" onClick={() => void createAuthToken()}>
          {locale === 'zh' ? '创建 Token' : 'Create token'}
        </button>
      </div>
      {authTokenNotice ? <p className="botNotice">{authTokenNotice}</p> : null}
      <div className="mcpList">
        {authTokens.map((token) => (
          <article className="mcpItem" key={token.id}>
            <div>
              <strong>{token.name || token.id}</strong>
              <span>{token.role} · {token.tenantId} · {token.tokenPrefix}... · {token.enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div className="mcpActions">
              <button className="textButton" onClick={() => void rotateAuthToken(token.id)}>{locale === 'zh' ? '轮换' : 'Rotate'}</button>
              <button className="textButton danger" onClick={() => void deleteAuthToken(token.id)}>{locale === 'zh' ? '删除' : 'Delete'}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
