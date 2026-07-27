import React from 'react';
import type { AccessKind, AccessPolicyConfig, AccessRule, AccessRuleScope, AccessTarget } from '@nexus/protocol';
import type { Locale } from '../../config/config.js';

export type AccessPolicySettingsScope = 'global' | 'currentThread';

export interface AccessPolicyPageProps {
  locale: Locale;
  value: AccessPolicyConfig;
  scope: AccessPolicySettingsScope;
  currentThreadAvailable: boolean;
  saving: boolean;
  notice: string;
  onScopeChange: (scope: AccessPolicySettingsScope) => void;
  onChange: (value: AccessPolicyConfig) => void;
  onSave: () => void;
  onReload: () => void;
}

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function modeLabel(mode: AccessPolicyConfig['mode'], locale: Locale): string {
  if (mode === 'chat') return text(locale, '对话模式', 'Chat mode');
  if (mode === 'danger_full_access') return text(locale, '高风险完全访问', 'Full access');
  return text(locale, '工作区模式', 'Workspace mode');
}

function defaultTargetForAccess(access: AccessKind): AccessTarget {
  if (access === 'network') return { kind: 'network', host: '' };
  if (access === 'command') return { kind: 'command', command: '' };
  if (access === 'tool_call') return { kind: 'tool', toolName: '' };
  return { kind: 'path', path: '' };
}

function targetValue(target: AccessTarget): string {
  if (target.kind === 'network') return target.host ?? '';
  if (target.kind === 'command') return target.command ?? '';
  if (target.kind === 'tool') return target.toolName ?? '';
  return target.path ?? '';
}

function targetFromValue(access: AccessKind, value: string): AccessTarget {
  if (access === 'network') return { kind: 'network', host: value };
  if (access === 'command') return { kind: 'command', command: value };
  if (access === 'tool_call') return { kind: 'tool', toolName: value };
  return { kind: 'path', path: value };
}

function ruleScope(scope: AccessPolicySettingsScope): AccessRuleScope {
  return scope === 'currentThread' ? 'thread' : 'global';
}

export function AccessPolicyPage({
  locale,
  value,
  scope,
  currentThreadAvailable,
  saving,
  notice,
  onScopeChange,
  onChange,
  onSave,
  onReload,
}: AccessPolicyPageProps) {
  const persistentRules = value.persistentRules ?? [];

  function patchPolicy(patch: Partial<AccessPolicyConfig>) {
    onChange({
      ...value,
      ...patch,
      temporaryGrants: [],
    });
  }

  function patchRule(id: string, patch: Partial<AccessRule>) {
    patchPolicy({
      persistentRules: persistentRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  }

  function addRule() {
    const now = new Date().toISOString();
    const access: AccessKind = 'read';
    patchPolicy({
      persistentRules: [
        ...persistentRules,
        {
          id: `rule_${Date.now()}`,
          effect: 'allow',
          access,
          target: defaultTargetForAccess(access),
          scope: ruleScope(scope),
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }

  function removeRule(id: string) {
    patchPolicy({ persistentRules: persistentRules.filter((rule) => rule.id !== id) });
  }

  return (
    <section className="settingsPage settingsAccessPolicyPage">
      <header className="settingsPageHeader accessPolicyHeader">
        <div>
          <h2>{text(locale, '权限与工作区', 'Access & workspace')}</h2>
          <p>{text(locale, '设置页只保存持久允许/禁止；运行时弹窗只临时生效。', 'Settings persist allow/deny rules; runtime approvals stay temporary.')}</p>
        </div>
        <div className="accessPolicyActions">
          <button className="whiteButton" type="button" onClick={onReload} disabled={saving}>
            {text(locale, '重新载入', 'Reload')}
          </button>
          <button className="solidButton" type="button" onClick={onSave} disabled={saving}>
            {saving ? text(locale, '保存中…', 'Saving…') : text(locale, scope === 'global' ? '保存全局规则' : '保存当前线程规则', scope === 'global' ? 'Save global rules' : 'Save thread rules')}
          </button>
        </div>
      </header>

      <div className="settingsCard settingsCardCompact">
        <div className="accessPolicyScopeTabs" role="tablist" aria-label={text(locale, '规则保存位置', 'Rule location')}>
          <button className={scope === 'global' ? 'active' : ''} type="button" onClick={() => onScopeChange('global')}>
            {text(locale, '全局规则', 'Global rules')}
          </button>
          <button
            className={scope === 'currentThread' ? 'active' : ''}
            type="button"
            disabled={!currentThreadAvailable}
            onClick={() => onScopeChange('currentThread')}
          >
            {text(locale, '当前线程规则', 'Current thread rules')}
          </button>
        </div>
        <p className="settingsMuted">
          {scope === 'global'
            ? text(locale, '全局规则会影响后续所有未单独配置的线程。', 'Global rules affect threads without their own policy.')
            : text(locale, '当前线程规则只影响这一次任务；它会和全局规则合并执行。', 'Thread rules affect this task only and merge with global rules.')}
        </p>
      </div>

      <div className="settingsCard settingsCardCompact">
        <div className="settingsFieldRow">
          <label>{text(locale, '当前模式', 'Mode')}</label>
          <select
            value={value.mode}
            onChange={(event) => patchPolicy({ mode: event.target.value as AccessPolicyConfig['mode'] })}
          >
            <option value="chat">{modeLabel('chat', locale)}</option>
            <option value="workspace">{modeLabel('workspace', locale)}</option>
            <option value="danger_full_access">{modeLabel('danger_full_access', locale)}</option>
          </select>
        </div>
        <div className="settingsFieldRow">
          <label>{text(locale, '工作区', 'Workspace')}</label>
          <input
            value={value.workspaceRoot}
            onChange={(event) => patchPolicy({ workspaceRoot: event.target.value })}
            placeholder={text(locale, '隐藏对话工作区或项目路径', 'Hidden chat workspace or project path')}
          />
        </div>
      </div>

      <div className="settingsCard settingsCardCompact">
        <div className="settingsSectionTitleRow">
          <div>
            <h3>{text(locale, '持久规则', 'Persistent rules')}</h3>
            <p className="settingsMuted">{text(locale, '拒绝规则优先于允许规则；外部目录建议优先授予读取，不直接授予改写。', 'Deny rules win over allow rules. Prefer read grants for external folders.')}</p>
          </div>
          <button className="whiteButton" type="button" onClick={addRule}>
            {text(locale, '新增规则', 'Add rule')}
          </button>
        </div>

        {persistentRules.length === 0 ? (
          <p className="accessPolicyEmpty">{text(locale, '没有额外持久规则。外部目录、网络或命令会在运行时请求临时授权。', 'No extra persistent rules. External paths, network, and commands will ask for temporary approval at runtime.')}</p>
        ) : (
          <div className="accessRuleList">
            {persistentRules.map((rule) => (
              <article className="accessRuleRow" key={rule.id}>
                <span className="accessRuleId" title={rule.id}>{rule.id}</span>
                <select
                  aria-label={text(locale, '效果', 'Effect')}
                  value={rule.effect}
                  onChange={(event) => patchRule(rule.id, { effect: event.target.value as AccessRule['effect'] })}
                >
                  <option value="allow">{text(locale, '允许', 'Allow')}</option>
                  <option value="deny">{text(locale, '禁止', 'Deny')}</option>
                </select>
                <select
                  aria-label={text(locale, '权限', 'Access')}
                  value={rule.access}
                  onChange={(event) => {
                    const access = event.target.value as AccessKind;
                    patchRule(rule.id, { access, target: defaultTargetForAccess(access) });
                  }}
                >
                  <option value="read">{text(locale, '读取', 'Read')}</option>
                  <option value="write">{text(locale, '改写', 'Write')}</option>
                  <option value="command">{text(locale, '命令', 'Command')}</option>
                  <option value="network">{text(locale, '网络', 'Network')}</option>
                  <option value="tool_call">{text(locale, '工具', 'Tool')}</option>
                </select>
                <input
                  aria-label={text(locale, '目标', 'Target')}
                  value={targetValue(rule.target)}
                  onChange={(event) => patchRule(rule.id, { target: targetFromValue(rule.access, event.target.value) })}
                  placeholder={rule.access === 'network' ? 'api.example.com' : rule.access === 'command' ? 'git status' : 'E:\\langchain\\dexin-agent'}
                />
                <button className="whiteButton accessRuleDelete" type="button" onClick={() => removeRule(rule.id)}>
                  {text(locale, '删除', 'Delete')}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {notice ? <p className="settingsNotice">{notice}</p> : null}
    </section>
  );
}
