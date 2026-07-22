// 设置面板：远程助手页（desktop 桌面端版本）
// 与 web 版差异：含 desktopCapabilities、桥接说明、退登按钮、weixinBridgeDiagnostics
// 钉钉/dws CLI 的 patch 直接调用 updateXxxConfig 完成「patch + 立即 save」
import type React from 'react';
import type { Locale } from '../../config/config.js';
import type { BotConfig, BotStatus } from '../../shared/types.js';
import type { DesktopCapabilities } from '../../api/desktopBridge.js';
import { t } from '../../shared/i18n.js';

export interface AgentsPageProps {
  locale: Locale;
  botConfig: BotConfig | null;
  botStatus: BotStatus | null;
  botDraft: BotConfig;
  weixinNotice: string;
  dingtalkNotice: string;
  dingtalkTestConvId: string;
  setDingtalkTestConvId: (value: string) => void;
  dingtalkTestConvType: 'dm' | 'group';
  setDingtalkTestConvType: (value: 'dm' | 'group') => void;
  // desktop 特有：桥接能力描述
  desktopCapabilities: DesktopCapabilities | null;
  // desktop 钉钉状态
  dingtalkConfigured: boolean;
  dingtalkStatus: BotStatus['dingtalk'] | undefined;
  // patch 直接调用 updateXxxConfig 完成 patch+save 一体
  updateWeixinConfig: (patch: Partial<BotConfig['weixin']>) => Promise<void>;
  updateDingtalkConfig: (patch: Partial<BotConfig['dingtalk']>) => Promise<void>;
  updateDwsCliConfig: (patch: Partial<BotConfig['dwsCli']>) => Promise<void>;
  patchDingtalk: (patch: Partial<BotConfig['dingtalk']>) => void;
  patchDwsCli: (patch: Partial<BotConfig['dwsCli']>) => void;
  handleWeixinLogout: () => Promise<void>;
  handleStartDingtalk: () => Promise<void>;
  handleStopDingtalk: () => Promise<void>;
  handleTestDingtalk: () => Promise<void>;
  refreshBotStatus: () => Promise<void>;
}

// 桌面桥接状态文案
export function desktopBridgeStatusLabel(capabilities: DesktopCapabilities | null, locale: Locale): string {
  if (capabilities?.weixinBridge.managedAvailable) return locale === 'zh' ? '可用' : 'Available';
  if (capabilities?.weixinBridge.reason === 'not_bundled') return locale === 'zh' ? '组件未打包' : 'Component not bundled';
  if (capabilities?.weixinBridge.reason === 'unsupported') return locale === 'zh' ? '仅桌面端可用' : 'Desktop only';
  return locale === 'zh' ? '未运行' : 'Not running';
}

// 桥接诊断片段：用于在退登按钮下方展示监听/轮询/消息计数等
export function weixinBridgeDiagnostics(status: BotStatus, locale: Locale): Array<{ label: string; tone?: 'bad' }> {
  const bridgeStatus = status.weixin?.bridgeStatus;
  const monitors = bridgeStatus?.monitors ?? [];
  const activeMonitor = monitors.find((monitor) => monitor.running) ?? monitors[0];
  if (!activeMonitor) {
    return [{
      label: locale === 'zh' ? '监听：未启动' : 'Monitor: not started',
      tone: bridgeStatus?.error ? 'bad' : undefined,
    }];
  }
  const runningLabel = activeMonitor.running
    ? (locale === 'zh' ? '监听中' : 'Monitoring')
    : (locale === 'zh' ? '未监听' : 'Stopped');
  const result = [
    { label: runningLabel, tone: activeMonitor.running ? undefined : 'bad' as const },
    { label: `${locale === 'zh' ? '轮询' : 'Polls'} ${activeMonitor.pollCount ?? 0}` },
    { label: `${locale === 'zh' ? '消息' : 'Messages'} ${activeMonitor.messageCount ?? 0}` },
    { label: `${locale === 'zh' ? '投递' : 'Webhooks'} ${activeMonitor.webhookCount ?? 0}` },
  ];
  if (activeMonitor.lastError) {
    result.push({
      label: `${locale === 'zh' ? '最后错误' : 'Last error'}: ${activeMonitor.lastError}`,
      tone: 'bad' as const,
    });
  }
  return result;
}

export function AgentsPage({
  locale,
  botConfig,
  botStatus,
  botDraft,
  weixinNotice,
  dingtalkNotice,
  dingtalkTestConvId,
  setDingtalkTestConvId,
  dingtalkTestConvType,
  setDingtalkTestConvType,
  desktopCapabilities,
  dingtalkConfigured,
  dingtalkStatus,
  updateWeixinConfig,
  updateDingtalkConfig,
  updateDwsCliConfig,
  patchDingtalk,
  patchDwsCli,
  handleWeixinLogout,
  handleStartDingtalk,
  handleStopDingtalk,
  handleTestDingtalk,
  refreshBotStatus,
}: AgentsPageProps) {
  return (
    <section className="settingsSection remoteBots" id="settings-remote">
      <div className="presetHeader">
        <div>
          <h3>{locale === 'zh' ? '远程助手' : 'Remote bots'}</h3>
          <span>{locale === 'zh' ? '微信优先，其他平台沿用同一网关' : 'WeChat first, other platforms use the same gateway'}</span>
        </div>
        <button className="textButton" onClick={() => void refreshBotStatus()}>{t(locale, 'refresh')}</button>
      </div>
      <div className="weixinBotPanel">
        <div className="weixinBotHeader">
          <div>
            <strong>{locale === 'zh' ? '个人微信桥接' : 'Personal WeChat bridge'}</strong>
            <span>{locale === 'zh' ? '扫码、token 和消息监听由桌面端托管' : 'QR login, token, and monitoring are managed by desktop'}</span>
          </div>
          <span className={`botBadge ${botStatus?.weixin?.connected ? 'ok' : 'muted'}`}>
            {botStatus?.weixin?.connected
              ? (locale === 'zh' ? '已登录' : 'Signed in')
              : (locale === 'zh' ? '未登录' : 'Not signed in')}
          </span>
        </div>

        {!desktopCapabilities?.weixinBridge.managedAvailable ? (
          <p className="botNotice warning">
            {locale === 'zh'
              ? '当前桌面微信桥接没有运行。开发模式会随 desktop dev 启动；如果仍不可用，请检查终端里的 weixin-bridge 日志。'
              : 'The desktop WeChat bridge is not running. In dev it starts with desktop dev; check weixin-bridge logs if it remains unavailable.'}
          </p>
        ) : null}

        <div className="weixinAccountRow">
          <div className="weixinAccountMain">
            <span>{locale === 'zh' ? '账号' : 'Account'}</span>
            <strong title={botDraft.weixin.accountId || undefined}>
              {botDraft.weixin.accountId || (locale === 'zh' ? '未登录' : 'Not signed in')}
            </strong>
          </div>
          <div className="weixinAccountMeta">
            <span>{desktopBridgeStatusLabel(desktopCapabilities, locale)}</span>
            {botStatus?.weixin?.connected ? (
              <button className="textButton danger" onClick={() => void handleWeixinLogout()}>
                {locale === 'zh' ? '退出登录' : 'Log out'}
              </button>
            ) : null}
          </div>
        </div>

        {botStatus?.weixin?.bridgeStatus ? (
          <div className="weixinBridgeDiagnostics">
            {weixinBridgeDiagnostics(botStatus, locale).map((item) => (
              <span className={item.tone === 'bad' ? 'bad' : undefined} key={item.label}>
                {item.label}
              </span>
            ))}
          </div>
        ) : null}

        <label className="toggle botToggle historySyncToggle">
          <input
            type="checkbox"
            checked={botDraft.weixin.syncHistoryOnConnect}
            onChange={(event) => void updateWeixinConfig({ syncHistoryOnConnect: event.target.checked })}
          />
          <span>{locale === 'zh' ? '连接任意对话时同步微信历史消息' : 'Sync prior WeChat messages when connecting any conversation'}</span>
        </label>

        {weixinNotice || botStatus?.weixin?.error ? (
          <p className="botNotice">{weixinNotice || botStatus?.weixin?.error}</p>
        ) : null}
      </div>

      <div className="remoteBotGrid compactBots">
        <article className="remoteBotCard">
          <strong>{locale === 'zh' ? '飞书' : 'Feishu'}</strong>
          <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
          <small>{locale === 'zh' ? '待接入' : 'Pending'}</small>
        </article>
        <article className="remoteBotCard">
          <strong>QQ</strong>
          <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
          <small>{locale === 'zh' ? '待接入' : 'Pending'}</small>
        </article>
      </div>

      <div className="botPanel dingtalkBotPanel">
        <div className="botPanelHeader">
          <div className="botPanelTitle">
            <h4>{locale === 'zh' ? '钉钉机器人' : 'DingTalk Bot'}</h4>
            <span className={`botStatusBadge ${dingtalkStatus?.streamRunning ? 'ok' : dingtalkConfigured ? 'warn' : ''}`}>
              {dingtalkStatus?.streamRunning
                ? (locale === 'zh' ? 'Stream 已连接' : 'Stream connected')
                : dingtalkConfigured
                  ? (locale === 'zh' ? 'Stream 未连接' : 'Stream offline')
                  : (locale === 'zh' ? '未配置' : 'Not configured')}
            </span>
          </div>
          <label className="toggle botToggle">
            <input
              type="checkbox"
              checked={botDraft.dingtalk.enabled}
              onChange={(event) => void updateDingtalkConfig({ enabled: event.target.checked })}
            />
            <span>{locale === 'zh' ? '启用钉钉机器人' : 'Enable DingTalk bot'}</span>
          </label>
        </div>

        <div className="formRow">
          <label className="fieldLabel">
            <span>{locale === 'zh' ? '连接模式' : 'Connection mode'}</span>
            <select
              value={botDraft.dingtalk.connectionMode}
              onChange={(event) => patchDingtalk({ connectionMode: event.target.value as 'stream' | 'webhook' })}
              onBlur={() => void updateDingtalkConfig({ connectionMode: botDraft.dingtalk.connectionMode })}
              disabled={!botDraft.dingtalk.enabled}
            >
              <option value="stream">{locale === 'zh' ? 'Stream Push（推荐，无需公网）' : 'Stream Push (recommended, no public URL)'}</option>
              <option value="webhook">{locale === 'zh' ? 'Webhook（需公网回调地址）' : 'Webhook (requires public callback URL)'}</option>
            </select>
          </label>
        </div>

        <div className="formGrid">
          <label className="fieldLabel">
            <span>Client ID</span>
            <input
              type="text"
              value={botDraft.dingtalk.clientId}
              placeholder={locale === 'zh' ? '钉钉开放平台 AppKey' : 'DingTalk AppKey'}
              onChange={(event) => patchDingtalk({ clientId: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ clientId: botDraft.dingtalk.clientId })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
          <label className="fieldLabel">
            <span>Client Secret</span>
            <input
              type="password"
              value={botDraft.dingtalk.clientSecret}
              placeholder={locale === 'zh' ? '钉钉开放平台 AppSecret' : 'DingTalk AppSecret'}
              onChange={(event) => patchDingtalk({ clientSecret: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ clientSecret: botDraft.dingtalk.clientSecret })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
        </div>

        <div className="formGrid">
          <label className="fieldLabel">
            <span>Robot Code</span>
            <input
              type="text"
              value={botDraft.dingtalk.robotCode}
              placeholder={locale === 'zh' ? '机器人编码（可选）' : 'Robot code (optional)'}
              onChange={(event) => patchDingtalk({ robotCode: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ robotCode: botDraft.dingtalk.robotCode })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
          <label className="fieldLabel">
            <span>{locale === 'zh' ? '默认对话 Thread' : 'Default thread'}</span>
            <input
              type="text"
              value={botDraft.dingtalk.activeThreadId}
              placeholder={locale === 'zh' ? '留空则使用默认收件线程' : 'Leave empty to use inbox thread'}
              onChange={(event) => patchDingtalk({ activeThreadId: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ activeThreadId: botDraft.dingtalk.activeThreadId })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
        </div>

        <div className="formGrid">
          <label className="fieldLabel">
            <span>{locale === 'zh' ? '目标群名称' : 'Target group name'}</span>
            <input
              type="text"
              value={botDraft.dingtalk.targetGroupName}
              placeholder={locale === 'zh' ? '例如：打完我去打DD·' : 'e.g. Team group'}
              onChange={(event) => patchDingtalk({ targetGroupName: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ targetGroupName: botDraft.dingtalk.targetGroupName })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
          <label className="fieldLabel">
            <span>{locale === 'zh' ? '目标群会话 ID / openConversationId' : 'Target group conversation ID / openConversationId'}</span>
            <input
              type="text"
              value={botDraft.dingtalk.targetGroupConversationId}
              placeholder="cidxxxx 或 openConversationId"
              onChange={(event) => patchDingtalk({ targetGroupConversationId: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ targetGroupConversationId: botDraft.dingtalk.targetGroupConversationId })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
        </div>

        <div className="formGrid">
          <label className="fieldLabel">
            <span>{locale === 'zh' ? 'Webhook 签名密钥（Webhook 模式）' : 'Webhook secret (webhook mode)'}</span>
            <input
              type="password"
              value={botDraft.dingtalk.webhookSecret}
              placeholder={locale === 'zh' ? '可选，用于校验回调签名' : 'Optional, for webhook signature verification'}
              onChange={(event) => patchDingtalk({ webhookSecret: event.target.value })}
              onBlur={() => void updateDingtalkConfig({ webhookSecret: botDraft.dingtalk.webhookSecret })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
          <label className="fieldLabel botFullWidth">
            <span>{locale === 'zh' ? '白名单用户 staffId（逗号分隔，留空表示所有用户可访问）' : 'Allowed staffIds (comma-separated; empty = open to all)'}</span>
            <input
              type="text"
              value={botDraft.dingtalk.allowedUsers.join(',')}
              placeholder="manager123,dev456"
              onChange={(event) => patchDingtalk({ allowedUsers: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              onBlur={() => void updateDingtalkConfig({ allowedUsers: botDraft.dingtalk.allowedUsers })}
              disabled={!botDraft.dingtalk.enabled}
            />
          </label>
        </div>

        <label className="toggle botToggle inlineToggle">
          <input
            type="checkbox"
            checked={botDraft.dingtalk.autoStart}
            onChange={(event) => void updateDingtalkConfig({ autoStart: event.target.checked })}
            disabled={!botDraft.dingtalk.enabled}
          />
          <span>{locale === 'zh' ? '服务启动时自动连接' : 'Auto-connect on startup'}</span>
        </label>

        <div className="botActionRow">
          {dingtalkStatus?.streamRunning ? (
            <button
              type="button"
              className="outlineButton"
              onClick={() => void handleStopDingtalk()}
              disabled={!dingtalkConfigured || !botDraft.dingtalk.enabled}
            >
              {locale === 'zh' ? '停止 Stream' : 'Stop Stream'}
            </button>
          ) : (
            <button
              type="button"
              className="outlineButton"
              onClick={() => void handleStartDingtalk()}
              disabled={!dingtalkConfigured || !botDraft.dingtalk.enabled}
            >
              {locale === 'zh' ? '启动 Stream' : 'Start Stream'}
            </button>
          )}
          <select
            value={dingtalkTestConvType}
            onChange={(event) => setDingtalkTestConvType(event.target.value as 'dm' | 'group')}
            className="dingtalkTestSelect"
          >
            <option value="dm">{locale === 'zh' ? '单聊' : 'DM'}</option>
            <option value="group">{locale === 'zh' ? '群聊' : 'Group'}</option>
          </select>
          <input
            type="text"
            value={dingtalkTestConvId}
            placeholder={locale === 'zh' ? '会话 ID (conversationId)' : 'Conversation ID'}
            onChange={(event) => setDingtalkTestConvId(event.target.value)}
            className="dingtalkTestInput"
          />
          <button
            type="button"
            className="outlineButton"
            onClick={() => void handleTestDingtalk()}
            disabled={!dingtalkConfigured || !dingtalkTestConvId.trim()}
          >
            {locale === 'zh' ? '发送测试' : 'Test send'}
          </button>
        </div>

        {dingtalkNotice ? (
          <p className="botNotice">{dingtalkNotice}</p>
        ) : null}
      </div>

      {/* 钉钉 CLI (dws) 面板 */}
      {botConfig?.dingtalk?.enabled ? (
      <div className="botPanel dingtalkBotPanel">
        <div className="botPanelHeader">
          <div className="botPanelTitle">
            <h4>{locale === 'zh' ? '钉钉 CLI (dws)' : 'DingTalk CLI (dws)'}</h4>
            <span>{locale === 'zh' ? '与机器人搭配使用，Agent 通过 CLI 操作钉钉企业数据' : 'Works alongside the bot; Agent operates DingTalk enterprise data via CLI'}</span>
          </div>
          <label className="toggle botToggle">
            <input
              type="checkbox"
              checked={botDraft.dwsCli.enabled}
              onChange={(event) => void updateDwsCliConfig({ enabled: event.target.checked })}
            />
            <span>{locale === 'zh' ? '启用 dws CLI' : 'Enable dws CLI'}</span>
          </label>
        </div>

        <div className="formGrid">
          <label className="fieldLabel botFullWidth">
            <span>{locale === 'zh' ? 'dws 可执行文件路径' : 'dws binary path'}</span>
            <input
              type="text"
              value={botDraft.dwsCli.binaryPath}
              placeholder={locale === 'zh' ? '例如：/usr/local/bin/dws' : 'e.g. /usr/local/bin/dws'}
              onChange={(event) => patchDwsCli({ binaryPath: event.target.value })}
              onBlur={() => void updateDwsCliConfig({ binaryPath: botDraft.dwsCli.binaryPath })}
            />
          </label>
          <label className="fieldLabel">
            <span>Client ID (AppKey)</span>
            <input
              type="text"
              value={botDraft.dwsCli.clientId}
              placeholder={locale === 'zh' ? '钉钉开放平台 AppKey' : 'DingTalk AppKey'}
              onChange={(event) => patchDwsCli({ clientId: event.target.value })}
              onBlur={() => void updateDwsCliConfig({ clientId: botDraft.dwsCli.clientId })}
            />
          </label>
          <label className="fieldLabel">
            <span>Client Secret (AppSecret)</span>
            <input
              type="password"
              value={botDraft.dwsCli.clientSecret}
              placeholder={locale === 'zh' ? '钉钉开放平台 AppSecret' : 'DingTalk AppSecret'}
              onChange={(event) => patchDwsCli({ clientSecret: event.target.value })}
              onBlur={() => void updateDwsCliConfig({ clientSecret: botDraft.dwsCli.clientSecret })}
            />
          </label>
        </div>
      </div>
      ) : null}
    </section>
  );
}
