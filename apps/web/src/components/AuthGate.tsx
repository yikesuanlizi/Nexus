// 登录/部署校验外壳：根据部署模式切换提示，缺失 JWT 时显示登录框
// Auth gate: switches hints based on deployment mode, shows login box when JWT is missing

import React, { useEffect, useState } from 'react';
import { getAuthJwt, setAuthJwt } from '../api/authClient.js';
import type { Locale, ThemeMode } from '../config/config.js';

type StatusPayload = {
  initialized?: boolean;
  deploymentMode?: 'single' | 'multi';
  deploymentSource?: 'init' | 'env' | 'default';
  authMode?: 'off' | 'token';
};
// 服务器返回的部署状态：是否初始化、单人/多人、鉴权方式
// Deployment state from the server: whether initialized, single/multi user, auth mode

export function AuthGate({ children, locale, themeMode }: { children: React.ReactNode; locale: Locale; themeMode: ThemeMode }) {
  const [authMode, setAuthMode] = useState<'unknown' | 'off' | 'token'>('unknown');
  const [initialized, setInitialized] = useState(true);
  const [deploymentMode, setDeploymentMode] = useState<'single' | 'multi'>('single');
  const [authJwt, setAuthJwtState] = useState(() => getAuthJwt());
  const [tokenDraft, setTokenDraft] = useState('');
  const [setupJwtSecret, setSetupJwtSecret] = useState('');
  const [initialAdminToken, setInitialAdminToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 读取服务器状态：部署模式与鉴权要求
  // Reads server state: deployment mode and auth requirements
  useEffect(() => {
    fetch('/api/status')
      .then((response) => response.ok ? response.json() : null)
      .then((data: StatusPayload | null) => {
        setInitialized(data?.initialized !== false);
        setDeploymentMode(data?.deploymentMode === 'multi' ? 'multi' : 'single');
        setAuthMode(data?.authMode === 'token' ? 'token' : 'off');
      })
      .catch(() => setAuthMode('off'));
  }, []);

  async function initialize(mode: 'single' | 'multi') {
    // 发起 /api/setup/deployment 完成首次部署初始化
    // Triggers /api/setup/deployment for first-time initialization
    const jwtSecret = setupJwtSecret.trim();
    if (mode === 'multi' && jwtSecret.length < 16) {
      setError(locale === 'zh' ? '多人模式密钥至少需要 16 个字符。' : 'Multi-tenant secret must be at least 16 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/setup/deployment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'multi' ? { mode, jwtSecret } : { mode }),
      });
      const data = (await response.json()) as { jwt?: string; adminToken?: string; authMode?: 'off' | 'token'; error?: string };
      if (!response.ok) {
        setError(data.error ?? (locale === 'zh' ? '初始化失败。' : 'Setup failed.'));
        return;
      }
      if (data.jwt) {
        setAuthJwt(data.jwt);
        setAuthJwtState(data.jwt);
      }
      setInitialAdminToken(data.adminToken ?? '');
      setDeploymentMode(mode);
      setInitialized(true);
      setAuthMode(data.authMode === 'token' ? 'token' : 'off');
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    // 提交用户输入的 Token 换取 JWT
    // Submits the user-entered token to exchange for a JWT
    const token = tokenDraft.trim();
    if (!token) return;
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = (await response.json()) as { jwt?: string; error?: string };
    if (!response.ok || !data.jwt) {
      setError(data.error ?? (locale === 'zh' ? 'Token 无效。' : 'Invalid token.'));
      return;
    }
    setAuthJwt(data.jwt);
    setAuthJwtState(data.jwt);
    setTokenDraft('');
  }

  // 尚未初始化：展示选择部署模式的界面
  // Not yet initialized: show the deployment mode selection interface
  if (!initialized) {
    return (
      <main className={[`theme-${themeMode}`, 'authShell'].join(' ')}>
        <section className="authPanel">
          <h1>Nexus</h1>
          <p>{locale === 'zh' ? '选择这台部署机的运行模式。保存后将作为最高优先级配置。' : 'Choose the deployment mode for this machine. Saved setup takes precedence over environment variables.'}</p>
          <label>
            {locale === 'zh' ? '多人模式密钥' : 'Multi-tenant secret'}
            <input type="password" value={setupJwtSecret} onChange={(event) => setSetupJwtSecret(event.target.value)}
              placeholder={locale === 'zh' ? '用于 JWT 签名，至少 16 个字符' : 'JWT signing secret, at least 16 characters'} />
          </label>
          <div className="authModeGrid">
            <button type="button" disabled={busy} onClick={() => void initialize('single')}>
              <strong>{locale === 'zh' ? '单人模式' : 'Single user'}</strong>
              <span>{locale === 'zh' ? '本地桌面、无登录、个人微信 bridge。' : 'Local desktop, no login, personal Weixin bridge.'}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => void initialize('multi')}>
              <strong>{locale === 'zh' ? '多人模式' : 'Multi tenant'}</strong>
              <span>{locale === 'zh' ? 'Web + JWT 登录 + tenant 隔离。' : 'Web, JWT login, tenant isolation.'}</span>
            </button>
          </div>
          {error ? <span className="authError">{error}</span> : null}
        </section>
      </main>
    );
  }

  // 多人模式初始化成功：显示一次性管理员 Token
  // Multi-tenant init done: shows the one-time admin token
  if (initialAdminToken) {
    return (
      <main className={[`theme-${themeMode}`, 'authShell'].join(' ')}>
        <section className="authPanel">
          <h1>Nexus</h1>
          <p>{locale === 'zh' ? '多人模式已开启。下面是首次管理员 Token，只显示一次。' : 'Multi-tenant mode is enabled. This first admin token is shown only once.'}</p>
          <code className="authTokenBox">{initialAdminToken}</code>
          <button className="solidButton" type="button" onClick={() => setInitialAdminToken('')}>
            {locale === 'zh' ? '进入 Nexus' : 'Continue'}
          </button>
        </section>
      </main>
    );
  }

  // 已开启 token 鉴权但尚无 JWT：显示登录界面
  // Token auth is enabled but no JWT yet: shows login interface
  if (authMode === 'token' && !authJwt) {
    return (
      <main className={[`theme-${themeMode}`, 'authShell'].join(' ')}>
        <section className="authPanel">
          <h1>Nexus</h1>
          <p>{deploymentMode === 'multi'
            ? (locale === 'zh' ? '请输入租户、机器人或管理员 Token 登录。' : 'Enter a tenant, bot, or admin token to continue.')
            : (locale === 'zh' ? '请输入 Token 登录。' : 'Enter a token to continue.')}</p>
          <label>
            Token
            <input autoFocus type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void login(); }} />
          </label>
          {error ? <span className="authError">{error}</span> : null}
          <button className="solidButton" type="button" onClick={() => void login()}>
            {locale === 'zh' ? '登录' : 'Sign in'}
          </button>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
