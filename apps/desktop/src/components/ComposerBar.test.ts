import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config/defaults.js';
import { ComposerBar } from './ComposerBar.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('ComposerBar', () => {
  function renderComposer(overrides: Partial<React.ComponentProps<typeof ComposerBar>> = {}): string {
    return renderToStaticMarkup(React.createElement(ComposerBar, {
      activeSlashOption: null,
      activeThreadId: '',
      applyModelPreset: vi.fn(),
      botConfig: null,
      botStatus: null,
      busy: false,
      composerInputRef: React.createRef<HTMLTextAreaElement>(),
      config: defaultConfig,
      draggingImage: false,
      filteredSlashOptions: [],
      handleDrop: vi.fn(),
      handleFileSelect: vi.fn(),
      handlePaste: vi.fn(),
      images: [],
      input: '',
      modelPresets: [],
      openRemoteAssistants: vi.fn(),
      removeImage: vi.fn(),
      rightPaneTab: 'activity',
      rightPaneVisible: true,
      selectSlashOption: vi.fn(),
      setActiveSlashOption: vi.fn(),
      setConfig: vi.fn(),
      setDraggingImage: vi.fn(),
      setInput: vi.fn(),
      slashVisible: false,
      stopTurn: vi.fn(),
      submitComposer: vi.fn(),
      ...overrides,
    }));
  }

  it('disables slash command mode while editing workflows', () => {
    const html = renderComposer({
      filteredSlashOptions: [{
        id: 'compact',
        command: '/compact',
        title: 'Compact',
        detail: 'Compact context',
      }],
      handleDrop: vi.fn(),
      input: '/compact',
      slashVisible: true,
      workflowMode: true,
    });

    expect(html).not.toContain('slashPalette');
    expect(html).toContain('输入工作流目标或节点修改要求');
    expect(html).toContain('计划模式');
    expect(html).toContain('首次创建必须先生成计划');
    expect(html).not.toContain('模型配置');
  });

  it('shows an explicit planning state for workflow generation', () => {
    const html = renderComposer({
      input: '读取当前项目目录',
      workflowMode: true,
      workflowPlanning: true,
    });

    expect(html).toContain('生成计划中');
    expect(html).toContain('disabled=""');
  });

  it('marks the composer action button with explicit running-state classes', () => {
    const idleHtml = renderComposer({ input: '你好' });
    const busyHtml = renderComposer({ busy: true });
    const planningHtml = renderComposer({ workflowMode: true, workflowPlanning: true });

    expect(idleHtml).toContain('class="sendButton"');
    expect(busyHtml).toContain('class="sendButton busy stopButton"');
    expect(planningHtml).toContain('class="sendButton busy planningButton"');
  });

  it('keeps composer history and draft as UX-only local storage', () => {
    const source = readFileSync(join(here, 'ComposerBar.tsx'), 'utf-8');
    expect(source).toContain('nexus.composer.history.v1');
    expect(source).toContain('nexus.composer.draft.v1');
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'ArrowDown'");
  });

  it('renders remote bot bindings as platform icons instead of status text', () => {
    const html = renderComposer({
      activeThreadId: 'thread_current',
      botConfig: {
        weixin: {
          enabled: true,
          bridgeMode: 'desktop_managed',
          bridgeUrl: 'http://127.0.0.1:18790/api/v1/admin/rpc',
          accountId: 'wx_account',
          activeThreadId: 'thread_current',
          autoStartMonitor: true,
          syncHistoryOnConnect: true,
        },
        dingtalk: {
          enabled: true,
          connectionMode: 'stream',
          clientId: 'ding_client',
          clientSecret: 'ding_secret',
          robotCode: '',
          cardTemplateId: '',
          targetGroupName: '',
          targetGroupConversationId: '',
          targetGroupSessionWebhook: '',
          lastDetectedGroupConversationId: '',
          lastDetectedGroupSessionWebhook: '',
          lastDetectedGroupAt: '',
          allowedUsers: [],
          webhookSecret: '',
          activeThreadId: 'thread_current',
          autoStart: true,
        },
        feishu: { enabled: false },
        qq: { enabled: false },
        dwsCli: { enabled: false, binaryPath: '', clientId: '', clientSecret: '' },
      },
      botStatus: { weixin: { connected: true }, dingtalk: { configured: true, streamRunning: true } },
    });

    expect(html).toContain('remotePlatformIcon weixin');
    expect(html).toContain('remotePlatformIcon dingtalk');
    expect(html).toContain('微信、钉钉已绑定到当前对话');
    expect(html).not.toContain('2 个助手已绑定');
    expect(html).not.toContain('微信已绑定');
    expect(html).not.toContain('绑定到其他对话');
  });

  it('uses a robot icon when no remote assistant is bound', () => {
    const html = renderComposer({ activeThreadId: 'thread_current' });

    expect(html).toContain('remoteBindingRobot');
    expect(html).not.toContain('远程助手未绑定');
    expect(html).not.toContain('远程助手未连接');
    expect(html).not.toContain('绑定到其他对话');
  });

  it('opens a platform selection menu before starting a remote assistant flow', () => {
    const source = readFileSync(join(here, 'ComposerBar.tsx'), 'utf-8');

    expect(source).toContain('remoteAssistantMenu');
    expect(source).toContain("selectRemoteAssistant('weixin')");
    expect(source).toContain("selectRemoteAssistant('dingtalk')");
  });
});
