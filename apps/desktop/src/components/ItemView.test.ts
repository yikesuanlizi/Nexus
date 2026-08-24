import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantTurnView, ItemView, resolveElapsedMs, sanitizeAgentMessageTextForDisplay, summarizeToolItem, terminalTimestampForItem } from './ItemView.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('agent message avatars', () => {
  it('renders the Nexus robot mood avatar for assistant history and streaming turns', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');

    expect(source).toContain('messageAgentAvatar');
    expect(source).toContain('<RobotMoodIcon variant={moodVariant} />');
    // 进行中不再播放 working/thinking 头像动画（流式输出旁已有 StreamingOutputIcon），
    // 避免同一气泡两个"思考"动画重复。
    // — English: in-progress avatars are static now (the StreamingOutputIcon is
    //   the single thinking indicator) — no duplicate animations in one bubble.
    expect(source).toContain("if (item.status === 'in_progress') return 'idle';");
  });

  it('renders the working icon inline on the active streaming output line', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');

    expect(source).toContain('showStreamingOutputIcon');
    expect(source).toContain('function StreamingOutputIcon()');
    expect(source).toContain('streamingOutputIcon');
    expect(source).toContain('M18 62 L8 66');
    expect(source).toContain('values="84; 115; 115"');
    expect(source).toContain('from="0 82 82" to="360 82 82"');
    expect(source).toContain("item.id === streamingAgentItemId");
    expect(styles).toContain('.streamingOutputLine');
    expect(styles).toContain('grid-template-columns: 34px minmax(0, 1fr);');
  });

  it('renders user messages with the configured user avatar on the right side', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');

    expect(source).toContain('messageUserAvatar');
    expect(source).toContain('<UserAvatar avatarId={userAvatarId} customDataUrl={customUserAvatarDataUrl} size="sm" />');
    expect(styles).toContain('.messageBlock.user > .messageUserAvatar');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 38px;');
  });
});

describe('tool item summaries', () => {
  it('shows the searched content for search_content calls', () => {
    const summary = summarizeToolItem({
      id: 'tool-1',
      type: 'tool_call',
      toolName: 'search_content',
      arguments: { pattern: '工具调用', path: 'apps/web' },
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('search_content');
    expect(summary.value).toBe('工具调用');
    expect(summary.meta).toBe('apps/web');
  });

  it('shows the file path for read_file calls', () => {
    const summary = summarizeToolItem({
      id: 'tool-2',
      type: 'tool_call',
      toolName: 'read_file',
      arguments: { filePath: 'apps/web/src/main.tsx', offset: 10 },
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('read_file');
    expect(summary.value).toBe('apps/web/src/main.tsx');
    expect(summary.meta).toBe('offset 10');
  });

  it('uses the command text for command execution rows', () => {
    const summary = summarizeToolItem({
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm test',
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('shell_command');
    expect(summary.value).toBe('npm test');
  });
});

describe('message markdown rendering', () => {
  it('renders markdown tables and emphasis in assistant messages', () => {
    const html = renderToStaticMarkup(
      React.createElement(ItemView, {
        item: {
          id: 'agent-1',
          type: 'agent_message',
          text: [
            '文档缺失:',
            '| 知识类型 | 时效特征 | 当前文档缺失 |',
            '|---|---|---|',
            '| **MEL/CDL** | 经常更新 | 未说明版本 |',
          ].join('\n'),
          status: 'completed',
        },
        locale: 'zh',
      }),
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<strong>MEL/CDL</strong>');
    expect(html).not.toContain('|---|---|---|');
  });

  it('keeps assistant markdown emphasis on the base text color', () => {
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');
    const paleMessageStrongRule = styles.indexOf('.message summary,\n  .message strong,');
    const readableMarkdownStrongRule = styles.indexOf('.message.agent .markdownMessageText :where(strong, b)');

    expect(paleMessageStrongRule).toBeGreaterThan(-1);
    expect(readableMarkdownStrongRule).toBeGreaterThan(paleMessageStrongRule);
    expect(styles).toMatch(/\.message\.agent \.markdownMessageText :where\(strong, b\)\s*\{\s*color: var\(--nx-text\);\s*\}/);
  });
});

describe('message action visibility', () => {
  it('keeps reasoning output collapsed instead of rendering its raw item payload', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantTurnView, {
        group: {
          turnId: 'turn-reasoning',
          completedAt: '2026-08-23T00:00:03.000Z',
          items: [
            { id: 'reasoning-1', type: 'reasoning', turnId: 'turn-reasoning', text: '内部推理文本', status: 'completed', timestamp: '2026-08-23T00:00:00.000Z' },
          ],
        },
        locale: 'zh',
      }),
    );

    expect(html).toContain('<details class="reasoningDetails">');
    // 折叠标题由 CSS 显示为 THINK 小字；summary 内容为思考时长（思考 Ns）。
    // — English: the fold title is the CSS THINK label; the summary carries the
    //   thinking-time span.
    expect(html).toContain('reasoningElapsed');
    expect(html).toContain('思考 ');
    expect(html).toContain('内部推理文本');
    expect(html).not.toContain('&quot;type&quot;:&quot;reasoning&quot;');
  });

  it('shows timestamp and copy actions for error-only assistant turns', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantTurnView, {
        group: {
          turnId: 'turn-error',
          items: [
            { id: 'err-1', type: 'error', turnId: 'turn-error', message: 'OpenAI gateway error (401)', status: 'failed' },
          ],
        },
        locale: 'zh',
      }),
    );

    expect(html).toContain('OpenAI gateway error (401)');
    expect(html).toContain('messageActions');
    expect(html).toContain('messageTimestamp');
    expect(html).toContain('aria-label="复制"');
  });

  it('only renders rollback on a user message when explicitly allowed', () => {
    const baseItem = { id: 'u1', type: 'user_message', turnId: 'turn-1', text: '你好', status: 'completed' };
    const hidden = renderToStaticMarkup(
      React.createElement(ItemView, { item: baseItem, locale: 'zh', canRollback: false }),
    );
    const visible = renderToStaticMarkup(
      React.createElement(ItemView, { item: baseItem, locale: 'zh', canRollback: true }),
    );

    expect(hidden).not.toContain('回退到这里');
    expect(visible).toContain('回退到这里');
  });

  it('renders regenerate only for the latest assistant turn when allowed', () => {
    const group = {
      turnId: 'turn-1',
      items: [{ id: 'a1', type: 'agent_message', turnId: 'turn-1', text: '回答', status: 'completed' }],
    };
    const hidden = renderToStaticMarkup(
      React.createElement(AssistantTurnView, { group, locale: 'zh', canRegenerate: false }),
    );
    const visible = renderToStaticMarkup(
      React.createElement(AssistantTurnView, { group, locale: 'zh', canRegenerate: true }),
    );

    expect(hidden).not.toContain('重新回答');
    expect(visible).toContain('重新回答');
  });

  it('freezes terminal reasoning duration at a known same-turn endpoint', () => {
    const reasoning = { id: 'r1', type: 'reasoning', turnId: 't1', text: '思考', status: 'completed', timestamp: '2026-08-23T00:00:00.000Z' } as const;
    const nextItem = { id: 'a1', type: 'agent_message', turnId: 't1', text: '完成', status: 'completed', timestamp: '2026-08-23T00:00:04.000Z' } as const;
    expect(terminalTimestampForItem(reasoning as never, [reasoning as never, nextItem as never], null, nextItem.timestamp)).toBe(nextItem.timestamp);
    expect(resolveElapsedMs(reasoning.timestamp, nextItem.timestamp)).toBe(4000);
  });

  it('does not invent a terminal duration when the endpoint is missing', () => {
    expect(resolveElapsedMs('2020-01-01T00:00:00.000Z')).toBeNull();
    const html = renderToStaticMarkup(
      React.createElement(ItemView, {
        item: { id: 'r-missing-end', type: 'reasoning', turnId: 't1', text: '历史思考', status: 'completed', timestamp: '2020-01-01T00:00:00.000Z' },
        locale: 'zh',
      }),
    );
    expect(html).not.toContain('reasoningElapsed');
  });
});

describe('assistant turn file summary', () => {
  it('renders read and changed files after assistant turn content', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantTurnView, {
        group: {
          turnId: 'turn-1',
          items: [
            { id: 'a1', type: 'agent_message', turnId: 'turn-1', text: '完成', status: 'completed' },
            { id: 'r1', type: 'tool_call', turnId: 'turn-1', toolName: 'read_file', arguments: { filePath: 'apps/web/src/main.tsx' }, result: { path: 'E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx' }, status: 'completed' },
            { id: 'c1', type: 'file_change', turnId: 'turn-1', changes: [{ path: 'apps/web/src/components/ItemView.tsx', kind: 'update', addedLines: 4, removedLines: 1 }], status: 'completed' },
          ],
        },
        locale: 'zh',
        workspaceRoot: 'E:\\langchain\\Nexus',
      }),
    );

    expect(html).toContain('阅读文件');
    expect(html).toContain('修改文件');
    expect(html).toContain('E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx');
    expect(html).toContain('+4');
    expect(html).toContain('-1');
  });

  it('renders involved files as preview buttons when preview is available', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantTurnView, {
        group: {
          turnId: 'turn-1',
          items: [
            { id: 'a1', type: 'agent_message', turnId: 'turn-1', text: '完成', status: 'completed' },
            { id: 'r1', type: 'tool_call', turnId: 'turn-1', toolName: 'read_file', arguments: { filePath: 'apps/web/src/main.tsx' }, result: { path: 'E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx' }, status: 'completed' },
          ],
        },
        locale: 'zh',
        onPreviewFile: () => undefined,
        workspaceRoot: 'E:\\langchain\\Nexus',
      }),
    );

    expect(html).toContain('class="turnFileSummaryPath"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="预览文件 E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx"');
  });

  it('keeps involved file summary text on neutral readable colors', () => {
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');
    const paleMessageStrongRule = styles.indexOf('.message summary,\n  .message strong,');
    const readableHeaderRule = styles.indexOf('.message.agent .turnFileSummaryHeader :where(strong, span)');

    expect(paleMessageStrongRule).toBeGreaterThan(-1);
    expect(readableHeaderRule).toBeGreaterThan(paleMessageStrongRule);
    expect(styles).toMatch(/\.message\.agent \.turnFileSummaryHeader :where\(strong, span\)\s*\{\s*color: var\(--nx-text\);\s*\}/);
    expect(styles).toMatch(/\.message\.agent \.turnFileSummaryPath\s*\{[\s\S]*?color: var\(--nx-text\);/);
  });
});

describe('agent message display sanitizing', () => {
  it('hides DSML-style plain text tool calls from persisted assistant history', () => {
    const text = [
      '好的，我继续分析。',
      '',
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="read_file">',
      '<｜｜DSML｜｜parameter name="filePath" string="true">E:\\langchain\\dify\\api\\core\\workflow\\node_runtime.py</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>',
    ].join('\n');

    const sanitized = sanitizeAgentMessageTextForDisplay(text, 'zh');

    expect(sanitized).toContain('好的，我继续分析。');
    expect(sanitized).toContain('已隐藏模型误输出的文本工具调用');
    expect(sanitized).not.toContain('DSML');
    expect(sanitized).not.toContain('node_runtime.py');
  });
});

describe('conversation surface contract', () => {
  it('uses semantic chat and involved-file surfaces instead of a pale card stack', () => {
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');
    const finalContract = styles.slice(styles.lastIndexOf('/* Nexus conversation surface contract */'));

    expect(finalContract).toContain('.appShell .messageBlock.agent .message.agent');
    expect(finalContract).toContain('background: var(--nx-surface-panel);');
    expect(finalContract).toContain('.appShell .turnFileSummary');
    expect(finalContract).toContain('background: var(--nx-surface-overlay);');
    expect(finalContract).toContain('.appShell .messageActionButton');
  });
});
