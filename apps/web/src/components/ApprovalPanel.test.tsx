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

  it('renders temporary approval wording without persistent options', () => {
    const html = renderToStaticMarkup(React.createElement(ApprovalPanel, {
      locale: 'zh',
      approvals,
      onDecision: vi.fn(),
    }));

    expect(html).toContain('临时授权');
    expect(html).toContain('仅本次工具调用');
    expect(html).toContain('读取外部文档');
    expect(html).not.toContain('永久允许');
  });

  it('passes the selected temporary scope to approval decisions in web and desktop', () => {
    const webSource = readFileSync(join(process.cwd(), 'apps/web/src/components/ApprovalPanel.tsx'), 'utf-8');
    const desktopSource = readFileSync(join(process.cwd(), 'apps/desktop/src/components/ApprovalPanel.tsx'), 'utf-8');

    expect(webSource).toContain('onDecision(approval.requestId, true, selectedScope)');
    expect(webSource).toContain('onDecision(approval.requestId, false, selectedScope)');
    expect(desktopSource).toContain('onDecision(approval.requestId, true, selectedScope)');
    expect(desktopSource).toContain('onDecision(approval.requestId, false, selectedScope)');
    expect(webSource).not.toContain('永久允许');
    expect(desktopSource).not.toContain('永久允许');
  });
});
