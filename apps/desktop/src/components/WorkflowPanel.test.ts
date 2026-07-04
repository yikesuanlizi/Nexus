import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowPanel } from './WorkflowPanel.js';
import type { WorkflowComponentDefinition, WorkflowPlanDraft, WorkflowSnapshot } from '../features/workflow/workflow.js';

const workflow: WorkflowSnapshot = {
  definition: {
    id: 'wf_1',
    goal: 'Run sealed tool component',
    version: 1,
    source: 'model',
    nodes: [{
      id: 'notify',
      componentType: 'tool:notify_user',
      title: 'Notify owner',
      prompt: 'Use the sealed notification component.',
      inputRequirements: 'Owner message.',
      outputRequirements: 'Delivery result.',
      dependsOn: [],
      approval: 'none',
      params: { channel: 'weixin', message: 'Ready', urgent: true },
    }],
    edges: [],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  },
  run: {
    id: 'run_1',
    workflowId: 'wf_1',
    goal: 'Run sealed tool component',
    status: 'planned',
    nodeRuns: [{ nodeId: 'notify', status: 'pending' }],
    createdAt: '2026-06-15T00:00:01.000Z',
    updatedAt: '2026-06-15T00:00:01.000Z',
  },
};

const components: WorkflowComponentDefinition[] = [{
  type: 'tool:notify_user',
  name: 'notify_user',
  description: 'Send a project notification.',
  executorKind: 'tool',
  source: 'tool',
  toolName: 'notify_user',
  sealed: true,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  defaultPrompt: 'Use this sealed tool component.',
  ui: {
    fields: [
      { name: 'channel', label: 'channel', kind: 'select', required: true, options: ['email', 'weixin'], description: 'Notification channel.' },
      { name: 'message', label: 'message', kind: 'textarea', required: true, description: 'Message body.' },
      { name: 'urgent', label: 'urgent', kind: 'checkbox', required: false, description: 'Whether to mark it urgent.' },
    ],
  },
}];

describe('WorkflowPanel', () => {
  it('renders sealed workflow nodes as clickable cards instead of code fields', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow,
      components,
      planDraft: null,
      saving: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
    }));

    expect(html).toContain('workflowNode');
    expect(html).toContain('tool:notify_user');
    expect(html).toContain('Notify owner');
    expect(html).toContain('workflowCanvasStage');
    expect(html).not.toContain('节点契约');
    expect(html).not.toContain('代码');
  });

  it('keeps empty workflows as a display area and uses the bottom composer for input', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow: null,
      components,
      planDraft: null,
      saving: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
    }));

    expect(html).toContain('从下方输入目标并使用计划模式开始');
    expect(html).not.toContain('工作流目标');
    expect(html).not.toContain('textarea');
  });

  it('renders a plan draft as connected step cards with save-not-run actions', () => {
    const multiNodeWorkflow: WorkflowSnapshot = {
      ...workflow,
      definition: {
        ...workflow.definition,
        nodes: [
          workflow.definition.nodes[0],
          { ...workflow.definition.nodes[0], id: 'review', title: 'Review output', componentType: 'tool:notify_user', dependsOn: ['notify'] },
        ],
        edges: [{ from: 'notify', to: 'review' }],
      },
      run: {
        ...workflow.run,
        nodeRuns: [{ nodeId: 'notify', status: 'completed' }, { nodeId: 'review', status: 'running' }],
      },
    };
    const draft: WorkflowPlanDraft = {
      kind: 'workflow_draft',
      goal: multiNodeWorkflow.definition.goal,
      workflow: multiNodeWorkflow,
      components,
      blueprint: {
        ok: true,
        diagnostics: [{ severity: 'warning', code: 'missing_input', message: '目标项目路径待用户补充' }],
        entryNodeIds: ['notify'],
        terminalNodeIds: ['review'],
        topology: ['notify', 'review'],
        runnableNodeIds: ['notify'],
        missingInputs: ['目标项目路径待用户补充'],
        referencedVariables: ['input.goal'],
      },
    };
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow: null,
      components,
      planDraft: draft,
      saving: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
    }));

    expect(html).toContain('计划草案');
    expect(html).not.toContain('流程步骤');
    expect(html).toContain('步骤 1');
    expect(html).toContain('workflowEdgeIndicator');
    expect(html).toContain('当前步骤');
    expect(html).toContain('开发模式');
    expect(html).toContain('发布模式');
    expect(html).toContain('workflowCanvasToolbar');
    expect(html).not.toContain('workflowViewportControls');
    expect(html).not.toContain('65%');
    expect(html).toContain('取消');
    expect(html).toContain('保存草案');
    expect(html).not.toContain('执行');
    expect(html).not.toContain('执行中');
    expect(html).not.toContain('节点契约');
    expect(html).not.toContain('补充要求，回车重新规划');
    expect(html).toContain('蓝图诊断');
    expect(html).toContain('目标项目路径待用户补充');
  });

  it('disables plan draft saving when blueprint diagnostics contain blocking errors', () => {
    const draft: WorkflowPlanDraft = {
      kind: 'workflow_draft',
      goal: workflow.definition.goal,
      workflow,
      components,
      blueprint: {
        ok: false,
        diagnostics: [{ severity: 'error', code: 'start_has_dependencies', message: 'Start node must not depend on prior nodes: notify' }],
        entryNodeIds: ['notify'],
        terminalNodeIds: ['notify'],
        topology: ['notify'],
        runnableNodeIds: [],
        missingInputs: [],
        referencedVariables: [],
      },
    };
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow: null,
      components,
      planDraft: draft,
      saving: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
    }));
    const saveButton = html.match(/<button class="solidButton"[^>]*>保存草案<\/button>/)?.[0] ?? '';

    expect(html).toContain('Start node must not depend on prior nodes: notify');
    expect(saveButton).toContain('disabled=""');
  });

  it('lets development mode select nodes for composer-driven changes', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow,
      components,
      planDraft: null,
      saving: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
      onSelectionChange: vi.fn(),
    }));

    expect(html).toContain('选中节点后，在底部输入框描述修改要求');
    expect(html).toContain('aria-label="选择节点 Notify owner"');
    expect(html).not.toContain('节点契约');
  });

  it('renders release-mode runtime controls and current run state', () => {
    const blockedWorkflow: WorkflowSnapshot = {
      ...workflow,
      run: {
        ...workflow.run,
        status: 'blocked',
        nodeRuns: [{ nodeId: 'notify', status: 'blocked', blockedReason: 'waiting for approval' }],
      },
    };
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow: blockedWorkflow,
      components,
      planDraft: null,
      saving: false,
      runtimeBusy: false,
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
      onRunWorkflow: vi.fn(),
      onResumeWorkflow: vi.fn(),
      onCancelWorkflow: vi.fn(),
      onRetryWorkflowNode: vi.fn(),
    }));

    expect(html).toContain('运行状态');
    expect(html).toContain('阻塞');
    expect(html).toContain('继续');
    expect(html).toContain('重试节点');
    expect(html).toContain('waiting for approval');
  });

  it('renders the published definition as read-only in release mode', () => {
    const publishedWorkflow: WorkflowSnapshot = {
      ...workflow,
      definition: {
        ...workflow.definition,
        nodes: workflow.definition.nodes.map((node) => node.id === 'notify' ? { ...node, title: 'Draft notify title' } : node),
      },
      publishedDefinition: {
        ...workflow.definition,
        nodes: workflow.definition.nodes.map((node) => node.id === 'notify' ? { ...node, title: 'Published notify title' } : node),
      },
      publication: { status: 'published', publishedVersion: 1, publishedAt: '2026-06-15T00:00:03.000Z' },
    };
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow: publishedWorkflow,
      components,
      planDraft: null,
      saving: false,
      runtimeBusy: false,
      initialViewMode: 'release',
      onSave: vi.fn(),
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
      onRunWorkflow: vi.fn(),
      onTestWorkflow: vi.fn(),
      onPublishWorkflow: vi.fn(),
      onResumeWorkflow: vi.fn(),
      onCancelWorkflow: vi.fn(),
      onRetryWorkflowNode: vi.fn(),
    }));

    expect(html).toContain('Published notify title');
    expect(html).not.toContain('Draft notify title');
    expect(html).not.toContain('添加节点');
    expect(html).not.toContain('删除节点');
    expect(html).not.toContain('aria-label="选择节点');
    expect(html).not.toContain('节点契约');
  });

  it('keeps workflow styles theme-aware instead of shipping hard-coded white panels', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop/src/styles.css'), 'utf8');
    const workflowCss = css.slice(css.lastIndexOf('@layer components'));

    expect(workflowCss).not.toContain('.workflowFlowHeader');
    expect(workflowCss).not.toMatch(/\.workflow(?:PlanDraft|Graph|Editor)[^{]*\{[^}]*bg-white/s);
    expect(workflowCss).toContain('.workflowNodeInspector');
    expect(workflowCss).toContain('.workflowCanvasStage');
    expect(workflowCss).toContain('white-space: normal');
  });

  it('uses a cancelable component wheel handler for canvas zoom without native passive listener traps', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/desktop/src/components/WorkflowPanel.tsx'), 'utf8');
    expect(source).not.toContain("addEventListener('wheel'");
    expect(source).toContain('onWheel={handleGraphWheel}');
    expect(source).toContain('if (event.cancelable) event.preventDefault();');
    expect(source).not.toContain('workflowViewportControls');
  });
});
