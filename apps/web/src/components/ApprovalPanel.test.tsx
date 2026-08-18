import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalPanel } from './ApprovalPanel.js';
import type { ApprovalRequest } from '../shared/types.js';

describe('ApprovalPanel', () => {
  const approvals: ApprovalRequest[] = [
    {
      requestId: 'approval-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      kind: 'file_write',
      description: '读取外部文档',
      payload: {},
      decision: 'prompt',
      temporaryGrantOptions: [
        { scope: 'tool_call', label: '仅本次工具调用' },
        { scope: 'turn', label: '仅本轮对话' },
      ],
    },
  ];

  it('renders temporary and persistent approval options', () => {
    const html = renderToStaticMarkup(React.createElement(ApprovalPanel, {
      locale: 'zh',
      approvals,
      onDecision: vi.fn(),
    }));

    expect(html).toContain('授权请求');
    expect(html).toContain('仅本次工具调用');
    expect(html).toContain('读取外部文档');
    expect(html).toContain('临时允许');
    expect(html).toContain('永久允许类似操作');
    expect(html).toContain('当前线程对话');
    expect(html).toContain('本工作目录');
    expect(html).toContain('全局');
  });

  it('passes temporary and persistent scopes to approval decisions in web and desktop', () => {
    const webSource = readFileSync(join(process.cwd(), 'apps/web/src/components/ApprovalPanel.tsx'), 'utf-8');
    const desktopSource = readFileSync(join(process.cwd(), 'apps/desktop/src/components/ApprovalPanel.tsx'), 'utf-8');

    expect(webSource).toContain('handleDecision(approval.requestId, true, selectedScope)');
    expect(webSource).toContain('handleDecision(approval.requestId, true, selectedScope, selectedPersistentScope)');
    expect(webSource).toContain('handleDecision(approval.requestId, false, selectedScope)');
    expect(desktopSource).toContain('handleDecision(approval.requestId, true, selectedScope)');
    expect(desktopSource).toContain('handleDecision(approval.requestId, true, selectedScope, selectedPersistentScope)');
    expect(desktopSource).toContain('handleDecision(approval.requestId, false, selectedScope)');
    expect(webSource).toContain('disabled={isDeciding}');
    expect(desktopSource).toContain('disabled={isDeciding}');
    expect(webSource).toContain('永久允许类似操作');
    expect(desktopSource).toContain('永久允许类似操作');
  });
});
