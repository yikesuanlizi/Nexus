// 设置面板：远程助手页（微信桥接、钉钉机器人、dws CLI、飞书/QQ 预留）
import type React from 'react';
import type { Locale } from '../../config/config.js';
import type { BotConfig, BotStatus } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { Icon } from '../Icon.js';
import { SettingsPageHeader } from './SettingsPageHeader.js';
import { SectionHeader } from './SectionHeader.js';

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
  patchFeishu: (patch: Partial<BotConfig['feishu']>) => void;
  patchQq: (patch: Partial<BotConfig['qq']>) => void;
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

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function MiniToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`settingsToggleTrack mini ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="settingsToggleThumb" />
    </label>
  );
}

export function AgentsPage({
  locale,
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
  patchFeishu,
  patchQq,
  saveWeixinConfig,
  saveDingtalkConfig,
  saveDwsCliConfig,
  handleStartDingtalk,
  handleStopDingtalk,
  handleTestDingtalk,
  refreshBotStatus,
  extraWeixinNotice,
}: AgentsPageProps) {
  const weixinOnline = botStatus?.weixin?.bridge === 'online';
  const weixinConnected = botStatus?.weixin?.connected;

  const dingtalkStreamRunning = botStatus?.dingtalk?.streamRunning ?? false;
  const dingtalkConfigured = botStatus?.dingtalk?.configured ?? false;

  return (
    <section className="settingsSection remoteBots" id="settings-remote">
      <SettingsPageHeader
        eyebrow={text(locale, '渠道', 'Channels')}
        title={text(locale, '远程助手', 'Remote bots')}
        actions={[
          {
            label: t(locale, 'refresh'),
            onClick: () => void refreshBotStatus(),
          },
        ]}
      />

      {/* 个人微信桥接 */}
      <div className="settingsSectionBlock">
        <SectionHeader
          title={text(locale, '个人微信桥接', 'Personal WeChat bridge')}
          chip={weixinConnected
            ? text(locale, '已登录 · 桥接在线', 'Signed in · Bridge online')
            : text(locale, '未登录 · 桥接未连接', 'Not signed in · Bridge offline')}
        />
        <div className="denseGrid">
          <div className="cluster">
            <div className="clusterHeader">
              <div>
                <h3>{text(locale, '连接与监听', 'Connection & listener')}</h3>
              </div>
              <MiniToggle
                checked={botDraft.weixin.enabled}
                onChange={(checked) => patchWeixin({ enabled: checked })}
              />
            </div>
            <div className="clusterBody">
              <div className="settingsFormGrid">
                <label className="settingsField wide">
                  <span className="settingsFieldLabel">{text(locale, '桥接地址', 'Bridge URL')}</span>
                  <input
                    value={botDraft.weixin.bridgeUrl}
                    onChange={(event) => patchWeixin({ bridgeUrl: event.target.value })}
                    placeholder="http://127.0.0.1:18790/api/v1/admin/rpc"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, '已登录账号', 'Account')}</span>
                  <div className="readonlyLine">
                    {botDraft.weixin.accountId || text(locale, '未登录', 'Not signed in')}
                  </div>
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, '关联对话', 'Linked thread')}</span>
                  <select
                    value={botDraft.weixin.activeThreadId}
                    onChange={(event) => patchWeixin({ activeThreadId: event.target.value })}
                  >
                    <option value="">{text(locale, '当前工作区 · 项目设计', 'Current workspace · project design')}</option>
                  </select>
                </label>
              </div>
              <div className="compactOption">
                <div>
                  <strong>{text(locale, '连接任意对话时同步微信历史消息', 'Sync WeChat history on connect')}</strong>
                </div>
                <MiniToggle
                  checked={botDraft.weixin.syncHistoryOnConnect}
                  onChange={(checked) => patchWeixin({ syncHistoryOnConnect: checked })}
                />
              </div>
              <div className="clusterActionRow">
                <button className="settingsPageHeaderAction ghost" type="button" onClick={() => void saveWeixinConfig()}>
                  {text(locale, '保存配置', 'Save config')}
                </button>
                <button className="settingsPageHeaderAction ghost" type="button">
                  {text(locale, '重新扫码', 'Re-scan QR')}
                </button>
                <button className="settingsPageHeaderAction ghost danger" type="button">
                  {text(locale, '退出登录', 'Sign out')}
                </button>
              </div>
              {extraWeixinNotice}
              {weixinNotice || botStatus?.weixin?.error ? (
                <p className="settingsNotice">{weixinNotice || botStatus?.weixin?.error}</p>
              ) : null}
            </div>
          </div>

          <aside className="cluster">
            <div className="clusterHeader">
              <div>
                <h3>{text(locale, '运行状态', 'Runtime status')}</h3>
              </div>
            </div>
            <div className="clusterBody connectionDetail">
              <div>
                <span>{text(locale, '桥接服务', 'Bridge service')}</span>
                <span className={`settingsSectionHeaderChip ${weixinOnline ? 'ok' : ''}`}>
                  {weixinOnline ? text(locale, '在线', 'Online') : text(locale, '离线', 'Offline')}
                </span>
              </div>
              <div>
                <span>{text(locale, '桥接模式', 'Bridge mode')}</span>
                <code>{botDraft.weixin.bridgeMode}</code>
              </div>
              <div>
                <span>{text(locale, '活跃对话', 'Active thread')}</span>
                <code>{botDraft.weixin.activeThreadId || '-'}</code>
              </div>
              <div>
                <span>{text(locale, '自动监听', 'Auto monitor')}</span>
                <code>{botDraft.weixin.autoStartMonitor ? text(locale, '开启', 'On') : text(locale, '关闭', 'Off')}</code>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* 钉钉机器人 */}
      <div className="settingsSectionBlock">
        <SectionHeader
          title={text(locale, '钉钉机器人', 'DingTalk Bot')}
          chip={dingtalkStreamRunning
            ? text(locale, 'Stream 已连接', 'Stream connected')
            : dingtalkConfigured
              ? text(locale, '已配置未连接', 'Configured, not connected')
              : text(locale, '未配置', 'Not configured')}
        />
        <div className="remoteStack">
          <div className="cluster">
            <div className="clusterHeader">
              <div>
                <h3>{text(locale, '机器人连接', 'Bot connection')}</h3>
              </div>
              <MiniToggle
                checked={botDraft.dingtalk.enabled}
                onChange={(checked) => patchDingtalk({ enabled: checked })}
              />
            </div>
            <div className="clusterBody">
              <div className="settingsFormGrid three">
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, '连接模式', 'Connection mode')}</span>
                  <select
                    value={botDraft.dingtalk.connectionMode}
                    onChange={(event) => patchDingtalk({ connectionMode: event.target.value as 'stream' | 'webhook' })}
                  >
                    <option value="stream">{text(locale, 'Stream Push（无需公网）', 'Stream Push (no public IP)')}</option>
                    <option value="webhook">{text(locale, 'Webhook（需公网回调）', 'Webhook (public callback)')}</option>
                  </select>
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, '机器人 Code（可选）', 'Robot Code (optional)')}</span>
                  <input
                    value={botDraft.dingtalk.robotCode}
                    onChange={(event) => patchDingtalk({ robotCode: event.target.value })}
                    placeholder="robotCode"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, 'AI 卡片模板 ID（可选）', 'AI Card template ID (optional)')}</span>
                  <input
                    value={botDraft.dingtalk.cardTemplateId}
                    onChange={(event) => patchDingtalk({ cardTemplateId: event.target.value })}
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Client ID (AppKey)</span>
                  <input
                    value={botDraft.dingtalk.clientId}
                    onChange={(event) => patchDingtalk({ clientId: event.target.value })}
                    placeholder="dingxxxxxxxxxx"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Client Secret (AppSecret)</span>
                  <input
                    type="password"
                    value={botDraft.dingtalk.clientSecret}
                    onChange={(event) => patchDingtalk({ clientSecret: event.target.value })}
                    placeholder="••••••••"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{text(locale, 'Webhook 签名密钥', 'Webhook secret')}</span>
                  <input
                    type="password"
                    value={botDraft.dingtalk.webhookSecret}
                    onChange={(event) => patchDingtalk({ webhookSecret: event.target.value })}
                  />
                </label>
              </div>
              <div className="clusterActionRow">
                <button className="settingsPageHeaderAction primary" type="button" onClick={() => void saveDingtalkConfig()}>
                  {text(locale, '保存钉钉配置', 'Save DingTalk config')}
                </button>
                {botDraft.dingtalk.enabled && botDraft.dingtalk.clientId && botDraft.dingtalk.clientSecret ? (
                  dingtalkStreamRunning ? (
                    <button className="settingsPageHeaderAction ghost" type="button" onClick={() => void handleStopDingtalk()}>
                      {text(locale, '停止 Stream', 'Stop stream')}
                    </button>
                  ) : (
                    <button className="settingsPageHeaderAction ghost" type="button" onClick={() => void handleStartDingtalk()}>
                      {text(locale, '启动 Stream', 'Start stream')}
                    </button>
                  )
                ) : null}
              </div>
            </div>
          </div>

          <div className="remoteColumns">
            <div className="cluster">
              <div className="clusterHeader">
                <div>
                  <h3>{text(locale, '群与白名单', 'Group & allowlist')}</h3>
              </div>
              </div>
              <div className="clusterBody">
                <div className="settingsFormGrid">
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{text(locale, '目标群名称', 'Target group name')}</span>
                    <input
                      value={botDraft.dingtalk.targetGroupName}
                      onChange={(event) => patchDingtalk({ targetGroupName: event.target.value })}
                      placeholder={text(locale, '可选', 'Optional')}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{text(locale, '群 conversationId', 'Group conversationId')}</span>
                    <input
                      value={botDraft.dingtalk.targetGroupConversationId}
                      onChange={(event) => patchDingtalk({ targetGroupConversationId: event.target.value })}
                      placeholder="cidxxxx"
                    />
                  </label>
                  <label className="settingsField wide">
                    <span className="settingsFieldLabel">{text(locale, '允许用户 staffId', 'Allowed staffIds')}</span>
                    <input
                      value={botDraft.dingtalk.allowedUsers.join(',')}
                      onChange={(event) => patchDingtalk({ allowedUsers: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder="manager123, dev456"
                    />
                  </label>
                </div>
                
              </div>
            </div>

            <div className="cluster">
              <div className="clusterHeader">
                <div>
                  <h3>{text(locale, '发送测试', 'Send test')}</h3>
              </div>
              </div>
              <div className="clusterBody">
                <div className="settingsFormGrid">
                  <label className="settingsField wide">
                    <span className="settingsFieldLabel">conversationId</span>
                    <input
                      value={dingtalkTestConvId}
                      onChange={(event) => setDingtalkTestConvId(event.target.value)}
                      placeholder={text(locale, '填写会话 ID', 'Fill in conversationId')}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{text(locale, '会话类型', 'Conversation type')}</span>
                    <select
                      value={dingtalkTestConvType}
                      onChange={(event) => setDingtalkTestConvType(event.target.value as 'dm' | 'group')}
                    >
                      <option value="dm">{text(locale, '单聊', 'DM')}</option>
                      <option value="group">{text(locale, '群聊', 'Group')}</option>
                    </select>
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{text(locale, '服务启动时自动连接', 'Auto-connect on startup')}</span>
                    <div className="readonlyLine">
                      <MiniToggle
                        checked={botDraft.dingtalk.autoStart}
                        onChange={(checked) => patchDingtalk({ autoStart: checked })}
                      />
                      <span>{botDraft.dingtalk.autoStart ? text(locale, '已开启', 'On') : text(locale, '已关闭', 'Off')}</span>
                    </div>
                  </label>
                </div>
                <div className="clusterActionRow">
                  <button className="settingsPageHeaderAction primary" type="button" onClick={() => void handleTestDingtalk()}>
                    {text(locale, '发送测试消息', 'Send test')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {dingtalkNotice || botStatus?.dingtalk?.error ? (
            <p className="settingsNotice">{dingtalkNotice || botStatus?.dingtalk?.error}</p>
          ) : null}
        </div>
      </div>

      {/* 钉钉 CLI 与其他平台 */}
      <div className="settingsSectionBlock">
        <SectionHeader title={text(locale, '钉钉 CLI 与其他平台', 'DingTalk CLI & other platforms')} />
        <div className="remoteColumns">
          <div className="cluster">
            <div className="clusterHeader">
              <div>
                <h3>{text(locale, '钉钉 CLI (dws)', 'DingTalk CLI (dws)')}</h3>
              </div>
              <span className="settingsSectionHeaderChip">
                {botDraft.dwsCli.enabled ? text(locale, '已启用', 'Enabled') : text(locale, '未启用', 'Disabled')}
              </span>
            </div>
            <div className="clusterBody">
              <div className="settingsFormGrid">
                <label className="settingsField wide">
                  <span className="settingsFieldLabel">{text(locale, '二进制路径', 'Binary path')}</span>
                  <input
                    value={botDraft.dwsCli.binaryPath}
                    onChange={(event) => patchDwsCli({ binaryPath: event.target.value })}
                    placeholder="dws.exe"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Client ID (AppKey)</span>
                  <input
                    value={botDraft.dwsCli.clientId}
                    onChange={(event) => patchDwsCli({ clientId: event.target.value })}
                    placeholder="dingxxxxxxxxxx"
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Client Secret (AppSecret)</span>
                  <input
                    type="password"
                    value={botDraft.dwsCli.clientSecret}
                    onChange={(event) => patchDwsCli({ clientSecret: event.target.value })}
                    placeholder="••••••••"
                  />
                </label>
              </div>
              <div className="clusterActionRow">
                <button className="settingsPageHeaderAction ghost" type="button" onClick={() => void saveDwsCliConfig()}>
                  {text(locale, '保存 CLI 配置', 'Save CLI config')}
                </button>
              </div>
            </div>
          </div>

          <div className="cluster">
            <div className="clusterHeader">
              <div>
                <h3>{text(locale, '飞书与 QQ', 'Feishu & QQ')}</h3>
              </div>
            </div>
            <div className="clusterBody">
              <div className="compactOption">
                <div>
                  <strong>{text(locale, '飞书', 'Feishu')}</strong>
                </div>
                <MiniToggle
                  checked={botDraft.feishu.enabled}
                  onChange={(checked) => patchFeishu({ enabled: checked })}
                />
              </div>
              <div className="compactOption">
                <div>
                  <strong>QQ</strong>
                </div>
                <MiniToggle
                  checked={botDraft.qq.enabled}
                  onChange={(checked) => patchQq({ enabled: checked })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
