import { describe, expect, it } from 'vitest';
import type { ThreadMeta } from '../../shared/types.js';
import {
  THREAD_WORKFLOW_TAG,
  THREAD_WORKFLOW_PROJECT_TAG,
  createEmptyWorkflowSnapshot,
  createWorkflowDraftReplyItem,
  createWorkflowDraftUserItem,
  isWorkflowProjectThread,
  isUntitledWorkflowProjectTitle,
  parseThreadWorkflow,
  parseWorkflowCheckpointItems,
  updateWorkflowNodeDraft,
  workflowThreadTitleFromGoal,
  workflowNodeDependencyText,
  type WorkflowPlanDraft,
  type WorkflowSnapshot,
} from './workflow.js';

const workflow: WorkflowSnapshot = {
  definition: {
    id: 'wf_1',
    goal: 'Desktop workflow',
    version: 1,
    source: 'model',
    nodes: [
      {
        id: 'scope',
        componentType: 'prompt_task',
        title: 'Scope',
        prompt: 'Scope the task',
        inputRequirements: 'Goal',
        outputRequirements: 'Plan',
        dependsOn: [],
        approval: 'none',
        params: {},
      },
      {
        id: 'execute',
        componentType: 'tool_task',
        title: 'Execute',
        prompt: 'Run tools',
        inputRequirements: 'Plan',
        outputRequirements: 'Result',
        dependsOn: ['scope'],
        approval: 'required',
        params: { command: 'npm test', cwd: '.' },
      },
    ],
    edges: [{ from: 'scope', to: 'execute' }],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  },
  run: {
    id: 'run_1',
    workflowId: 'wf_1',
    goal: 'Desktop workflow',
    status: 'running',
    nodeRuns: [
      { nodeId: 'scope', status: 'completed', result: 'done' },
      { nodeId: 'execute', status: 'pending' },
    ],
    createdAt: '2026-06-15T00:00:01.000Z',
    updatedAt: '2026-06-15T00:00:01.000Z',
  },
};

function thread(tags: Record<string, string>): ThreadMeta {
  return {
    threadId: 't1',
    title: 'Thread',
    status: 'active',
    turnCount: 0,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    tags,
  };
}

describe('desktop workflow UI model helpers', () => {
  it('parses workflow snapshots from thread tags', () => {
    expect(parseThreadWorkflow(thread({ [THREAD_WORKFLOW_TAG]: JSON.stringify(workflow) }))?.definition.goal)
      .toBe('Desktop workflow');
    expect(parseThreadWorkflow(thread({ [THREAD_WORKFLOW_TAG]: '{bad' }))).toBeNull();
  });

  it('recognizes workflow project shells separately from saved workflow snapshots', () => {
    expect(isWorkflowProjectThread(thread({ [THREAD_WORKFLOW_PROJECT_TAG]: 'true' }))).toBe(true);
    expect(isWorkflowProjectThread(thread({ [THREAD_WORKFLOW_TAG]: JSON.stringify(workflow) }))).toBe(true);
    expect(parseThreadWorkflow(thread({ [THREAD_WORKFLOW_PROJECT_TAG]: 'true' }))).toBeNull();
  });

  it('recovers workflow snapshots from checkpoint items after metadata-only recovery misses tags', () => {
    expect(parseWorkflowCheckpointItems([
      { id: 'note', type: 'agent_message', turnId: 'turn-0', text: 'ignored', timestamp: '2026-06-15T00:00:00.000Z' },
      { id: 'checkpoint', type: 'workflow_checkpoint', turnId: 'turn-1', workflow, timestamp: '2026-06-15T00:00:01.000Z' },
    ])?.definition.goal).toBe('Desktop workflow');
    expect(parseWorkflowCheckpointItems([
      { id: 'bad-checkpoint', type: 'workflow_checkpoint', turnId: 'turn-1', workflow: { bad: true }, timestamp: '2026-06-15T00:00:01.000Z' },
    ])).toBeNull();
  });

  it('derives persistent workflow project titles from the first planned goal', () => {
    expect(workflowThreadTitleFromGoal('  创建一个 agent 对比工作流，对比标准是 harness / loop engine  \n补充')).toBe('创建一个 agent 对比工作流，对比标准是 harness / loop engine');
    expect(workflowThreadTitleFromGoal('', '未命名工作流项目')).toBe('未命名工作流项目');
    expect(isUntitledWorkflowProjectTitle('未命名工作流项目')).toBe(true);
    expect(isUntitledWorkflowProjectTitle('Untitled workflow project')).toBe(true);
    expect(isUntitledWorkflowProjectTitle('创建一个 agent 对比工作流')).toBe(false);
  });

  it('creates a valid empty workflow snapshot for newly listed workflow projects', () => {
    const empty = createEmptyWorkflowSnapshot('', new Date('2026-06-16T00:00:00.000Z'));
    const parsed = parseThreadWorkflow(thread({ [THREAD_WORKFLOW_TAG]: JSON.stringify(empty) }));

    expect(parsed?.definition).toMatchObject({
      goal: '',
      source: 'user',
      nodes: [],
      edges: [],
    });
    expect(parsed?.run).toMatchObject({
      workflowId: empty.definition.id,
      status: 'planned',
      nodeRuns: [],
    });
  });

  it('marks planned workflows as drafts before they are saved to a thread', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      workflow,
      components: [],
      blueprint: {
        ok: true,
        diagnostics: [{ severity: 'warning', code: 'missing_input', message: '目标项目路径待用户补充' }],
        entryNodeIds: ['scope'],
        terminalNodeIds: ['execute'],
        topology: ['scope', 'execute'],
        runnableNodeIds: ['scope'],
        missingInputs: ['目标项目路径待用户补充'],
        referencedVariables: ['input.goal'],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    try {
      const draft = await import('./workflow.js').then((module) => module.planWorkflowDraft('build flow'));
      expect(draft.kind).toBe('workflow_draft');
      expect(draft.workflow.definition.goal).toBe('Desktop workflow');
      expect(draft.blueprint?.missingInputs).toEqual(['目标项目路径待用户补充']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('creates transcript user and assistant items for workflow drafts with concrete requirements', () => {
    const concreteWorkflow: WorkflowSnapshot = {
      ...workflow,
      definition: {
        ...workflow.definition,
        nodes: workflow.definition.nodes.map((node, index) => index === 0
          ? { ...node, inputRequirements: '参考项目：E:\\langchain\\codex 和 E:\\langchain\\deer-flow-source\n标准：harness / loop engine' }
          : node),
      },
    };
    const draft: WorkflowPlanDraft = {
      kind: 'workflow_draft' as const,
      goal: concreteWorkflow.definition.goal,
      workflow: concreteWorkflow,
      components: [],
      blueprint: {
        ok: true,
        diagnostics: [{ severity: 'warning', code: 'missing_input', message: '目标项目路径待用户补充' }],
        entryNodeIds: ['scope'],
        terminalNodeIds: ['execute'],
        topology: ['scope', 'execute'],
        runnableNodeIds: ['scope'],
        missingInputs: ['目标项目路径待用户补充'],
        referencedVariables: ['input.goal'],
      },
    };

    const user = createWorkflowDraftUserItem('做 agent 成熟度对比', 'draft-turn', new Date('2026-06-16T00:00:00.000Z'));
    const reply = createWorkflowDraftReplyItem(draft, 'zh', 'draft-turn', new Date('2026-06-16T00:00:01.000Z'));

    expect(user).toMatchObject({ type: 'user_message', turnId: 'draft-turn', text: '做 agent 成熟度对比' });
    expect(reply).toMatchObject({ type: 'agent_message', turnId: 'draft-turn' });
    expect(reply.text).toContain('静态定义，不会自动运行');
    expect(reply.text).toContain('Scope');
    expect(reply.text).toContain('E:\\langchain\\codex');
    expect(reply.text).toContain('deer-flow-source');
    expect(reply.text).toContain('harness / loop engine');
    expect(reply.text).toContain('仍需补充');
    expect(reply.text).toContain('目标项目路径待用户补充');
  });

  it('updates node contract fields without changing node id or run state', () => {
    const next = updateWorkflowNodeDraft(workflow, 'execute', {
      title: 'Execute carefully',
      prompt: 'Use registered components only.',
      inputRequirements: 'Plan and target files',
      outputRequirements: 'Result and tests',
      dependsOn: ['scope'],
      approval: 'none',
      params: { command: 'npm run build', cwd: 'packages/runtime' },
    });

    expect(next.definition.nodes.find((node) => node.id === 'execute')).toMatchObject({
      id: 'execute',
      title: 'Execute carefully',
      approval: 'none',
      params: { command: 'npm run build', cwd: 'packages/runtime' },
    });
    expect(next.run.nodeRuns.find((nodeRun) => nodeRun.nodeId === 'scope')).toMatchObject({
      status: 'completed',
      result: 'done',
    });
  });

  it('formats compact dependency labels', () => {
    expect(workflowNodeDependencyText(workflow.definition.nodes[0])).toBe('entry');
    expect(workflowNodeDependencyText(workflow.definition.nodes[1])).toBe('scope');
  });

  it('updates sealed component params without changing component type', () => {
    const next = updateWorkflowNodeDraft(workflow, 'execute', {
      params: { command: 'npm test', cwd: '.', timeoutMs: 120000 },
    });

    expect(next.definition.nodes.find((node) => node.id === 'execute')).toMatchObject({
      id: 'execute',
      componentType: 'tool_task',
      params: { command: 'npm test', cwd: '.', timeoutMs: 120000 },
    });
  });
});
