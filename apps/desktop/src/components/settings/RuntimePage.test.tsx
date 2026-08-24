import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../config/defaults.js';
import { RuntimePage } from './RuntimePage.js';
import { MonitorPage } from './MonitorPage.js';

describe('runtime settings pages', () => {
  it('keeps runtime limits on Runtime and monitoring switches on Monitor', () => {
    const props = {
      locale: 'zh' as const,
      config: defaultConfig,
      setConfig: vi.fn(),
      markDirty: vi.fn(),
      dirtyFields: {},
      onSave: vi.fn(),
    };
    const runtime = renderToStaticMarkup(React.createElement(RuntimePage, props));
    const monitor = renderToStaticMarkup(React.createElement(MonitorPage, props));
    expect(runtime).toContain('全局活动任务');
    expect(runtime).toContain('只读工具并发');
    expect(monitor).toContain('系统性能采样');
    expect(monitor).toContain('运行日志记录');
    expect(monitor).toContain('性能阈值保护');
    expect(monitor).toContain('保存监控设置');
    expect(monitor).toContain('settingsToggleTrack on');
    expect(monitor).not.toContain('全局活动任务');
  });
});
