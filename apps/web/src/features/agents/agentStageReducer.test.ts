import { describe, expect, it } from 'vitest';
import {
  agentStageReducer,
  buildStageDetail,
  buildStagesFromItems,
  findAgentById,
  initialAgentStageState,
  pickDefaultSelection,
  selectStagesForAgent,
  selectStageDetail,
  stageStatusFromItem,
  stageTypeFromItem,
  type AgentNode,
  type StageStatus,
  type StageType,
} from './agentStageReducer.js';
import type { ThreadItem } from '../../shared/types.js';

// 构造测试用 ThreadItem
function makeItem(overrides: Partial<ThreadItem> & { id: string; type: string }): ThreadItem {
  return {
    status: 'completed',
    timestamp: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

// 构造测试用 AgentNode
function makeAgent(overrides: Partial<AgentNode> & { id: string }): AgentNode {
  return {
    name: 'Test Agent',
    role: 'primary',
    status: 'idle',
    currentStep: '',
    tokenUsage: { used: 0, limit: 0 },
    depth: 0,
    parentId: null,
    children: [],
    items: [],
    tone: 'muted',
    updatedAt: '',
    ...overrides,
  };
}

describe('stageTypeFromItem', () => {
  // 16 种 ThreadItem 类型 → StageType 映射
  it('maps all 16 ThreadItem types to the correct StageType', () => {
    const cases: Array<{ type: string; expected: StageType }> = [
      { type: 'user_message', expected: 'message' },
      { type: 'agent_message', expected: 'message' },
      { type: 'reasoning', expected: 'planning' },
      { type: 'tool_call', expected: 'tool_calling' },
      { type: 'mcp_tool_call', expected: 'tool_calling' },
      { type: 'collab_tool_call', expected: 'tool_calling' },
      { type: 'command_execution', expected: 'tool_calling' },
      { type: 'file_change', expected: 'file_operation' },
      { type: 'web_search', expected: 'web_research' },
      { type: 'todo_list', expected: 'todo_management' },
      { type: 'error', expected: 'error_handling' },
      { type: 'context_compaction', expected: 'compaction' },
      { type: 'workflow_checkpoint', expected: 'checkpoint' },
      { type: 'project_checkpoint', expected: 'checkpoint' },
      { type: 'rollback_conflict', expected: 'continuation' },
      { type: 'harness_continuation', expected: 'continuation' },
    ];
    for (const { type, expected } of cases) {
      expect(stageTypeFromItem(type)).toBe(expected);
    }
  });

  it('falls back to "message" for unknown ThreadItem types', () => {
    expect(stageTypeFromItem('unknown_type')).toBe('message');
    expect(stageTypeFromItem('')).toBe('message');
  });
});

describe('stageStatusFromItem', () => {
  it('maps item status to stage status', () => {
    expect(stageStatusFromItem(makeItem({ id: 'a', type: 'tool_call', status: 'completed' }))).toBe<StageStatus>('completed');
    expect(stageStatusFromItem(makeItem({ id: 'b', type: 'tool_call', status: 'running' }))).toBe<StageStatus>('running');
    expect(stageStatusFromItem(makeItem({ id: 'c', type: 'tool_call', status: 'failed' }))).toBe<StageStatus>('failed');
    expect(stageStatusFromItem(makeItem({ id: 'd', type: 'tool_call', status: 'error' }))).toBe<StageStatus>('failed');
  });

  it('treats item with error field as failed', () => {
    expect(stageStatusFromItem(makeItem({ id: 'e', type: 'tool_call', status: 'completed', error: { message: 'oops' } }))).toBe<StageStatus>('failed');
  });
});

describe('buildStagesFromItems', () => {
  it('sorts stages by timestamp ascending', () => {
    const items: ThreadItem[] = [
      makeItem({ id: 'late', type: 'tool_call', timestamp: '2026-07-18T00:00:10.000Z' }),
      makeItem({ id: 'early', type: 'tool_call', timestamp: '2026-07-18T00:00:01.000Z' }),
      makeItem({ id: 'mid', type: 'tool_call', timestamp: '2026-07-18T00:00:05.000Z' }),
    ];
    const stages = buildStagesFromItems('agent_1', items, 'zh');
    expect(stages.map((s) => s.id)).toEqual([
      'agent_1::early',
      'agent_1::mid',
      'agent_1::late',
    ]);
  });

  it('produces stage ids in the form `${agentId}::${itemId}`', () => {
    const items: ThreadItem[] = [makeItem({ id: 'item_1', type: 'tool_call' })];
    const stages = buildStagesFromItems('agent_x', items, 'zh');
    expect(stages[0].id).toBe('agent_x::item_1');
    expect(stages[0].agentId).toBe('agent_x');
  });
});

describe('pickDefaultSelection', () => {
  it('returns null selection for empty agents', () => {
    expect(pickDefaultSelection([])).toEqual({ agentId: null, stageId: null });
  });

  it('selects the first agent and its latest item as the default stage', () => {
    const agents: AgentNode[] = [
      makeAgent({
        id: 'agent_1',
        items: [
          makeItem({ id: 'first', type: 'tool_call' }),
          makeItem({ id: 'second', type: 'tool_call' }),
          makeItem({ id: 'third', type: 'tool_call' }),
        ],
      }),
    ];
    const selection = pickDefaultSelection(agents);
    expect(selection.agentId).toBe('agent_1');
    // 最新阶段 = items 数组最后一个
    expect(selection.stageId).toBe('agent_1::third');
  });
});

describe('agentStageReducer', () => {
  it('init sets default selection to first agent + latest stage and expands agents with children', () => {
    const agents: AgentNode[] = [
      makeAgent({
        id: 'main',
        children: [makeAgent({ id: 'child_a' })],
        items: [makeItem({ id: 'i1', type: 'tool_call' })],
      }),
      makeAgent({ id: 'orphan', items: [makeItem({ id: 'i2', type: 'reasoning' })] }),
    ];
    const state = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    expect(state.agents).toBe(agents);
    expect(state.selectedAgentId).toBe('main');
    expect(state.selectedStageId).toBe('main::i1');
    // 默认展开有子节点的 agent
    expect(state.expandedAgentIds).toContain('main');
    expect(state.expandedAgentIds).not.toContain('orphan');
  });

  it('init preserves existing selection when agent and stage still exist', () => {
    const agents: AgentNode[] = [
      makeAgent({
        id: 'main',
        items: [makeItem({ id: 'i1', type: 'tool_call' }), makeItem({ id: 'i2', type: 'reasoning' })],
      }),
    ];
    const first = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    // 用户切到 i1（不是默认的 i2）
    const afterSelect = agentStageReducer(first, { type: 'selectStage', stageId: 'main::i1' });
    expect(afterSelect.selectedStageId).toBe('main::i1');
    // 再次 init（agents 引用变化），应保留用户选择
    const reInit = agentStageReducer(afterSelect, { type: 'init', agents });
    expect(reInit.selectedAgentId).toBe('main');
    expect(reInit.selectedStageId).toBe('main::i1');
  });

  it('selectAgent switches to the agent and auto-selects its latest stage', () => {
    const agents: AgentNode[] = [
      makeAgent({ id: 'a', items: [makeItem({ id: 'a1', type: 'tool_call' })] }),
      makeAgent({
        id: 'b',
        items: [
          makeItem({ id: 'b1', type: 'tool_call' }),
          makeItem({ id: 'b2', type: 'reasoning' }),
        ],
      }),
    ];
    let state = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    expect(state.selectedAgentId).toBe('a');
    state = agentStageReducer(state, { type: 'selectAgent', agentId: 'b' });
    expect(state.selectedAgentId).toBe('b');
    // 自动选中 b 的最新阶段（items 最后一个）
    expect(state.selectedStageId).toBe('b::b2');
  });

  it('selectStage updates only the selectedStageId', () => {
    const agents: AgentNode[] = [
      makeAgent({ id: 'a', items: [makeItem({ id: 'a1', type: 'tool_call' })] }),
    ];
    let state = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    state = agentStageReducer(state, { type: 'selectStage', stageId: 'a::a1' });
    expect(state.selectedStageId).toBe('a::a1');
  });

  it('toggleAgent flips expansion state', () => {
    const agents: AgentNode[] = [
      makeAgent({ id: 'parent', children: [makeAgent({ id: 'child' })] }),
    ];
    let state = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    // init 后 parent 默认展开
    expect(state.expandedAgentIds).toContain('parent');
    state = agentStageReducer(state, { type: 'toggleAgent', agentId: 'parent' });
    expect(state.expandedAgentIds).not.toContain('parent');
    state = agentStageReducer(state, { type: 'toggleAgent', agentId: 'parent' });
    expect(state.expandedAgentIds).toContain('parent');
  });

  it('expandAgent and collapseAgent set explicit expansion state', () => {
    const agents: AgentNode[] = [makeAgent({ id: 'a', children: [makeAgent({ id: 'b' })] })];
    let state = agentStageReducer(initialAgentStageState(), { type: 'init', agents });
    state = agentStageReducer(state, { type: 'collapseAgent', agentId: 'a' });
    expect(state.expandedAgentIds).not.toContain('a');
    state = agentStageReducer(state, { type: 'expandAgent', agentId: 'a' });
    expect(state.expandedAgentIds).toContain('a');
    // expandAgent 幂等
    state = agentStageReducer(state, { type: 'expandAgent', agentId: 'a' });
    expect(state.expandedAgentIds.filter((id) => id === 'a').length).toBe(1);
  });
});

describe('findAgentById', () => {
  it('recursively locates agents in nested trees', () => {
    const tree: AgentNode[] = [
      makeAgent({
        id: 'root',
        children: [
          makeAgent({
            id: 'mid',
            children: [makeAgent({ id: 'leaf' })],
          }),
        ],
      }),
    ];
    expect(findAgentById(tree, 'root')?.id).toBe('root');
    expect(findAgentById(tree, 'mid')?.id).toBe('mid');
    expect(findAgentById(tree, 'leaf')?.id).toBe('leaf');
    expect(findAgentById(tree, 'missing')).toBeNull();
  });
});

describe('selectStagesForAgent and selectStageDetail', () => {
  it('returns sorted stages and matching detail', () => {
    const agent = makeAgent({
      id: 'a',
      items: [
        makeItem({ id: 'late', type: 'tool_call', timestamp: '2026-07-18T00:00:10.000Z', toolName: 'read_file', arguments: { path: '/a' }, result: 'ok' }),
        makeItem({ id: 'early', type: 'reasoning', timestamp: '2026-07-18T00:00:01.000Z', text: 'planning' }),
      ],
    });
    const stages = selectStagesForAgent(agent, 'zh');
    expect(stages.map((s) => s.id)).toEqual(['a::early', 'a::late']);
    const detail = selectStageDetail(agent, 'a::late', 'zh');
    expect(detail).not.toBeNull();
    expect(detail?.stage.id).toBe('a::late');
    expect(detail?.itemId).toBe('late');
    expect(detail?.input).toEqual({ path: '/a' });
    expect(detail?.output).toBe('ok');
  });

  it('returns null when stage id does not match any stage', () => {
    const agent = makeAgent({ id: 'a', items: [makeItem({ id: 'i1', type: 'tool_call' })] });
    expect(selectStageDetail(agent, 'a::missing', 'zh')).toBeNull();
  });
});

describe('buildStageDetail', () => {
  it('extracts input/output/error from the underlying item', () => {
    const agent = makeAgent({ id: 'a' });
    const item = makeItem({
      id: 'err',
      type: 'tool_call',
      arguments: { cmd: 'rm -rf' },
      error: { message: 'permission denied' },
    });
    const stages = buildStagesFromItems(agent.id, [item], 'zh');
    const detail = buildStageDetail(stages[0]);
    expect(detail.input).toEqual({ cmd: 'rm -rf' });
    expect(detail.error).toBe('permission denied');
    expect(detail.itemId).toBe('err');
  });
});
