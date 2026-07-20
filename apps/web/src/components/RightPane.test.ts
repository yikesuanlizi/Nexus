import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RightPane } from './RightPane.js';
import type { TaskRuntimeMonitorState } from '../features/monitor/taskRuntimeMonitor.js';

const taskRuntimeState: TaskRuntimeMonitorState = {
  runtime: {
    type: 'task.runtime.updated',
    threadId: 'thread_1',
    turnId: 'turn_1',
    phase: 'model',
    status: 'running',
    runProfile: 'runtime_os',
    timestamp: '2026-07-18T00:00:00.000Z',
  },
  cognition: {
    type: 'task.cognition.updated',
    threadId: 'thread_1',
    turnId: 'turn_1',
    cognition: {
      goal: '修复上下文监控',
      constraints: ['不新增运行模式'],
      knownFacts: ['task.context.updated 只包含元数据'],
      unknowns: ['是否需要后台任务入口'],
      risks: ['readiness retry 风暴'],
      confidence: 0.72,
      verificationCriteria: ['普通聊天不触发后台任务接口'],
    },
    timestamp: '2026-07-18T00:00:01.000Z',
  },
  context: {
    type: 'task.context.updated',
    threadId: 'thread_1',
    turnId: 'turn_1',
    chunks: [
      {
        id: 'task-cognition',
        source: 'task',
        tokens: 320,
        priority: 95,
        truncated: false,
        summary: '当前任务认知摘要',
      },
      {
        id: 'experience-1',
        source: 'experience',
        tokens: 180,
        priority: 70,
        truncated: true,
        summary: '历史失败模式',
      },
    ],
    usedTokens: 500,
    remainingTokens: 1500,
    timestamp: '2026-07-18T00:00:02.000Z',
  },
  loop: {
    type: 'task.loop.updated',
    threadId: 'thread_1',
    turnId: 'turn_1',
    loopId: 'loop_1',
    iteration: 2,
    maxIterations: 8,
    noProgressCount: 1,
    continuationReason: '需要补证据',
    status: 'active',
    timestamp: '2026-07-18T00:00:03.000Z',
  },
  events: [
    {
      type: 'task.loop.updated',
      threadId: 'thread_1',
      turnId: 'turn_1',
      loopId: 'loop_1',
      iteration: 2,
      maxIterations: 8,
      noProgressCount: 1,
      continuationReason: '需要补证据',
      status: 'active',
      timestamp: '2026-07-18T00:00:03.000Z',
    },
    {
      type: 'task.context.updated',
      threadId: 'thread_1',
      turnId: 'turn_1',
      chunks: [],
      usedTokens: 500,
      remainingTokens: 1500,
      timestamp: '2026-07-18T00:00:02.000Z',
    },
  ],
};

describe('RightPane', () => {
  it('splits status into agent stage above task runtime', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'status',
      activeThread: {
        threadId: 'thread_1',
        title: '航空保障包',
        status: 'idle',
        turnCount: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      agentStageRows: [{
        kind: 'main',
        threadId: 'thread_1',
        parentThreadId: '',
        title: 'Nexus 主控 Agent',
        role: 'primary',
        depth: 0,
        status: 'idle',
        statusLabel: '待机中',
        tone: 'muted',
        latestAction: '等待指令',
        updatedAt: '2026-07-18T00:00:00.000Z',
      }],
      locale: 'zh',
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
      onToggleMemoryExcluded: vi.fn(),
    }));

    expect(html).toContain('状态');
    expect(html).toContain('文件');
    expect(html).toContain('rightPaneStatusStack');
    expect(html).toContain('rightPaneStatusSplit');
    expect(html).toContain('任务列表');
    expect(html.indexOf('智能体状态')).toBeLessThan(html.indexOf('任务列表'));
    expect(html).not.toContain('工作流');
  });

  it('shows only operational items in the task runtime panel', () => {
    const html = renderToStaticMarkup(React.createElement(RightPane, {
      activeTab: 'status',
      agentStageRows: [],
      locale: 'zh',
      runtimeItems: [
        {
          id: 'user_1',
          type: 'user_message',
          text: '介绍一下航空保障包（扩展包）',
          status: 'completed',
          timestamp: '2026-07-18T00:00:03.000Z',
        },
        {
          id: 'agent_1',
          type: 'agent_message',
          text: '航空保障包用于把领域知识、工具和流程打包给 Agent。',
          status: 'completed',
          timestamp: '2026-07-18T00:00:04.000Z',
        },
        {
          id: 'todo_1',
          type: 'todo_list',
          items: [
            { text: '读取相关上下文', completed: true },
            { text: '整理监控视图', completed: false },
          ],
          status: 'completed',
          timestamp: '2026-07-18T00:00:04.500Z',
        },
        {
          id: 'tool_1',
          type: 'tool_call',
          toolName: 'read_file',
          status: 'completed',
          timestamp: '2026-07-18T00:00:05.000Z',
        },
      ],
      workspaceRoot: 'E:/langchain',
      onTabChange: vi.fn(),
      taskRuntimeState,
    }));

    expect(html).toContain('任务列表');
    expect(html).toContain('taskRuntimeBody');
    expect(html).toContain('模型调用');
    expect(html).toContain('runtime_os');
    expect(html).toContain('修复上下文监控');
    expect(html).toContain('当前任务认知摘要');
    expect(html).toContain('历史失败模式');
    expect(html).toContain('2/8');
    expect(html).toContain('任务列表');
    expect(html).toContain('读取相关上下文');
    expect(html).toContain('整理监控视图');
    expect(html).toContain('事件流');
    expect(html).toContain('执行项');
    expect(html).toContain('read_file · completed');
    expect(html).not.toContain('任务清单 · completed');
    expect(html).not.toContain('agent_message · completed');
    expect(html).not.toContain('user_message · completed');
    expect(html).not.toContain('航空保障包用于把领域知识');
    expect(html).not.toContain('介绍一下航空保障包');
    expect(html).toContain('loop · active');
    expect(html).toContain('context · 500 tok');
    expect(html).toContain('readiness retry 风暴');
    expect(html).not.toContain('完整 prompt');
    expect(html).not.toContain('chunk content');
    expect(html).not.toContain('/harness/start');
    expect(html).not.toContain('Harness 模式');
  });
});
