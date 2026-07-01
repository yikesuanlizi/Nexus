import { describe, expect, it } from 'vitest';
import type { ThreadMeta } from '../../shared/types.js';
import {
  THREAD_WORKFLOW_PROJECT_TAG,
  THREAD_WORKFLOW_TAG,
  createWorkflowDraftErrorItem,
  createWorkflowDraftReplyItem,
  createWorkflowDraftUserItem,
  isWorkflowProjectThread,
  isUntitledWorkflowProjectTitle,
  parseWorkflowCheckpointItems,
  parseThreadWorkflow,
  updateWorkflowNodeDraft,
  workflowThreadTitleFromGoal,
  workflowNodeDependencyText,
  type WorkflowSnapshot,
} from './workflow.js';

const workflow: WorkflowSnapshot = {
  definition: {
    id: 'wf_1',
    goal: 'Ship visual workflows',
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
      },
    ],
    edges: [{ from: 'scope', to: 'execute' }],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  },
  run: {
    id: 'run_1',
    workflowId: 'wf_1',
    goal: 'Ship visual workflows',
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

describe('workflow UI model helpers', () => {
  it('parses workflow snapshots from thread tags', () => {
    expect(parseThreadWorkflow(thread({ [THREAD_WORKFLOW_TAG]: JSON.stringify(workflow) }))?.definition.goal)
      .toBe('Ship visual workflows');
    expect(parseThreadWorkflow(thread({ [THREAD_WORKFLOW_TAG]: '{bad' }))).toBeNull();
  });

  it('recognizes workflow project shells separately from regular project chats', () => {
    expect(isWorkflowProjectThread(thread({ [THREAD_WORKFLOW_PROJECT_TAG]: 'true' }))).toBe(true);
    expect(isWorkflowProjectThread(thread({ [THREAD_WORKFLOW_TAG]: JSON.stringify(workflow) }))).toBe(true);
    expect(isWorkflowProjectThread(thread({ conversationKind: 'chat' }))).toBe(false);
  });

  it('recovers the latest workflow snapshot from checkpoint items', () => {
    const older: WorkflowSnapshot = {
      ...workflow,
      definition: { ...workflow.definition, id: 'wf_old', goal: 'Old workflow' },
      run: { ...workflow.run, id: 'run_old', workflowId: 'wf_old', goal: 'Old workflow' },
    };

    expect(parseWorkflowCheckpointItems([
      { id: 'older', type: 'workflow_checkpoint', workflow: older },
      { id: 'noise', type: 'agent_message', text: 'not a checkpoint' },
      { id: 'latest', type: 'workflow_checkpoint', workflow },
    ])?.definition.goal).toBe('Ship visual workflows');
    expect(parseWorkflowCheckpointItems([{ id: 'bad', type: 'workflow_checkpoint', workflow: { definition: {} } }])).toBeNull();
  });

  it('updates editable node draft fields without changing node id or run state', () => {
    const next = updateWorkflowNodeDraft(workflow, 'execute', {
      title: 'Execute carefully',
      prompt: 'Use registered components only.',
      inputRequirements: 'Plan and target files',
      outputRequirements: 'Result and tests',
      dependsOn: ['scope'],
      approval: 'none',
    });

    expect(next.definition.nodes.find((node) => node.id === 'execute')).toMatchObject({
      id: 'execute',
      title: 'Execute carefully',
      approval: 'none',
    });
    expect(next.run.nodeRuns.find((nodeRun) => nodeRun.nodeId === 'scope')).toMatchObject({
      status: 'completed',
      result: 'done',
    });
  });

  it('formats dependencies for compact graph labels', () => {
    expect(workflowNodeDependencyText(workflow.definition.nodes[0])).toBe('entry');
    expect(workflowNodeDependencyText(workflow.definition.nodes[1])).toBe('scope');
  });

  it('creates workflow draft transcript items rather than raw checkpoint text', () => {
    const user = createWorkflowDraftUserItem('做 agent 成熟度对比', 'draft-turn', new Date('2026-06-16T00:00:00.000Z'));
    const reply = createWorkflowDraftReplyItem({
      kind: 'workflow_draft',
      goal: workflow.definition.goal,
      workflow,
      components: [],
      blueprint: {
        ok: true,
        diagnostics: [],
        entryNodeIds: ['scope'],
        terminalNodeIds: ['execute'],
        topology: ['scope', 'execute'],
        runnableNodeIds: ['scope'],
        missingInputs: [],
        referencedVariables: [],
      },
    }, 'zh', 'draft-turn', new Date('2026-06-16T00:00:01.000Z'));
    const error = createWorkflowDraftErrorItem('bad json', 'zh', 'draft-turn', new Date('2026-06-16T00:00:02.000Z'));

    expect(user).toMatchObject({ type: 'user_message', text: '做 agent 成熟度对比' });
    expect(reply.type).toBe('agent_message');
    expect(reply.text).toContain('工作流草案');
    expect(reply.text).not.toContain('"definition"');
    expect(error.text).toContain('工作流草案生成失败');
  });

  it('normalizes workflow project titles for untitled shells', () => {
    expect(workflowThreadTitleFromGoal('  创建一个 agent 对比工作流\n补充说明')).toBe('创建一个 agent 对比工作流');
    expect(workflowThreadTitleFromGoal('', '未命名工作流项目')).toBe('未命名工作流项目');
    expect(isUntitledWorkflowProjectTitle('未命名工作流项目')).toBe(true);
    expect(isUntitledWorkflowProjectTitle('已有工作流')).toBe(false);
  });
});
