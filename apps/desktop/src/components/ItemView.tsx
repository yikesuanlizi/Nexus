import type React from 'react';
import type { Locale } from '../config/config.js';
import { Icon } from './Icon.js';
import { formatTimestamp } from '../shared/i18n.js';
import { itemHeading } from '../features/chat/threadView.js';
import type { ThreadItem } from '../shared/types.js';
import { childActivityForCollabItem } from '../features/agents/subagentActivity.js';
import { RobotMoodIcon, type RobotMoodVariant } from './AgentStagePanel.js';
import { UserAvatar } from './UserAvatar.js';

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
  onPreviewFile,
  onOpenFile,
  userAvatarId,
  customUserAvatarDataUrl,
}: {
  item: ThreadItem;
  locale: Locale;
  onBranch?: (turnId: string) => void;
  onCopy?: (text: string) => void;
  onRollback?: (turnId: string) => void;
  /** 点击"预览"按钮时调用，参数为文件路径 */
  // — Chinese: called when "preview" button is clicked, with file path as argument
  onPreviewFile?: (path: string) => void;
  /** 点击"在编辑器中打开"按钮时调用，参数为文件路径（仅桌面端） */
  // — Chinese: called when "open in editor" is clicked, with file path (desktop only)
  onOpenFile?: (path: string) => void;
  userAvatarId?: string;
  customUserAvatarDataUrl?: string;
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
        userAvatarId={userAvatarId}
        customUserAvatarDataUrl={customUserAvatarDataUrl}
      >
        <article className="message user"><RichMessageText text={item.text ?? ''} onCopy={onCopy} /></article>
      </MessageFrame>
    );
  }
  if (item.type === 'agent_message') {
    const text = sanitizeAgentMessageTextForDisplay(item.text ?? '', locale);
    return (
      <MessageFrame
        align="agent"
        item={item}
        locale={locale}
        text={text}
        action="branch"
        onBranch={onBranch}
        onCopy={onCopy}
      >
        <article className="message agent">
          <RichMessageText showStreamingOutputIcon={item.status === 'in_progress' && Boolean(text.trim())} text={text} onCopy={onCopy} />
        </article>
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
        <ToolItemActions item={item} locale={locale} onPreviewFile={onPreviewFile} onOpenFile={onOpenFile} />
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
        <ToolItemActions item={item} locale={locale} onPreviewFile={onPreviewFile} onOpenFile={onOpenFile} />
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
  onPreviewFile,
  onOpenFile,
  childActivityByThread = {},
}: {
  group: AssistantTurnGroup;
  locale: Locale;
  onBranch?: (turnId: string) => void;
  onCopy?: (text: string) => void;
  /** 点击"预览"按钮时调用，参数为文件路径 */
  // — Chinese: called when "preview" button is clicked, with file path as argument
  onPreviewFile?: (path: string) => void;
  /** 点击"在编辑器中打开"按钮时调用，参数为文件路径（仅桌面端） */
  // — Chinese: called when "open in editor" is clicked, with file path (desktop only)
  onOpenFile?: (path: string) => void;
  childActivityByThread?: Record<string, ThreadItem[]>;
}) {
  const text = group.items
    .filter((item) => item.type === 'agent_message' && item.text)
    .map((item) => sanitizeAgentMessageTextForDisplay(item.text ?? '', locale))
    .join('\n\n');
  const timestamp = group.timestamp ?? group.items.find((item) => item.timestamp)?.timestamp ?? new Date().toISOString();
  const hasRunningItem = group.items.some((item) => item.status === 'in_progress');
  const agentItems = group.items.filter((item) => item.type === 'agent_message' && item.text);
  const streamingAgentItemId = [...agentItems].reverse().find((item) => item.status === 'in_progress')?.id
    ?? ((group.status === 'running' || hasRunningItem) ? agentItems.at(-1)?.id : undefined);
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
            const itemText = sanitizeAgentMessageTextForDisplay(item.text ?? '', locale);
            return itemText ? (
              <RichMessageText
                className="assistantTurnText"
                key={item.id}
                showStreamingOutputIcon={item.id === streamingAgentItemId}
                text={itemText}
                onCopy={onCopy}
              />
            ) : null;
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
                onPreviewFile={onPreviewFile}
                onOpenFile={onOpenFile}
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

export function sanitizeAgentMessageTextForDisplay(text: string, locale: Locale): string {
  const toolTagIndex = findPlainTextToolTagIndex(text);
  if (toolTagIndex < 0) return text;
  const prefix = text.slice(0, toolTagIndex).trimEnd();
  const note = locale === 'zh'
    ? '[已隐藏模型误输出的文本工具调用；后续版本会要求模型用结构化 tool call 重试。]'
    : '[A plain-text tool call emitted by the model was hidden; newer runs will retry with structured tool calls.]';
  return prefix ? `${prefix}\n\n${note}` : note;
}

function findPlainTextToolTagIndex(text: string): number {
  const normalized = text.replace(/｜/g, '|');
  const match = /<\|+(?:DSML\|+)?(?:tool_calls|invoke|parameter)/i.exec(normalized);
  return match?.index ?? -1;
}

function RichMessageText({
  className,
  onCopy,
  showStreamingOutputIcon = false,
  text,
}: {
  className?: string;
  onCopy?: (text: string) => void;
  showStreamingOutputIcon?: boolean;
  text: string;
}) {
  const parts = splitFencedCode(text);
  if (parts.length === 1 && parts[0]?.kind === 'text') {
    return (
      <p className={streamingTextClassName(className ?? 'messageText', showStreamingOutputIcon)}>
        {showStreamingOutputIcon ? <StreamingOutputIcon /> : null}
        <span>{text}</span>
      </p>
    );
  }
  return (
    <div className={className ? `${className} richMessageText` : 'richMessageText'}>
      {parts.map((part, index) => {
        if (part.kind === 'code') {
          return (
            <CodeBlock
              code={part.code}
              key={`${part.kind}-${index}`}
              language={part.language}
              onCopy={onCopy}
            />
          );
        }
        const showIcon = showStreamingOutputIcon && index === firstTextPartIndex(parts);
        return part.text ? (
          <p className={streamingTextClassName('messageText', showIcon)} key={`${part.kind}-${index}`}>
            {showIcon ? <StreamingOutputIcon /> : null}
            <span>{part.text}</span>
          </p>
        ) : null;
      })}
    </div>
  );
}

function streamingTextClassName(baseClassName: string, showStreamingOutputIcon: boolean): string {
  return showStreamingOutputIcon ? `${baseClassName} streamingOutputLine` : baseClassName;
}

function firstTextPartIndex(parts: Array<{ kind: 'text'; text: string } | { kind: 'code'; language: string; code: string }>): number {
  return parts.findIndex((part) => part.kind === 'text' && part.text.trim());
}

function StreamingOutputIcon() {
  return (
    <span className="streamingOutputIcon" aria-hidden="true">
      <svg viewBox="-15 -30 150 170">
        <ellipse cx="48" cy="120" rx="24" ry="5" fill="#cbd5e1">
          <animate attributeName="rx" values="24; 20; 24" dur="1s" repeatCount="indefinite" />
        </ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-2; 0,2; 0,-2" dur="1s" repeatCount="indefinite" />
          <path d="M18 62 L8 66" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" fill="none" />
          <circle cx="6" cy="67" r="7" fill="#fff" stroke="#0f172a" strokeWidth="4" />
          <rect x="9" y="54" width="11" height="9" rx="2" fill="#6366f1" stroke="#0f172a" strokeWidth="2.5" />
          <rect x="16" y="36" width="50" height="56" rx="16" fill="#c7d2fe" stroke="#0f172a" strokeWidth="5" />
          <path d="M36 36 L33 17" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
          <circle cx="32" cy="15" r="6" fill="#ef4444" stroke="#0f172a" strokeWidth="4">
            <animate attributeName="fill" values="#ef4444; #fca5a5; #ef4444" dur="0.3s" repeatCount="indefinite" />
          </circle>
          <rect x="23" y="46" width="36" height="26" rx="8" fill="#0f172a" />
          <line x1="29" y1="57" x2="37" y2="57" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" />
          <line x1="45" y1="57" x2="53" y2="57" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" />
          <line x1="37" y1="65" x2="45" y2="65" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" />
          <g>
            <animateTransform attributeName="transform" type="translate" values="0,-4; 0,4; 0,-4" dur="0.35s" repeatCount="indefinite" />
            <path d="M66 58 L78 64" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" fill="none" />
            <circle cx="80" cy="65" r="7" fill="#fff" stroke="#0f172a" strokeWidth="4" />
          </g>
        </g>
        <g>
          <line x1="82" y1="88" x2="82" y2="100" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          <line x1="118" y1="88" x2="118" y2="100" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          <circle cx="82" cy="82" r="8" fill="#64748b" stroke="#0f172a" strokeWidth="4">
            <animateTransform attributeName="transform" type="rotate" from="0 82 82" to="360 82 82" dur="0.3s" repeatCount="indefinite" />
          </circle>
          <circle cx="118" cy="82" r="8" fill="#64748b" stroke="#0f172a" strokeWidth="4">
            <animateTransform attributeName="transform" type="rotate" from="0 118 82" to="360 118 82" dur="0.3s" repeatCount="indefinite" />
          </circle>
          <line x1="76" y1="82" x2="88" y2="82" stroke="#0f172a" strokeWidth="2" opacity="0.4">
            <animateTransform attributeName="transform" type="rotate" from="0 82 82" to="360 82 82" dur="0.3s" repeatCount="indefinite" />
          </line>
          <line x1="112" y1="82" x2="124" y2="82" stroke="#0f172a" strokeWidth="2" opacity="0.4">
            <animateTransform attributeName="transform" type="rotate" from="0 118 82" to="360 118 82" dur="0.3s" repeatCount="indefinite" />
          </line>
          <rect x="82" y="74" width="36" height="3" rx="1.5" fill="#0f172a" />
          <rect x="82" y="87" width="36" height="3" rx="1.5" fill="#0f172a" />
          <g>
            <line x1="86" y1="74" x2="86" y2="90" stroke="#94a3b8" strokeWidth="2.5">
              <animate attributeName="x1" values="86; 122; 86" dur="0.3s" repeatCount="indefinite" />
              <animate attributeName="x2" values="86; 122; 86" dur="0.3s" repeatCount="indefinite" />
            </line>
            <line x1="94" y1="74" x2="94" y2="90" stroke="#94a3b8" strokeWidth="2.5">
              <animate attributeName="x1" values="94; 86; 94" dur="0.3s" repeatCount="indefinite" />
              <animate attributeName="x2" values="94; 86; 94" dur="0.3s" repeatCount="indefinite" />
            </line>
            <line x1="102" y1="74" x2="102" y2="90" stroke="#94a3b8" strokeWidth="2.5">
              <animate attributeName="x1" values="102; 94; 102" dur="0.3s" repeatCount="indefinite" />
              <animate attributeName="x2" values="102; 94; 102" dur="0.3s" repeatCount="indefinite" />
            </line>
            <line x1="110" y1="74" x2="110" y2="90" stroke="#94a3b8" strokeWidth="2.5">
              <animate attributeName="x1" values="110; 102; 110" dur="0.3s" repeatCount="indefinite" />
              <animate attributeName="x2" values="110; 102; 110" dur="0.3s" repeatCount="indefinite" />
            </line>
          </g>
        </g>
        <g>
          <rect x="84" y="65" width="11" height="9" rx="2" fill="#6366f1" stroke="#0f172a" strokeWidth="2.5">
            <animate attributeName="x" values="84; 115; 115" keyTimes="0; 0.85; 1" dur="0.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1; 1; 0" keyTimes="0; 0.85; 1" dur="0.6s" repeatCount="indefinite" />
          </rect>
          <rect x="84" y="65" width="11" height="9" rx="2" fill="#818cf8" stroke="#0f172a" strokeWidth="2.5">
            <animate attributeName="x" values="84; 115; 115" keyTimes="0; 0.85; 1" dur="0.6s" begin="0.3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1; 1; 0" keyTimes="0; 0.85; 1" dur="0.6s" begin="0.3s" repeatCount="indefinite" />
          </rect>
        </g>
      </svg>
    </span>
  );
}

function CodeBlock({
  code,
  language,
  onCopy,
}: {
  code: string;
  language: string;
  onCopy?: (text: string) => void;
}) {
  return (
    <figure className="codeBlock">
      <figcaption>
        <span>{language || 'code'}</span>
        <button
          className="codeCopyButton"
          type="button"
          title="Copy code"
          aria-label="Copy code"
          onClick={() => onCopy?.(code)}
        >
          <Icon name="copy" />
        </button>
      </figcaption>
      <pre><code>{code}</code></pre>
    </figure>
  );
}

function splitFencedCode(text: string): Array<{ kind: 'text'; text: string } | { kind: 'code'; language: string; code: string }> {
  const parts: Array<{ kind: 'text'; text: string } | { kind: 'code'; language: string; code: string }> = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', text: text.slice(lastIndex, match.index).trimEnd() });
    }
    parts.push({
      kind: 'code',
      language: match[1]?.trim() ?? '',
      code: match[2]?.replace(/\n$/, '') ?? '',
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: 'text', text: text.slice(lastIndex).trimStart() });
  }
  return parts.length > 0 ? parts : [{ kind: 'text', text }];
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
    // 中文注释：协作工具的本地化名 + 远程 Agent URL 标记
    // Chinese: localized name for collab tool + remote agent URL marker
    const isRemote = item.tool === 'spawn_remote_agent';
    const nameMap: Record<string, string> = locale === 'zh'
      ? {
          spawn_agent: '生成子 Agent',
          send_input: '发送输入',
          resume_agent: '恢复子 Agent',
          wait: '等待子 Agent',
          list_agents: '列出子 Agent',
          close_agent: '关闭子 Agent',
          spawn_remote_agent: '调用远程 Agent',
        }
      : {
          spawn_agent: 'Spawn Agent',
          send_input: 'Send Input',
          resume_agent: 'Resume Agent',
          wait: 'Wait Agent',
          list_agents: 'List Agents',
          close_agent: 'Close Agent',
          spawn_remote_agent: 'Remote Agent',
        };
    const label = nameMap[item.tool as string] ?? item.tool ?? 'collab_tool';
    const valueSource = item.prompt ?? (isRemote ? item.receiverThreadId : item.newThreadId) ?? '';
    const metaSource = isRemote
      ? (item.receiverThreadId ?? '')
      : (item.agentStatus ?? item.receiverThreadId ?? item.newThreadId ?? '');
    return {
      name: label,
      value: truncateInline(String(valueSource), 120),
      meta: truncateInline(String(metaSource), 100),
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
  onPreviewFile,
  onOpenFile,
}: {
  childItems?: ThreadItem[];
  compact?: boolean;
  item: ThreadItem;
  locale: Locale;
  onPreviewFile?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const heading = itemHeading(item, locale);
  if (item.type === 'file_change') {
    return (
      <details className={compact ? 'message tool inlineTool' : 'message tool'}>
        <summary>
          <strong>{heading.title}</strong>
          <span>{heading.detail}</span>
        </summary>
        <ToolItemActions item={item} locale={locale} onPreviewFile={onPreviewFile} onOpenFile={onOpenFile} />
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
      <RemoteAgentStream item={item} locale={locale} />
      <ToolItemActions item={item} locale={locale} onPreviewFile={onPreviewFile} onOpenFile={onOpenFile} />
      <pre>{formatItemPayload(item)}</pre>
      <ChildActivityList items={childItems} locale={locale} />
    </details>
  );
}

/**
 * 远程 Agent 中间状态展示：
 * - 状态轨迹（remoteStatusTrail）：working → input-required → completed 的时间线
 * - 中间文本流（remoteTextStream）：远程 Agent 流式返回的中间文本片段
 * 仅对 spawn_remote_agent 工具有效，其他工具直接返回 null。
 */
// — Chinese: remote agent intermediate state display. Status trail + text stream.
// Only effective for spawn_remote_agent tool.
function RemoteAgentStream({ item, locale }: { item: ThreadItem; locale: Locale }) {
  if (item.type !== 'collab_tool_call' || item.tool !== 'spawn_remote_agent') return null;
  const trail = item.remoteStatusTrail ?? [];
  const textStream = item.remoteTextStream ?? [];
  if (trail.length === 0 && textStream.length === 0) return null;

  const stateLabel = (state: string): { text: string; className: string } => {
    switch (state) {
      case 'working':
        return { text: locale === 'zh' ? '运行中' : 'working', className: 'remoteStatusState working' };
      case 'input-required':
        return { text: locale === 'zh' ? '等待输入' : 'input-required', className: 'remoteStatusState inputRequired' };
      case 'completed':
        return { text: locale === 'zh' ? '已完成' : 'completed', className: 'remoteStatusState completed' };
      case 'failed':
      case 'canceled':
      case 'rejected':
        return { text: locale === 'zh' ? `失败(${state})` : `failed(${state})`, className: 'remoteStatusState failed' };
      default:
        return { text: state, className: 'remoteStatusState' };
    }
  };

  return (
    <div className="remoteAgentStream">
      {trail.length > 0 ? (
        <div className="remoteStatusTrail">
          <div className="remoteStreamHeader">
            {locale === 'zh' ? '状态轨迹' : 'Status trail'}
          </div>
          {trail.map((entry, idx) => {
            const label = stateLabel(entry.state);
            return (
              <div className="remoteStatusEntry" key={`trail-${idx}`}>
                <span className={label.className}>{label.text}</span>
                <span className="remoteStatusTime">{entry.timestamp}</span>
                {entry.text ? <span className="remoteStatusText">{entry.text}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {textStream.length > 0 ? (
        <div className="remoteTextStream">
          <div className="remoteStreamHeader">
            {locale === 'zh' ? '中间文本流' : 'Intermediate text stream'}
          </div>
          {textStream.map((chunk, idx) => (
            <p className="remoteTextChunk" key={`text-${idx}`}>{chunk.text}</p>
          ))}
        </div>
      ) : null}
    </div>
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
        if (item.type === 'reasoning') {
          // 中文注释：子 agent 的推理过程，默认折叠，灰色文本
          // — Chinese: child agent reasoning, collapsed by default, gray text
          const text = item.text ?? '';
          if (!text.trim()) return null;
          return (
            <details className="childActivityReasoning" key={item.id}>
              <summary>
                <Icon name="spark" />
                <span>{locale === 'zh' ? '推理过程' : 'Reasoning'}</span>
              </summary>
              <p className="childActivityReasoningText">{text}</p>
            </details>
          );
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
  userAvatarId,
  customUserAvatarDataUrl,
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
  userAvatarId?: string;
  customUserAvatarDataUrl?: string;
}) {
  const timestamp = item.timestamp ?? new Date().toISOString();
  const actionTitle = action === 'branch'
    ? (locale === 'zh' ? '从这里分支对话' : 'Branch from here')
    : (locale === 'zh' ? '回退到这里' : 'Rollback to here');
  const runAction = action === 'branch' ? onBranch : onRollback;
  const showActions = showActionRow && item.status !== 'in_progress';
  const moodVariant = messageMoodVariant(item, text);
  return (
    <div className={align === 'user' ? 'messageBlock user' : 'messageBlock agent'}>
      {align === 'agent' ? (
        <div className={['messageAgentAvatar', moodVariant].join(' ')} aria-hidden="true">
          <RobotMoodIcon variant={moodVariant} />
        </div>
      ) : null}
      {children}
      {align === 'user' ? (
        <div className="messageUserAvatar" aria-hidden="true">
          <UserAvatar avatarId={userAvatarId} customDataUrl={customUserAvatarDataUrl} size="sm" />
        </div>
      ) : null}
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

function messageMoodVariant(item: ThreadItem, text: string): RobotMoodVariant {
  if (item.status === 'in_progress') return text.trim() ? 'working' : 'thinking';
  if (item.status === 'completed') return 'idle';
  if (item.status === 'failed' || item.status === 'cancelled') return 'thinking';
  return 'idle';
}

/**
 * 工具条目操作按钮：从 item 中提取文件路径，渲染"预览"和"在编辑器中打开"按钮。
 * — Chinese: tool item action buttons — extract file paths from item, render "preview" and "open in editor" buttons.
 */
function ToolItemActions({
  item,
  locale,
  onPreviewFile,
  onOpenFile,
}: {
  item: ThreadItem;
  locale: Locale;
  onPreviewFile?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const filePaths = extractFilePaths(item);
  if (filePaths.length === 0 || (!onPreviewFile && !onOpenFile)) return null;
  return (
    <div className="toolItemActions">
      {filePaths.map((filePath, index) => (
        <div className="toolItemFilePath" key={`${filePath}-${index}`}>
          <span className="toolItemFilePathLabel" title={filePath}>{filePath}</span>
          {onPreviewFile ? (
            <button
              className="toolItemActionButton"
              type="button"
              title={locale === 'zh' ? '在右侧预览' : 'Preview in right panel'}
              onClick={() => onPreviewFile(filePath)}
            >
              <Icon name="eye" />
              <span>{locale === 'zh' ? '预览' : 'Preview'}</span>
            </button>
          ) : null}
          {onOpenFile ? (
            <button
              className="toolItemActionButton"
              type="button"
              title={locale === 'zh' ? '在系统编辑器中打开' : 'Open in system editor'}
              onClick={() => onOpenFile(filePath)}
            >
              <Icon name="folderCode" />
              <span>{locale === 'zh' ? '打开' : 'Open'}</span>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 从工具条目中提取文件路径列表。
 * — Chinese: extract file path list from a tool item.
 */
function extractFilePaths(item: ThreadItem): string[] {
  if (item.type === 'file_change') {
    return (item.changes ?? []).map((change) => change.path).filter((p) => typeof p === 'string' && p.trim());
  }
  if (item.type === 'tool_call' || item.type === 'mcp_tool_call') {
    const args = readObject(item.arguments);
    const path = firstArgValue(args, ['filePath', 'path']);
    return path ? [path] : [];
  }
  return [];
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
    case 'web_search':
      return ['action', 'url', 'query', 'queries', 'pattern'];
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
