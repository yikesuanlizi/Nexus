// 设置面板：远程助手页（微信桥接、钉钉机器人、dws CLI、飞书/QQ 预留）
import type React from 'react';
import type { Locale } from '../../config/config.js';
import type { BotConfig, BotStatus } from '../../shared/types.js';
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
  // patch / save 委托给父组件，让 web 与 desktop 共用同一份 page
  patchWeixin: (patch: Partial<BotConfig['weixin']>) => void;
  patchDingtalk: (patch: Partial<BotConfig['dingtalk']>) => void;
  patchDwsCli: (patch: Partial<BotConfig['dwsCli']>) => void;
  saveWeixinConfig: () => Promise<void>;
  saveDingtalkConfig: () => Promise<void>;
  saveDwsCliConfig: () => Promise<void>;
  handleStartDingtalk: () => Promise<void>;
  handleStopDingtalk: () => Promise<void>;
  handleTestDingtalk: () => Promise<void>;
  refreshBotStatus: () => Promise<void>;
  // desktop 特有：注入额外的微信桥接说明区块（可选）
  extraWeixinNotice?: React.ReactNode;
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
  patchWeixin,
  patchDingtalk,
  patchDwsCli,
  saveWeixinConfig,
  saveDingtalkConfig,
  saveDwsCliConfig,
  handleStartDingtalk,
  handleStopDingtalk,
  handleTestDingtalk,
  refreshBotStatus,
  extraWeixinNotice,
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
            <span>{botStatus?.weixin?.bridge === 'online'
              ? (locale === 'zh' ? '桥接在线' : 'Bridge online')
              : (locale === 'zh' ? '桥接未连接' : 'Bridge offline')}</span>
          </div>
          <span className={`botBadge ${botStatus?.weixin?.connected ? 'ok' : 'muted'}`}>
            {botStatus?.weixin?.connected
              ? (locale === 'zh' ? '已登录' : 'Signed in')
              : (locale === 'zh' ? '未登录' : 'Not signed in')}
          </span>
        </div>

        <label className="toggle botToggle">
          <input
            type="checkbox"
            checked={botDraft.weixin.enabled}
            onChange={(event) => patchWeixin({ enabled: event.target.checked })}
          />
          <span>{locale === 'zh' ? '启用微信远程助手' : 'Enable WeChat remote assistant'}</span>
        </label>

        <div className="botFormGrid">
          <label>
            {locale === 'zh' ? 'Bridge RPC 地址' : 'Bridge RPC URL'}
            <input value={botDraft.weixin.bridgeUrl} onChange={(event) => patchWeixin({ bridgeUrl: event.target.value })} />
          </label>
          <div className="botReadonlyField">
            <span>{locale === 'zh' ? '账号' : 'Account'}</span>
            <strong>{botDraft.weixin.accountId || (locale === 'zh' ? '未登录' : 'Not signed in')}</strong>
          </div>
        </div>

        {extraWeixinNotice}

        <div className="botActionRow">
          <button className="solidButton" onClick={() => void saveWeixinConfig()}>
            {locale === 'zh' ? '保存配置' : 'Save config'}
          </button>
        </div>

        {weixinNotice || botStatus?.weixin?.error ? (
          <p className="botNotice">{weixinNotice || botStatus?.weixin?.error}</p>
        ) : null}
      </div>

      {/* 钉钉机器人面板 */}
      <div className="dingtalkBotPanel">
        <div className="weixinBotHeader">
          <div>
            <strong>{locale === 'zh' ? '钉钉机器人' : 'DingTalk Bot'}</strong>
            <span>
              {botStatus?.dingtalk?.streamRunning
                ? (locale === 'zh' ? 'Stream 已连接' : 'Stream connected')
                : botStatus?.dingtalk?.configured
                  ? (locale === 'zh' ? '已配置未连接' : 'Configured, not connected')
                  : (locale === 'zh' ? '未配置' : 'Not configured')}
            </span>
          </div>
          <span className={`botBadge ${botStatus?.dingtalk?.streamRunning ? 'ok' : botStatus?.dingtalk?.configured ? 'warn' : 'muted'}`}>
            {botStatus?.dingtalk?.streamRunning
              ? (locale === 'zh' ? '在线' : 'Online')
              : botStatus?.dingtalk?.configured
                ? (locale === 'zh' ? '待连接' : 'Awaiting')
                : (locale === 'zh' ? '离线' : 'Offline')}
          </span>
        </div>

        <label className="toggle botToggle">
          <input
            type="checkbox"
            checked={botDraft.dingtalk.enabled}
            onChange={(event) => patchDingtalk({ enabled: event.target.checked })}
          />
          <span>{locale === 'zh' ? '启用钉钉机器人' : 'Enable DingTalk bot'}</span>
        </label>

        <div className="botFormGrid">
          <label>
            {locale === 'zh' ? '连接模式' : 'Connection mode'}
            <select
              value={botDraft.dingtalk.connectionMode}
              onChange={(event) => patchDingtalk({ connectionMode: event.target.value as 'stream' | 'webhook' })}
            >
              <option value="stream">{locale === 'zh' ? 'Stream Push（无需公网）' : 'Stream Push (no public IP)'}</option>
              <option value="webhook">{locale === 'zh' ? 'Webhook（需公网回调）' : 'Webhook (public callback)'}</option>
            </select>
          </label>
          <label>
            {locale === 'zh' ? 'Robot Code（可选）' : 'Robot Code (optional)'}
            <input value={botDraft.dingtalk.robotCode} onChange={(event) => patchDingtalk({ robotCode: event.target.value })} placeholder="robotCode 或留空使用 Client ID" />
          </label>
          <label>
            Client ID (AppKey)
            <input value={botDraft.dingtalk.clientId} onChange={(event) => patchDingtalk({ clientId: event.target.value })} placeholder="dingxxxxxxxxxx" />
          </label>
          <label>
            Client Secret (AppSecret)
            <input type="password" value={botDraft.dingtalk.clientSecret} onChange={(event) => patchDingtalk({ clientSecret: event.target.value })} placeholder="••••••••" />
          </label>
          <label>
            {locale === 'zh' ? 'AI 卡片模板 ID（可选）' : 'AI Card template ID (optional)'}
            <input value={botDraft.dingtalk.cardTemplateId} onChange={(event) => patchDingtalk({ cardTemplateId: event.target.value })} />
          </label>
          <label>
            {locale === 'zh' ? '目标群名称' : 'Target group name'}
            <input
              value={botDraft.dingtalk.targetGroupName}
              onChange={(event) => patchDingtalk({ targetGroupName: event.target.value })}
              placeholder={locale === 'zh' ? '例如：打完我去打DD·' : 'e.g. Team group'}
            />
          </label>
          <label className="botFullWidth">
            {locale === 'zh' ? '目标群会话 ID / openConversationId' : 'Target group conversation ID / openConversationId'}
            <input
              value={botDraft.dingtalk.targetGroupConversationId}
              onChange={(event) => patchDingtalk({ targetGroupConversationId: event.target.value })}
              placeholder="cidxxxx 或 openConversationId"
            />
          </label>
          <label>
            {locale === 'zh' ? 'Webhook 签名密钥（Webhook 模式）' : 'Webhook secret (webhook mode)'}
            <input type="password" value={botDraft.dingtalk.webhookSecret} onChange={(event) => patchDingtalk({ webhookSecret: event.target.value })} />
          </label>
          {botStatus?.dingtalk?.lastDetectedGroupConversationId ? (
            <p className="botNotice botFullWidth">
              {locale === 'zh'
                ? `最近检测到群 ID：${botStatus.dingtalk.lastDetectedGroupConversationId}`
                : `Last detected group ID: ${botStatus.dingtalk.lastDetectedGroupConversationId}`}
            </p>
          ) : null}
          <label className="botFullWidth">
            {locale === 'zh' ? '白名单用户 staffId（逗号分隔，留空表示所有用户可访问）' : 'Allowed staffIds (comma-separated; empty = open to all)'}
            <input
              value={botDraft.dingtalk.allowedUsers.join(',')}
              onChange={(event) => patchDingtalk({ allowedUsers: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="manager123,dev456"
            />
          </label>
          <label className="toggle botToggle inlineToggle">
            <input
              type="checkbox"
              checked={botDraft.dingtalk.autoStart}
              onChange={(event) => patchDingtalk({ autoStart: event.target.checked })}
            />
            <span>{locale === 'zh' ? '服务启动时自动连接' : 'Auto-connect on startup'}</span>
          </label>
        </div>

        <div className="botActionRow">
          <button className="solidButton" onClick={() => void saveDingtalkConfig()}>
            {locale === 'zh' ? '保存配置' : 'Save config'}
          </button>
          {botDraft.dingtalk.enabled && botDraft.dingtalk.clientId && botDraft.dingtalk.clientSecret ? (
            <>
              {botStatus?.dingtalk?.streamRunning ? (
                <button className="outlineButton" onClick={() => void handleStopDingtalk()}>
                  {locale === 'zh' ? '断开 Stream' : 'Disconnect stream'}
                </button>
              ) : (
                <button className="solidButton" onClick={() => void handleStartDingtalk()}>
                  {locale === 'zh' ? '启动 Stream' : 'Start stream'}
                </button>
              )}
            </>
          ) : null}
        </div>

        <div className="botTestRow">
          <input
            className="botTestInput"
            placeholder={locale === 'zh' ? '测试：conversationId' : 'Test: conversationId'}
            value={dingtalkTestConvId}
            onChange={(event) => setDingtalkTestConvId(event.target.value)}
          />
          <select value={dingtalkTestConvType} onChange={(event) => setDingtalkTestConvType(event.target.value as 'dm' | 'group')}>
            <option value="dm">{locale === 'zh' ? '单聊' : 'DM'}</option>
            <option value="group">{locale === 'zh' ? '群聊' : 'Group'}</option>
          </select>
          <button className="outlineButton" onClick={() => void handleTestDingtalk()}>
            {locale === 'zh' ? '发送测试消息' : 'Send test'}
          </button>
        </div>

        {dingtalkNotice || botStatus?.dingtalk?.error ? (
          <p className="botNotice">{dingtalkNotice || botStatus?.dingtalk?.error}</p>
        ) : null}
      </div>

      {/* 钉钉 CLI (dws) 面板 */}
      {botConfig?.dingtalk?.enabled ? (
      <div className="dingtalkBotPanel">
        <div className="weixinBotHeader">
          <div>
            <strong>{locale === 'zh' ? '钉钉 CLI (dws)' : 'DingTalk CLI (dws)'}</strong>
            <span>{locale === 'zh' ? '与机器人搭配使用，Agent 通过 CLI 操作钉钉企业数据' : 'Works alongside the bot; Agent operates DingTalk enterprise data via CLI'}</span>
          </div>
        </div>

        <label className="toggle botToggle">
          <input
            type="checkbox"
            checked={botDraft.dwsCli.enabled}
            onChange={(event) => patchDwsCli({ enabled: event.target.checked })}
          />
          <span>{locale === 'zh' ? '启用 dws CLI' : 'Enable dws CLI'}</span>
        </label>

        <div className="botFormGrid">
          <label className="botFullWidth">
            {locale === 'zh' ? 'dws 可执行文件路径' : 'dws binary path'}
            <input
              value={botDraft.dwsCli.binaryPath}
              onChange={(event) => patchDwsCli({ binaryPath: event.target.value })}
              placeholder="/usr/local/bin/dws"
            />
          </label>
          <label>
            Client ID (AppKey)
            <input value={botDraft.dwsCli.clientId} onChange={(event) => patchDwsCli({ clientId: event.target.value })} placeholder="dingxxxxxxxxxx" />
          </label>
          <label>
            Client Secret (AppSecret)
            <input type="password" value={botDraft.dwsCli.clientSecret} onChange={(event) => patchDwsCli({ clientSecret: event.target.value })} placeholder="••••••••" />
          </label>
        </div>

        <div className="botActionRow">
          <button className="solidButton" onClick={() => void saveDwsCliConfig()}>
            {locale === 'zh' ? '保存配置' : 'Save config'}
          </button>
        </div>

        {dingtalkNotice ? (
          <p className="botNotice">{dingtalkNotice}</p>
        ) : null}
      </div>
      ) : null}

      <div className="remoteBotGrid compactBots">
        {[
          [locale === 'zh' ? '飞书' : 'Feishu', botDraft.feishu.enabled],
          ['QQ', botDraft.qq.enabled],
        ].map(([name, enabled]) => (
          <article className="remoteBotCard" key={String(name)}>
            <strong>{String(name)}</strong>
            <span>{locale === 'zh' ? '后续接入同一 Bot Gateway' : 'Coming through the same Bot Gateway'}</span>
            <small>{enabled ? (locale === 'zh' ? '已预留' : 'Reserved') : (locale === 'zh' ? '待接入' : 'Pending')}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
