import type React from 'react';
import type { Locale } from '../config.js';
import { Icon } from './Icon.js';
import { formatTimestamp } from '../i18n.js';
import { itemHeading } from '../threadView.js';
import type { ThreadItem } from '../types.js';
import { childActivityForCollabItem } from '../subagentActivity.js';

export interface AssistantTurnGroup {
  turnId?: string;
  items: ThreadItem[];
  status?: string;
  timestamp?: string;
}

export function ItemView({
  item,
  locale,
  onBranch,
  onCopy,
  onRollback,
}: {
  item: ThreadItem;
  locale: Locale;
  onBranch?: (turnId: string) => void;
  onCopy?: (text: string) => void;
  onRollback?: (turnId: string) => void;
}) {
  const heading = itemHeading(item, locale);
  if (item.type === 'user_message') {
    return (
      <MessageFrame
        align="user"
        item={item}
        locale={locale}
        text={item.text ?? ''}
        action="rollback"
        onCopy={onCopy}
        onRollback={onRollback}
      >
        <article className="message user">{item.text}</article>
      </MessageFrame>
    );
  }
  if (item.type === 'agent_message') {
    return (
      <MessageFrame
        align="agent"
        item={item}
        locale={locale}
        text={item.text ?? ''}
        action="branch"
        onBranch={onBranch}
        onCopy={onCopy}
      >
        <article className="message agent">{item.text}</article>
      </MessageFrame>
    );
  }
  if (
    item.type === 'tool_call'
    || item.type === 'collab_tool_call'
    || item.type === 'mcp_tool_call'
    || item.type === 'command_execution'
    || item.type === 'context_compaction'
  ) {
    const toolSummary = summarizeToolItem(item, locale);
    return (
      <details className="message tool">
        <summary className="toolSummary">
          <span className="toolSummaryMain">
            <strong className="toolSummaryName">{toolSummary.name}</strong>
            {toolSummary.value ? <span className="toolSummaryValue">{toolSummary.value}</span> : null}
            {toolSummary.meta ? <span className="toolSummaryMeta">{toolSummary.meta}</span> : null}
          </span>
          {toolSummary.status ? <span className="toolSummaryStatus">{toolSummary.status}</span> : null}
        </summary>
        <pre>{formatItemPayload(item)}</pre>
      </details>
    );
  }
  if (item.type === 'file_change') {
    return (
      <details className="message tool">
        <summary>
          <strong>{heading.title}</strong>
          <span>{heading.detail}</span>
        </summary>
        <pre>{formatItemPayload(item)}</pre>
      </details>
    );
  }
  if (item.type === 'error') {
    return <article className="message error">{item.message}</article>;
  }
  return (
    <article className="message muted">
      <strong>{heading.title}</strong>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </article>
  );
}

export function AssistantTurnView({
  group,
  locale,
  onBranch,
  onCopy,
  childActivityByThread = {},
}: {
  group: AssistantTurnGroup;
  locale: Locale;
  onBranch?: (turnId: string) => void;
  onCopy?: (text: string) => void;
  childActivityByThread?: Record<string, ThreadItem[]>;
}) {
  const text = group.items
    .filter((item) => item.type === 'agent_message' && item.text)
    .map((item) => item.text)
    .join('\n\n');
  const timestamp = group.timestamp ?? group.items.find((item) => item.timestamp)?.timestamp ?? new Date().toISOString();
  const hasRunningItem = group.items.some((item) => item.status === 'in_progress');
  return (
    <MessageFrame
      align="agent"
      item={{
        id: `assistant-${group.turnId ?? group.items[0]?.id ?? 'turn'}`,
        type: 'agent_message',
        turnId: group.turnId,
        text,
        status: group.status === 'running' || hasRunningItem ? 'in_progress' : group.status,
        timestamp,
      }}
      locale={locale}
      text={text}
      action="branch"
      onBranch={onBranch}
      onCopy={onCopy}
      showActionRow={Boolean(text.trim())}
    >
      <article className="message agent assistantTurnBubble">
        {group.items.map((item) => {
          if (item.type === 'agent_message') {
            return item.text ? <p className="assistantTurnText" key={item.id}>{item.text}</p> : null;
          }
          if (
            item.type === 'tool_call'
            || item.type === 'collab_tool_call'
            || item.type === 'mcp_tool_call'
            || item.type === 'command_execution'
            || item.type === 'context_compaction'
            || item.type === 'file_change'
          ) {
            return (
              <ToolDetails
                childItems={childActivityForCollabItem(item, childActivityByThread)}
                item={item}
                key={item.id}
                locale={locale}
                compact
              />
            );
          }
          if (item.type === 'error') {
            return <p className="assistantTurnError" key={item.id}>{item.message}</p>;
          }
          return <pre key={item.id}>{JSON.stringify(item, null, 2)}</pre>;
        })}
      </article>
    </MessageFrame>
  );
}

export interface ToolSummary {
  name: string;
  value: string;
  meta: string;
  status: string;
}

export function summarizeToolItem(item: ThreadItem, locale: Locale): ToolSummary {
  const args = readObject(item.arguments);
  const status = formatToolStatus(item.status, locale);
  if (item.type === 'command_execution') {
    return {
      name: 'shell_command',
      value: truncateInline(String(item.command ?? args.command ?? ''), 120),
      meta: typeof args.cwd === 'string' ? truncateInline(args.cwd, 80) : '',
      status,
    };
  }
  if (item.type === 'mcp_tool_call') {
    return {
      name: [item.server, item.tool].filter(Boolean).join(' / ') || 'mcp_tool',
      value: truncateInline(firstArgValue(args, ['query', 'pattern', 'url', 'path', 'filePath', 'command', 'name']), 120),
      meta: summarizeRemainingArgs(args, ['query', 'pattern', 'url', 'path', 'filePath', 'command', 'name']),
      status,
    };
  }
  if (item.type === 'collab_tool_call') {
    return {
      name: item.tool ?? 'collab_tool',
      value: truncateInline(String(item.prompt ?? item.receiverThreadId ?? item.newThreadId ?? ''), 120),
      meta: truncateInline(String(item.agentStatus ?? item.receiverThreadId ?? item.newThreadId ?? ''), 100),
      status,
    };
  }
  if (item.type === 'context_compaction') {
    const turns = item.compactedTurnIds?.length ?? 0;
    return {
      name: locale === 'zh' ? '上下文压缩' : 'context_compaction',
      value: locale === 'zh'
        ? `${item.trigger === 'auto' ? '自动' : '手动'} · ${turns} 轮`
        : `${item.trigger === 'auto' ? 'auto' : 'manual'} · ${turns} turns`,
      meta: `${Number(item.tokensBefore ?? 0)} -> ${Number(item.tokensAfter ?? 0)} tokens`,
      status,
    };
  }

  const name = item.toolName ?? 'tool';
  const valueKeys = preferredValueKeys(name);
  const metaKeys = preferredMetaKeys(name);
  const meta = name === 'search_content'
    ? firstArgValue(args, metaKeys)
    : summarizePickedArgs(args, metaKeys);
  return {
    name,
    value: truncateInline(firstArgValue(args, valueKeys), 120),
    meta: truncateInline(meta || summarizeRemainingArgs(args, valueKeys), 100),
    status,
  };
}

function ToolDetails({
  childItems = [],
  compact = false,
  item,
  locale,
}: {
  childItems?: ThreadItem[];
  compact?: boolean;
  item: ThreadItem;
  locale: Locale;
}) {
  const heading = itemHeading(item, locale);
  if (item.type === 'file_change') {
    return (
      <details className={compact ? 'message tool inlineTool' : 'message tool'}>
        <summary>
          <strong>{heading.title}</strong>
          <span>{heading.detail}</span>
        </summary>
        <pre>{formatItemPayload(item)}</pre>
      </details>
    );
  }
  const toolSummary = summarizeToolItem(item, locale);
  return (
    <details className={compact ? 'message tool inlineTool' : 'message tool'}>
      <summary className="toolSummary">
        <span className="toolSummaryMain">
          <strong className="toolSummaryName">{toolSummary.name}</strong>
          {toolSummary.value ? <span className="toolSummaryValue">{toolSummary.value}</span> : null}
          {toolSummary.meta ? <span className="toolSummaryMeta">{toolSummary.meta}</span> : null}
        </span>
        {toolSummary.status ? <span className="toolSummaryStatus">{toolSummary.status}</span> : null}
      </summary>
      <pre>{formatItemPayload(item)}</pre>
      <ChildActivityList items={childItems} locale={locale} />
    </details>
  );
}

function ChildActivityList({ items, locale }: { items: ThreadItem[]; locale: Locale }) {
  if (items.length === 0) return null;
  return (
    <div className="childActivity">
      <div className="childActivityHeader">{locale === 'zh' ? '子 Agent 活动' : 'Child agent activity'}</div>
      {items.map((item) => {
        if (item.type === 'agent_message') {
          return <p className="childActivityText" key={item.id}>{item.text}</p>;
        }
        if (item.type === 'error') {
          return <p className="childActivityError" key={item.id}>{item.message}</p>;
        }
        return <ToolDetails item={item} locale={locale} key={item.id} compact />;
      })}
    </div>
  );
}

function MessageFrame({
  align,
  children,
  item,
  locale,
  action,
  onBranch,
  onCopy,
  onRollback,
  showActionRow = true,
  text,
}: {
  align: 'agent' | 'user';
  children: React.ReactNode;
  item: ThreadItem;
  locale: Locale;
  action: 'branch' | 'rollback';
  onBranch?: (turnId: string) => void;
  onCopy?: (text: string) => void;
  onRollback?: (turnId: string) => void;
  showActionRow?: boolean;
  text: string;
}) {
  const timestamp = item.timestamp ?? new Date().toISOString();
  const actionTitle = action === 'branch'
    ? (locale === 'zh' ? '从这里分支对话' : 'Branch from here')
    : (locale === 'zh' ? '回退到这里' : 'Rollback to here');
  const runAction = action === 'branch' ? onBranch : onRollback;
  const showActions = showActionRow && item.status !== 'in_progress';
  return (
    <div className={align === 'user' ? 'messageBlock user' : 'messageBlock agent'}>
      {children}
      {showActions ? (
      <div className="messageActions">
        <time className="messageTimestamp">{formatTimestamp(timestamp, locale)}</time>
        <button
          className="messageActionButton"
          title={locale === 'zh' ? '复制' : 'Copy'}
          aria-label={locale === 'zh' ? '复制' : 'Copy'}
          onClick={() => onCopy?.(text)}
        >
          <Icon name="copy" />
        </button>
        {item.turnId ? (
          <button
            className="messageActionButton"
            title={actionTitle}
            aria-label={actionTitle}
            onClick={() => runAction?.(item.turnId!)}
          >
            <Icon name={action === 'branch' ? 'branch' : 'pen'} />
          </button>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

function formatItemPayload(item: ThreadItem): string {
  if (item.type === 'command_execution') {
    return String(item.aggregatedOutput ?? item.result ?? item.error?.message ?? item.arguments ?? '');
  }
  const payload = item.result ?? item.error ?? item.arguments ?? item;
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function preferredValueKeys(toolName: string): string[] {
  switch (toolName) {
    case 'search_content':
      return ['pattern', 'query', 'text'];
    case 'read_file':
    case 'write_file':
      return ['filePath', 'path'];
    case 'shell_command':
      return ['command'];
    case 'apply_patch':
      return ['patch'];
    case 'current_time':
      return ['timeZone', 'locale'];
    default:
      return ['query', 'pattern', 'filePath', 'path', 'command', 'url', 'name', 'text'];
  }
}

function preferredMetaKeys(toolName: string): string[] {
  switch (toolName) {
    case 'search_content':
      return ['path', 'fileTypes'];
    case 'read_file':
      return ['offset', 'limit'];
    case 'write_file':
      return ['content'];
    case 'shell_command':
      return ['cwd'];
    default:
      return [];
  }
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstArgValue(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in args)) continue;
    const value = formatArgValue(args[key], key);
    if (value) return value;
  }
  return '';
}

function summarizeRemainingArgs(args: Record<string, unknown>, skipKeys: string[]): string {
  const skip = new Set(skipKeys);
  return Object.entries(args)
    .filter(([key, value]) => !skip.has(key) && value !== undefined && value !== null && value !== '')
    .slice(0, 2)
    .map(([key, value]) => `${key} ${formatArgValue(value, key)}`)
    .join(' · ');
}

function summarizePickedArgs(args: Record<string, unknown>, keys: string[]): string {
  return keys
    .filter((key) => args[key] !== undefined && args[key] !== null && args[key] !== '')
    .slice(0, 2)
    .map((key) => `${key} ${formatArgValue(args[key], key)}`)
    .join(' · ');
}

function formatArgValue(value: unknown, key = ''): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return '';
    if (key === 'content' || key === 'patch') return `${text.length} chars`;
    return text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => formatArgValue(entry)).filter(Boolean).join(', ');
  return JSON.stringify(value);
}

function formatToolStatus(status: string | undefined, locale: Locale): string {
  if (!status) return '';
  if (locale !== 'zh') return status;
  if (status === 'completed') return '完成';
  if (status === 'in_progress') return '进行中';
  if (status === 'failed') return '失败';
  return status;
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}
