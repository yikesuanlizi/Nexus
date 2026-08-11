// BrowserWorkbench 静态渲染测试：标签栏/地址栏/导航按钮/容器结构（Phase 2）。
// 动态行为（多标签/导航/事件）由 tests/electron-phase2.test.ts 集成覆盖。
// — English: static render tests for BrowserWorkbench (Phase 2). Dynamic behavior
//   (tabs/navigation/events) is covered by the electron-phase2 integration tests.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserWorkbench } from './BrowserWorkbench.js';

describe('BrowserWorkbench', () => {
  it('渲染浏览器工作台结构：工具栏/标签条/View 容器', () => {
    const html = renderToStaticMarkup(React.createElement(BrowserWorkbench));
    expect(html).toContain('browserWorkbench');
    expect(html).toContain('browserAddress');
    expect(html).toContain('browserTabStrip');
    expect(html).toContain('browserViewContainer');
    // 无截图：不渲染任何 <img> 数据 URL。
    // — English: no screenshots — no <img> data URLs.
    expect(html).not.toContain('<img');
  });

  it('工具栏包含后退/前进/刷新/新建标签按钮与地址栏', () => {
    const html = renderToStaticMarkup(React.createElement(BrowserWorkbench));
    expect(html).toContain('aria-label="后退"');
    expect(html).toContain('aria-label="前进"');
    expect(html).toContain('aria-label="刷新"');
    expect(html).toContain('aria-label="新建标签"');
    expect(html).toContain('placeholder="输入网址，Enter 打开"');
  });

  it('无标签时显示「新建标签」空态入口', () => {
    const html = renderToStaticMarkup(React.createElement(BrowserWorkbench));
    expect(html).toContain('browserTabEmpty');
    expect(html).toContain('新建标签');
  });
});
