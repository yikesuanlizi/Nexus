import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowPanel } from './WorkflowPanel.js';
import type { WorkflowComponentDefinition, WorkflowSnapshot } from '../features/workflow/workflow.js';

const workflow: WorkflowSnapshot = {
  definition: {
    id: 'wf_web',
    goal: 'Run web workflow',
    version: 1,
    source: 'model',
    nodes: [
      {
        id: 'step',
        componentType: 'prompt_task',
        title: 'Run step',
        prompt: 'Do it',
        inputRequirements: 'Input',
        outputRequirements: 'Output',
        dependsOn: [],
        approval: 'none',
      },
      {
        id: 'review',
        componentType: 'human_approval',
        title: 'Review result',
        prompt: 'Review it',
        inputRequirements: 'Output',
        outputRequirements: 'Decision',
        dependsOn: ['step'],
        approval: 'required',
      },
    ],
    edges: [{ from: 'step', to: 'review' }],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  },
  run: {
    id: 'run_web',
    workflowId: 'wf_web',
    goal: 'Run web workflow',
    status: 'failed',
    nodeRuns: [{ nodeId: 'step', status: 'failed', error: 'tool failed' }, { nodeId: 'review', status: 'pending' }],
    createdAt: '2026-06-15T00:00:01.000Z',
    updatedAt: '2026-06-15T00:00:02.000Z',
  },
};

const components: WorkflowComponentDefinition[] = [{
  type: 'prompt_task',
  name: 'Prompt task',
  description: 'Run a prompt step.',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  defaultPrompt: 'Do it.',
  executorKind: 'prompt',
}];

describe('web WorkflowPanel', () => {
  it('renders runtime controls for saved workflows', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPanel, {
      locale: 'zh',
      workflow,
      components,
      planDraft: null,
      saving: false,
      runtimeBusy: false,
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
      onSave: vi.fn(),
      onRunWorkflow: vi.fn(),
      onResumeWorkflow: vi.fn(),
      onCancelWorkflow: vi.fn(),
      onRetryWorkflowNode: vi.fn(),
    }));

    expect(html).toContain('运行状态');
    expect(html).toContain('失败');
    expect(html).toContain('运行');
    expect(html).toContain('重试节点');
    expect(html).toContain('tool failed');
    expect(html).toContain('workflowCanvasShell');
    expect(html).toContain('workflowCanvasStage');
    expect(html).toContain('workflowEdgeIndicator');
    expect(html).toContain('开发模式');
    expect(html).toContain('发布模式');
    expect(html).toContain('transform:translate(0px, 0px) scale(1)');
    expect(html).not.toContain('workflowNodeMain');
  });

  it('renders the published definition as read-only in release mode', () => {
    const publishedWorkflow: WorkflowSnapshot = {
      ...workflow,
      definition: {
        ...workflow.definition,
        nodes: workflow.definition.nodes.map((node) => node.id === 'step' ? { ...node, title: 'Draft step title' } : node),
      },
      publishedDefinition: {
        ...workflow.definition,
        nodes: workflow.definition.nodes.map((node) => node.id === 'step' ? { ...node, title: 'Published step title' } : node),
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
      onCancelPlan: vi.fn(),
      onCommitPlan: vi.fn(),
      onSave: vi.fn(),
      onRunWorkflow: vi.fn(),
      onTestWorkflow: vi.fn(),
      onPublishWorkflow: vi.fn(),
      onResumeWorkflow: vi.fn(),
      onCancelWorkflow: vi.fn(),
      onRetryWorkflowNode: vi.fn(),
    }));

    expect(html).toContain('Published step title');
    expect(html).not.toContain('Draft step title');
    expect(html).not.toContain('添加节点');
    expect(html).not.toContain('删除节点');
    expect(html).not.toContain('aria-label="选择节点');
    expect(html).not.toContain('节点契约');
  });
});
