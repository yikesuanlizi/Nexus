import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RightPane } from './RightPane.js';

describe('RightPane', () => {
  it('keeps workflow out of the generic status/files panel', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'status',
      agentStageRows: [],
      locale: 'zh',
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
    }));

    expect(html).toContain('状态');
    expect(html).toContain('文件');
    expect(html).not.toContain('工作流');
  });
});
