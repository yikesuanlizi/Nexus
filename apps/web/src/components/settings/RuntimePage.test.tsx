import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../config/defaults.js';
import { RuntimePage } from './RuntimePage.js';
import { MonitorPage } from './MonitorPage.js';

describe('runtime settings pages', () => {
  it('renders runtime limits separately from monitor controls', () => {
    const props = { locale: 'zh' as const, config: defaultConfig, setConfig: vi.fn(), markDirty: vi.fn(), dirtyFields: {}, onSave: vi.fn() };
    const runtime = renderToStaticMarkup(React.createElement(RuntimePage, props));
    const monitor = renderToStaticMarkup(React.createElement(MonitorPage, props));
    expect(runtime).toContain('全局活动任务');
    expect(runtime).toContain('子 Agent 最大深度');
    expect(monitor).toContain('监控面板显示');
    expect(monitor).toContain('性能阈值保护');
    expect(monitor).toContain('保存监控设置');
    expect(monitor).toContain('settingsToggleTrack on');
    expect(monitor).not.toContain('子 Agent 最大深度');
  });
});
