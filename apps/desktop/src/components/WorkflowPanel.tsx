import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { Locale } from '../config/config.js';
import type { RunEvent } from '../shared/types.js';
import {
  updateWorkflowNodeDraft,
  workflowNodeDependencyText,
  workflowNodeStatus,
  type WorkflowApprovalMode,
  type WorkflowBlueprintCompileResult,
  type WorkflowComponentDefinition,
  type WorkflowComponentField,
  type WorkflowNode,
  type WorkflowPlanDraft,
  type WorkflowSnapshot,
} from '../features/workflow/workflow.js';

export function WorkflowPanel({
  locale,
  workflow,
  blueprint,
  components,
  planDraft,
  saving,
  onSave,
  onCancelPlan,
  onCommitPlan,
  onSelectionChange,
  onRunWorkflow,
  onTestWorkflow,
  onPublishWorkflow,
  onResumeWorkflow,
  onCancelWorkflow,
  onRetryWorkflowNode,
  runtimeBusy = false,
  runEvents = [],
  initialViewMode = 'development',
}: {
  locale: Locale;
  workflow: WorkflowSnapshot | null;
  blueprint?: WorkflowBlueprintCompileResult | null;
  components: WorkflowComponentDefinition[];
  planDraft: WorkflowPlanDraft | null;
  saving: boolean;
  onSave(workflow: WorkflowSnapshot): void;
  onCancelPlan(): void;
  onCommitPlan(): void;
  onSelectionChange?(nodeIds: string[]): void;
  onRunWorkflow?(): void;
  onTestWorkflow?(): void;
  onPublishWorkflow?(): void;
  onResumeWorkflow?(): void;
  onCancelWorkflow?(): void;
  onRetryWorkflowNode?(nodeId: string): void;
  runtimeBusy?: boolean;
  runEvents?: RunEvent[];
  initialViewMode?: 'development' | 'release';
}) {
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'development' | 'release'>(initialViewMode);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [nodeLayout, setNodeLayout] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const developmentMode = planDraft ? true : viewMode === 'development';
  const publishedWorkflow = workflow?.publishedDefinition ? { ...workflow, definition: workflow.publishedDefinition } : null;
  const displayedWorkflow = planDraft?.workflow ?? (developmentMode ? workflow : (publishedWorkflow ?? workflow));
  const displayedBlueprint = planDraft?.blueprint ?? blueprint ?? null;
  const selectedNode = useMemo(() => {
    if (!displayedWorkflow || !selectedNodeId) return null;
    return displayedWorkflow.definition.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [displayedWorkflow, selectedNodeId]);

  useEffect(() => onSelectionChange?.(selectedNodeIds), [onSelectionChange, selectedNodeIds]);
  useEffect(() => {
    setSelectedNodeId('');
    setSelectedNodeIds([]);
    setViewport({ x: 0, y: 0, scale: 1 });
  }, [displayedWorkflow?.definition.id, displayedWorkflow?.definition.version]);
  useEffect(() => {
    if (displayedWorkflow?.definition.ui?.layout?.nodes) {
      setNodeLayout(displayedWorkflow.definition.ui.layout.nodes);
    }
  }, [displayedWorkflow?.definition.id, displayedWorkflow?.definition.version]);

  if (!displayedWorkflow || displayedWorkflow.definition.nodes.length === 0) {
    return (
      <section className="workflowPanel emptyWorkflow">
        <div className="workflowPanelHeader">
          <div>
            <h2>{locale === 'zh' ? '工作流' : 'Workflow'}</h2>
            <p>{locale === 'zh' ? '从下方输入目标并使用计划模式开始。' : 'Use the composer below and start with Plan mode.'}</p>
          </div>
        </div>
      </section>
    );
  }

  const workflowView = displayedWorkflow;
  const activeNode = selectedNode ?? workflowView.definition.nodes.find((node) => workflowNodeStatus(workflowView, node.id) === 'running') ?? null;
  const actionableNodeRun = workflowView.run.nodeRuns.find((nodeRun) => nodeRun.status === 'failed' || nodeRun.status === 'blocked') ?? null;
  const actionableNode = actionableNodeRun ? workflowView.definition.nodes.find((node) => node.id === actionableNodeRun.nodeId) ?? null : null;
  const releaseWithoutPublished = !planDraft && viewMode === 'release' && workflow && !workflow.publishedDefinition;

  function toggleSelectedNode(nodeId: string): void {
    setSelectedNodeIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId]);
  }

  function addNodeAfterSelection(): void {
    const anchor = selectedNode ?? workflowView.definition.nodes[workflowView.definition.nodes.length - 1];
    const component = components.find((item) => item.sealed !== true) ?? components.find((item) => item.type === 'prompt_task') ?? components[0];
    const componentType = component?.type ?? 'prompt_task';
    const id = `user_node_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const node: WorkflowNode = {
      id,
      componentType,
      title: locale === 'zh' ? '新节点' : 'New node',
      prompt: component?.defaultPrompt ?? '',
      inputRequirements: '',
      outputRequirements: '',
      dependsOn: anchor ? [anchor.id] : [],
      approval: component?.requiresApproval ? 'required' : 'none',
      params: {},
    };
    onSave({
      ...workflowView,
      definition: {
        ...workflowView.definition,
        version: workflowView.definition.version + 1,
        nodes: [...workflowView.definition.nodes, node],
        edges: anchor ? [...workflowView.definition.edges, { from: anchor.id, to: id }] : workflowView.definition.edges,
        graph: workflowView.definition.graph
          ? { ...workflowView.definition.graph, terminalNodeIds: [id] }
          : { version: 1, entryNodeId: id, terminalNodeIds: [id] },
        updatedAt: now,
      },
      run: {
        ...workflowView.run,
        nodeRuns: [...workflowView.run.nodeRuns, { nodeId: id, status: 'pending' }],
        updatedAt: now,
      },
      publication: { ...(workflowView.publication ?? { status: 'draft' }), status: 'draft' },
    });
    setSelectedNodeId(id);
    setSelectedNodeIds([id]);
  }

  function duplicateSelectedNode(): void {
    if (!selectedNode) return;
    const id = `${selectedNode.id}_copy_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const node: WorkflowNode = { ...selectedNode, id, title: `${selectedNode.title} Copy`, dependsOn: [...selectedNode.dependsOn] };
    onSave({
      ...workflowView,
      definition: {
        ...workflowView.definition,
        version: workflowView.definition.version + 1,
        nodes: [...workflowView.definition.nodes, node],
        edges: [
          ...workflowView.definition.edges,
          ...node.dependsOn.map((from) => ({ from, to: id })),
        ],
        updatedAt: now,
      },
      run: {
        ...workflowView.run,
        nodeRuns: [...workflowView.run.nodeRuns, { nodeId: id, status: 'pending' }],
        updatedAt: now,
      },
      publication: { ...(workflowView.publication ?? { status: 'draft' }), status: 'draft' },
    });
    setSelectedNodeId(id);
    setSelectedNodeIds([id]);
  }

  function deleteSelectedNodes(): void {
    const ids = new Set(selectedNodeIds.length ? selectedNodeIds : (selectedNode ? [selectedNode.id] : []));
    if (ids.size === 0 || workflowView.definition.nodes.length <= ids.size) return;
    const now = new Date().toISOString();
    onSave({
      ...workflowView,
      definition: {
        ...workflowView.definition,
        version: workflowView.definition.version + 1,
        nodes: workflowView.definition.nodes
          .filter((node) => !ids.has(node.id))
          .map((node) => ({ ...node, dependsOn: node.dependsOn.filter((id) => !ids.has(id)) })),
        edges: workflowView.definition.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
        graph: workflowView.definition.graph
          ? {
            ...workflowView.definition.graph,
            terminalNodeIds: workflowView.definition.graph.terminalNodeIds.filter((id) => !ids.has(id)),
          }
          : workflowView.definition.graph,
        updatedAt: now,
      },
      run: {
        ...workflowView.run,
        nodeRuns: workflowView.run.nodeRuns.filter((nodeRun) => !ids.has(nodeRun.nodeId)),
        updatedAt: now,
      },
      publication: { ...(workflowView.publication ?? { status: 'draft' }), status: 'draft' },
    });
    setSelectedNodeId('');
    setSelectedNodeIds([]);
  }

  async function cloneSelectedComponent(): Promise<void> {
    if (!selectedNode) return;
    const component = components.find((item) => item.type === selectedNode.componentType);
    if (!component) return;
    const type = `user_${component.type.replace(/^user_/, '')}_${Date.now().toString(36)}`;
    const response = await fetch('/api/workflow/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: {
          ...component,
          type,
          name: `${component.name} Copy`,
          description: component.description,
          defaultPrompt: selectedNode.prompt || component.defaultPrompt,
          sealed: false,
          source: component.source === 'tool' ? 'tool' : 'prompt',
        },
      }),
    });
    if (!response.ok) return;
    onSave(updateWorkflowNodeDraft(workflowView, selectedNode.id, { componentType: type, prompt: selectedNode.prompt }));
  }

  function startNodeDrag(event: PointerEvent<HTMLElement>, nodeId: string): void {
    if (event.button !== 0) return;
    const pos = nodeLayout[nodeId] ?? { x: 0, y: 0 };
    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveNodeDrag(event: PointerEvent<HTMLElement>): void {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / viewport.scale;
    const dy = (event.clientY - drag.startY) / viewport.scale;
    setNodeLayout((prev) => ({
      ...prev,
      [drag.nodeId]: { x: drag.originX + dx, y: drag.originY + dy },
    }));
  }

  function endNodeDrag(_event: PointerEvent<HTMLElement>): void {
    if (!nodeDragRef.current) return;
    const nodeId = nodeDragRef.current.nodeId;
    nodeDragRef.current = null;
    if (displayedWorkflow && nodeLayout[nodeId]) {
      onSave({
        ...displayedWorkflow,
        definition: {
          ...displayedWorkflow.definition,
          ui: {
            ...displayedWorkflow.definition.ui,
            layout: {
              ...displayedWorkflow.definition.ui?.layout,
              nodes: { ...nodeLayout, [nodeId]: nodeLayout[nodeId] },
            },
          },
        },
      });
    }
  }

  function addEdge(fromNodeId: string, toNodeId: string): void {
    if (fromNodeId === toNodeId) return;
    if (!displayedWorkflow) return;
    const exists = displayedWorkflow.definition.edges.some((e) => e.from === fromNodeId && e.to === toNodeId);
    if (exists) return;
    const now = new Date().toISOString();
    onSave({
      ...displayedWorkflow,
      definition: {
        ...displayedWorkflow.definition,
        version: displayedWorkflow.definition.version + 1,
        edges: [...displayedWorkflow.definition.edges, { from: fromNodeId, to: toNodeId }],
        nodes: displayedWorkflow.definition.nodes.map((n) =>
          n.id === toNodeId && !n.dependsOn.includes(fromNodeId)
            ? { ...n, dependsOn: [...n.dependsOn, fromNodeId] }
            : n,
        ),
        updatedAt: now,
      },
      publication: { ...(displayedWorkflow.publication ?? { status: 'draft' }), status: 'draft' },
    });
  }

  function handleConnectClick(nodeId: string): void {
    if (connectingFrom === null) {
      setConnectingFrom(nodeId);
    } else if (connectingFrom === nodeId) {
      setConnectingFrom(null);
    } else {
      addEdge(connectingFrom, nodeId);
      setConnectingFrom(null);
    }
  }

  return (
    <section className="workflowPanel">
      {planDraft ? (
        <WorkflowPlanDraftView
          draft={planDraft}
          locale={locale}
          saving={saving}
          onCancel={onCancelPlan}
          onCommit={onCommitPlan}
        />
      ) : null}

      {displayedBlueprint ? <WorkflowBlueprintSummary locale={locale} blueprint={displayedBlueprint} /> : null}

      {!planDraft ? (
        <WorkflowRuntimeControls
          locale={locale}
          workflow={displayedWorkflow}
          activeNode={actionableNode ?? activeNode}
          busy={runtimeBusy}
          onRun={onRunWorkflow}
          onTestRun={onTestWorkflow}
          onPublish={onPublishWorkflow}
          onResume={onResumeWorkflow}
          onCancel={onCancelWorkflow}
          onRetry={actionableNodeRun ? () => onRetryWorkflowNode?.(actionableNodeRun.nodeId) : undefined}
        />
      ) : null}

      <section className="workflowCanvasShell">
        <header className="workflowCanvasToolbar">
          <div>
            <strong>{displayedWorkflow.definition.goal}</strong>
            <p>{developmentMode
              ? (locale === 'zh' ? '选中节点后，在底部输入框描述修改要求。' : 'Select nodes, then describe changes in the bottom composer.')
              : releaseWithoutPublished
                ? (locale === 'zh' ? '尚未发布；回到开发模式测试并发布后再正式运行。' : 'Not published yet; test and publish from development mode before running.')
                : (locale === 'zh' ? '发布模式展示已发布版本的运行路径和当前步骤。' : 'Release mode shows the published execution path and current step.')}</p>
          </div>
          <div className="workflowToolbarActions">
            {developmentMode ? (
              <>
                <button className="textButton" type="button" onClick={addNodeAfterSelection}>{locale === 'zh' ? '添加节点' : 'Add node'}</button>
                <button className="textButton" type="button" disabled={!selectedNode} onClick={duplicateSelectedNode}>{locale === 'zh' ? '复制节点' : 'Duplicate'}</button>
                <button className="textButton" type="button" disabled={!selectedNode} onClick={() => void cloneSelectedComponent()}>{locale === 'zh' ? '克隆组件' : 'Clone component'}</button>
                <button className="textButton danger" type="button" disabled={!selectedNode && selectedNodeIds.length === 0} onClick={deleteSelectedNodes}>{locale === 'zh' ? '删除节点' : 'Delete'}</button>
              </>
            ) : null}
            <div className="workflowModeTabs" role="tablist" aria-label={locale === 'zh' ? '工作流模式' : 'Workflow mode'}>
              <button className={developmentMode ? 'active' : ''} type="button" onClick={() => setViewMode('development')}>{locale === 'zh' ? '开发模式' : 'Develop'}</button>
              <button className={!developmentMode ? 'active' : ''} type="button" onClick={() => setViewMode('release')}>{locale === 'zh' ? '发布模式' : 'Release'}</button>
            </div>
          </div>
        </header>

        <div
          className={['workflowGraph', developmentMode ? 'development' : 'release', dragging ? 'dragging' : ''].filter(Boolean).join(' ')}
          aria-label={locale === 'zh' ? '工作流节点图' : 'Workflow graph'}
          onWheel={handleGraphWheel}
          onPointerDown={startCanvasDrag}
          onPointerMove={moveCanvasDrag}
          onPointerUp={endCanvasDrag}
          onPointerCancel={endCanvasDrag}
          onPointerLeave={endCanvasDrag}
        >
          <div className="workflowCanvasStage" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
            {displayedWorkflow.definition.nodes.map((node, index) => {
              const status = workflowNodeStatus(displayedWorkflow, node.id);
              const active = activeNode?.id === node.id;
              const selected = selectedNodeIds.includes(node.id);
              const incomingEdges = displayedWorkflow.definition.edges.filter((e) => e.to === node.id);
              const outgoingEdges = displayedWorkflow.definition.edges.filter((e) => e.from === node.id);
              const pos = nodeLayout[node.id] ?? { x: 0, y: 0 };
              const isConnecting = connectingFrom === node.id;
              return (
                <div className="workflowStepWrap" key={node.id} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
                  {incomingEdges.length > 0 ? (
                    <div className="workflowEdgeIndicator">
                      {incomingEdges.map((edge) => {
                        const fromNode = displayedWorkflow.definition.nodes.find((n) => n.id === edge.from);
                        return (
                          <span key={`${edge.from}-${edge.to}`} className="workflowEdgeLabel">
                            {locale === 'zh' ? '← 来自' : '← from'} {fromNode?.title ?? edge.from}
                            {edge.condition ? ` (${edge.condition})` : ''}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                  <article
                    className={['workflowNode', active ? 'active' : '', selected ? 'selected' : '', status, isConnecting ? 'connecting' : ''].filter(Boolean).join(' ')}
                    onPointerDown={developmentMode ? (e) => startNodeDrag(e, node.id) : undefined}
                    onPointerMove={developmentMode ? moveNodeDrag : undefined}
                    onPointerUp={developmentMode ? endNodeDrag : undefined}
                    onPointerCancel={developmentMode ? endNodeDrag : undefined}
                  >
                    <div className="workflowNodeTopline">
                      {developmentMode ? (
                        <input
                          aria-label={`${locale === 'zh' ? '选择节点' : 'Select node'} ${node.title}`}
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSelectedNode(node.id)}
                        />
                      ) : null}
                      <button type="button" onClick={() => setSelectedNodeId(node.id)}>
                        <span className="workflowNodeIndex">{locale === 'zh' ? `步骤 ${index + 1}` : `Step ${index + 1}`}</span>
                        <strong>{node.title}</strong>
                      </button>
                      <span className="workflowNodeStatus">{statusLabel(status, locale)}</span>
                    </div>
                    <button className="workflowNodeBody" type="button" onClick={() => setSelectedNodeId(node.id)}>
                      <small>{node.componentType} · {workflowNodeDependencyText(node)}</small>
                      <span>{workflowNodeVariableSummary(node)}</span>
                    </button>
                    {developmentMode ? (
                      <button
                        className={['workflowConnectAnchor', isConnecting ? 'active' : ''].filter(Boolean).join(' ')}
                        type="button"
                        title={isConnecting ? (locale === 'zh' ? '点击目标节点完成连线' : 'Click target node to connect') : (locale === 'zh' ? '开始连线' : 'Start connection')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleConnectClick(node.id); }}
                      >
                        {isConnecting ? (locale === 'zh' ? '取消连线' : 'Cancel') : '+'}
                      </button>
                    ) : null}
                  </article>
                  {outgoingEdges.length > 1 ? (
                    <div className="workflowBranchIndicator">
                      {locale === 'zh' ? `分支到 ${outgoingEdges.length} 个节点` : `Branches to ${outgoingEdges.length} nodes`}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {developmentMode && selectedNode ? (
        <aside className="workflowNodeInspector" role="dialog" aria-label={locale === 'zh' ? '节点契约' : 'Node contract'}>
          <WorkflowNodeEditor
            key={selectedNode.id}
            locale={locale}
            node={selectedNode}
            allNodes={displayedWorkflow.definition.nodes}
            component={components.find((component) => component.type === selectedNode.componentType)}
            runEvents={runEvents.filter((event) => event.workflowNodeId === selectedNode.id)}
            saving={saving}
            onClose={() => setSelectedNodeId('')}
            onSave={(patch) => onSave(updateWorkflowNodeDraft(displayedWorkflow, selectedNode.id, patch))}
          />
        </aside>
      ) : null}
    </section>
  );

  function startCanvasDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.workflowNode')) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }

  function moveCanvasDrag(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({ ...current, x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }));
  }

  function endCanvasDrag(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  function handleGraphWheel(event: WheelEvent<HTMLDivElement>): void {
    if (event.cancelable) event.preventDefault();
    setViewport((current) => ({ ...current, scale: clampScale(current.scale + (event.deltaY > 0 ? -0.08 : 0.08)) }));
  }
}

function clampScale(scale: number): number {
  return Math.min(1.5, Math.max(0.65, Number(scale.toFixed(2))));
}

function WorkflowRuntimeControls({
  locale,
  workflow,
  activeNode,
  busy,
  onRun,
  onTestRun,
  onPublish,
  onResume,
  onCancel,
  onRetry,
}: {
  locale: Locale;
  workflow: WorkflowSnapshot;
  activeNode: WorkflowNode | null;
  busy: boolean;
  onRun?: () => void;
  onTestRun?: () => void;
  onPublish?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const zh = locale === 'zh';
  const run = workflow.run;
  const blockedOrFailed = run.nodeRuns.find((nodeRun) => nodeRun.status === 'blocked' || nodeRun.status === 'failed');
  const detail = blockedOrFailed?.blockedReason ?? blockedOrFailed?.error ?? activeNode?.title ?? workflow.definition.goal;
  return (
    <section className="workflowRuntimeBar">
      <div>
        <strong>{zh ? '运行状态' : 'Run state'}</strong>
        <span>{runStatusLabel(run.status, locale)} · {activeNode?.title ?? workflow.definition.goal}</span>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="workflowRuntimeActions">
        <button className="solidButton" type="button" disabled={busy || run.status === 'running'} onClick={onRun}>
          {busy ? (zh ? '执行中' : 'Running') : (zh ? '运行' : 'Run')}
        </button>
        <button className="textButton" type="button" disabled={busy || run.status === 'running'} onClick={onTestRun}>
          {zh ? '测试运行' : 'Test run'}
        </button>
        <button className="textButton" type="button" disabled={busy || run.status === 'running'} onClick={onPublish}>
          {zh ? '发布' : 'Publish'}
        </button>
        <button className="textButton" type="button" disabled={busy || run.status !== 'blocked'} onClick={onResume}>
          {zh ? '继续' : 'Resume'}
        </button>
        <button className="textButton" type="button" disabled={busy || run.status !== 'running'} onClick={onCancel}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button className="textButton" type="button" disabled={busy || !blockedOrFailed} onClick={onRetry}>
          {zh ? '重试节点' : 'Retry node'}
        </button>
      </div>
    </section>
  );
}

function runStatusLabel(status: WorkflowSnapshot['run']['status'], locale: Locale): string {
  if (locale !== 'zh') return status;
  if (status === 'planned') return '待运行';
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'blocked') return '阻塞';
  if (status === 'cancelled') return '已取消';
  return status;
}

function WorkflowPlanDraftView({
  draft,
  locale,
  saving,
  onCancel,
  onCommit,
}: {
  draft: WorkflowPlanDraft;
  locale: Locale;
  saving: boolean;
  onCancel(): void;
  onCommit(): void;
}) {
  const blueprintMessages = [
    ...(draft.blueprint?.diagnostics.map((item) => item.message) ?? []),
    ...(draft.blueprint?.missingInputs ?? []),
  ].filter((message, index, all) => message && all.indexOf(message) === index);
  const hasBlockingDiagnostics = draft.blueprint?.ok === false
    || draft.blueprint?.diagnostics.some((item) => item.severity === 'error') === true;

  return (
    <section className="workflowPlanDraft">
      <div className="workflowEditorTitle">
        <strong>{locale === 'zh' ? '计划草案' : 'Plan draft'}</strong>
        <span>{locale === 'zh' ? `${draft.workflow.definition.nodes.length} 个步骤` : `${draft.workflow.definition.nodes.length} steps`}</span>
      </div>
      <p>{locale === 'zh' ? '这是整体流程草案，不是三选一。修改要求请从下方输入框提交。' : 'This is the full workflow draft. Use the composer below for changes.'}</p>
      {blueprintMessages.length > 0 ? (
        <div className="workflowBlueprintDiagnostics">
          <strong>{locale === 'zh' ? '蓝图诊断' : 'Blueprint diagnostics'}</strong>
          <ul>
            {blueprintMessages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="workflowDraftActions">
        <button className="textButton" type="button" onClick={onCancel} disabled={saving}>{locale === 'zh' ? '取消' : 'Cancel'}</button>
        <button className="solidButton" type="button" onClick={onCommit} disabled={saving || hasBlockingDiagnostics}>
          {saving ? (locale === 'zh' ? '保存中' : 'Saving') : (locale === 'zh' ? '保存草案' : 'Save draft')}
        </button>
      </div>
    </section>
  );
}

function WorkflowBlueprintSummary({
  locale,
  blueprint,
}: {
  locale: Locale;
  blueprint: WorkflowBlueprintCompileResult;
}) {
  const warnings = blueprint.diagnostics.filter((item) => item.severity === 'warning');
  const errors = blueprint.diagnostics.filter((item) => item.severity === 'error');
  const missingInputs = blueprint.missingInputs.slice(0, 4);
  return (
    <section className="workflowPlanDraft">
      <div className="workflowEditorTitle">
        <strong>{locale === 'zh' ? '蓝图诊断' : 'Blueprint review'}</strong>
        <span>{locale === 'zh' ? `${errors.length} 错误 / ${warnings.length} 提示` : `${errors.length} errors / ${warnings.length} warnings`}</span>
      </div>
      <p>
        {locale === 'zh'
          ? `拓扑顺序：${blueprint.topology.join(' -> ')}`
          : `Topology: ${blueprint.topology.join(' -> ')}`}
      </p>
      {missingInputs.length ? (
        <p>{locale === 'zh' ? `仍需补充：${missingInputs.join('；')}` : `Still needed: ${missingInputs.join('; ')}`}</p>
      ) : null}
    </section>
  );
}

function statusLabel(status: ReturnType<typeof workflowNodeStatus>, locale: Locale): string {
  if (locale !== 'zh') return status === 'running' ? 'current' : status;
  if (status === 'running') return '当前步骤';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'blocked') return '阻塞';
  return '待执行';
}

function WorkflowNodeEditor({
  locale,
  node,
  allNodes,
  component,
  runEvents,
  saving,
  onClose,
  onSave,
}: {
  locale: Locale;
  node: WorkflowNode;
  allNodes: WorkflowNode[];
  component?: WorkflowComponentDefinition;
  runEvents: RunEvent[];
  saving: boolean;
  onClose(): void;
  onSave(patch: {
    title: string;
    prompt: string;
    inputRequirements: string;
    outputRequirements: string;
    dependsOn: string[];
    approval: WorkflowApprovalMode;
    params: Record<string, unknown>;
  }): void;
}) {
  const [title, setTitle] = useState(node.title);
  const [prompt, setPrompt] = useState(node.prompt);
  const [inputRequirements, setInputRequirements] = useState(node.inputRequirements);
  const [outputRequirements, setOutputRequirements] = useState(node.outputRequirements);
  const [dependsOn, setDependsOn] = useState<string[]>(node.dependsOn);
  const [approval, setApproval] = useState<WorkflowApprovalMode>(node.approval);
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...(node.params ?? {}) }));
  const fields = component?.ui?.fields ?? [];
  const sealed = component?.sealed === true;

  function updateParam(name: string, value: unknown): void {
    setParams((current) => ({ ...current, [name]: value }));
  }

  return (
    <form
      className="workflowEditor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          title,
          prompt: sealed ? node.prompt : prompt,
          inputRequirements: sealed ? node.inputRequirements : inputRequirements,
          outputRequirements: sealed ? node.outputRequirements : outputRequirements,
          dependsOn,
          approval,
          params,
        });
      }}
    >
      <div className="workflowEditorTitle">
        <strong>{locale === 'zh' ? '节点契约' : 'Node contract'}</strong>
        <button className="miniIconButton" type="button" onClick={onClose} aria-label={locale === 'zh' ? '关闭节点契约' : 'Close node contract'}>×</button>
      </div>
      <section className="workflowComponentSummary">
        <div>
          <strong>{locale === 'zh' ? '封装组件' : 'Sealed component'}</strong>
          <span>{component?.name ?? node.componentType}</span>
        </div>
        <code>{node.componentType}</code>
      </section>
      {sealed ? (
        <p className="workflowParamEmpty">
          {locale === 'zh'
            ? '内置密封组件的核心 Prompt、输入契约和输出契约只读；如需修改核心逻辑，请克隆为自定义 user_* 组件。'
            : 'Builtin sealed component prompts and IO contracts are read-only. Clone it as a user_* component to change core logic.'}
        </p>
      ) : null}
      <section className="workflowParamSection">
        <div className="workflowEditorTitle">
          <strong>{locale === 'zh' ? '组件参数' : 'Component params'}</strong>
          <span>{fields.length ? `${fields.length}` : (locale === 'zh' ? '无' : 'none')}</span>
        </div>
        {fields.length ? fields.map((field) => (
          <WorkflowParamField
            key={field.name}
            field={field}
            locale={locale}
            value={params[field.name]}
            onChange={(value) => updateParam(field.name, value)}
          />
        )) : (
          <p className="workflowParamEmpty">
            {locale === 'zh' ? '此组件没有需要填写的结构化参数。' : 'This component has no structured params.'}
          </p>
        )}
      </section>
      <section className="workflowParamSection">
        <div className="workflowEditorTitle">
          <strong>{locale === 'zh' ? '运行日志' : 'Run logs'}</strong>
          <span>{runEvents.length}</span>
        </div>
        {runEvents.length ? runEvents.slice(-8).map((event) => (
          <p className="workflowParamEmpty" key={event.eventId}>{event.type} · {event.message}</p>
        )) : (
          <p className="workflowParamEmpty">
            {locale === 'zh' ? '此节点暂无运行日志。' : 'No run logs for this node yet.'}
          </p>
        )}
      </section>
      <section className="workflowParamSection">
        <div className="workflowEditorTitle">
          <strong>{locale === 'zh' ? '变量绑定' : 'Variable bindings'}</strong>
          <span>{extractWorkflowVariableRefs(`${prompt}\n${inputRequirements}\n${outputRequirements}`).length}</span>
        </div>
        {extractWorkflowVariableRefs(`${prompt}\n${inputRequirements}\n${outputRequirements}`).length ? (
          <div className="workflowVariableList">
            {extractWorkflowVariableRefs(`${prompt}\n${inputRequirements}\n${outputRequirements}`).map((ref) => <code key={ref}>{ref}</code>)}
          </div>
        ) : (
          <p className="workflowParamEmpty">
            {locale === 'zh' ? '此节点暂未引用变量。' : 'This node does not reference variables yet.'}
          </p>
        )}
      </section>
      <label>
        <span>{locale === 'zh' ? '标题' : 'Title'}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>{locale === 'zh' ? '节点执行要求' : 'Node instructions'}</span>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} readOnly={sealed} />
      </label>
      <label>
        <span>{locale === 'zh' ? '输入要求' : 'Input requirements'}</span>
        <textarea value={inputRequirements} onChange={(event) => setInputRequirements(event.target.value)} rows={3} readOnly={sealed} />
      </label>
      <label>
        <span>{locale === 'zh' ? '输出要求' : 'Output requirements'}</span>
        <textarea value={outputRequirements} onChange={(event) => setOutputRequirements(event.target.value)} rows={3} readOnly={sealed} />
      </label>
      <fieldset className="workflowDependsOnPicker">
        <legend>{locale === 'zh' ? '依赖节点' : 'Dependencies'}</legend>
        {allNodes.filter((n) => n.id !== node.id).length === 0 ? (
          <p className="workflowParamEmpty">{locale === 'zh' ? '暂无其他可选节点。' : 'No other nodes available.'}</p>
        ) : null}
        {allNodes.filter((n) => n.id !== node.id).map((n) => (
          <label key={n.id} className="workflowCheck">
            <input
              type="checkbox"
              checked={dependsOn.includes(n.id)}
              onChange={(event) => {
                setDependsOn((current) => event.target.checked
                  ? [...current, n.id]
                  : current.filter((id) => id !== n.id));
              }}
            />
            <span>{n.title}</span>
          </label>
        ))}
      </fieldset>
      <label className="workflowCheck">
        <input type="checkbox" checked={approval === 'required'} onChange={(event) => setApproval(event.target.checked ? 'required' : 'none')} />
        <span>{locale === 'zh' ? '需要审批' : 'Requires approval'}</span>
      </label>
      <button className="solidButton" type="submit" disabled={saving}>
        {saving ? (locale === 'zh' ? '保存中' : 'Saving') : (locale === 'zh' ? '保存节点' : 'Save node')}
      </button>
    </form>
  );
}

function WorkflowParamField({
  field,
  locale,
  value,
  onChange,
}: {
  field: WorkflowComponentField;
  locale: Locale;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const label = `${field.label || field.name}${field.required ? ' *' : ''}`;
  if (field.kind === 'checkbox') {
    return (
      <label className="workflowCheck">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (field.kind === 'select') {
    return (
      <label>
        <span>{label}</span>
        <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
          <option value="">{locale === 'zh' ? '请选择' : 'Select'}</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {field.description ? <small>{field.description}</small> : null}
      </label>
    );
  }
  if (field.kind === 'textarea' || field.kind === 'json') {
    const textValue = field.kind === 'json' && typeof value !== 'string'
      ? JSON.stringify(value ?? {}, null, 2)
      : String(value ?? '');
    return (
      <label>
        <span>{label}</span>
        <textarea
          value={textValue}
          onChange={(event) => onChange(field.kind === 'json' ? parseJsonDraft(event.target.value) : event.target.value)}
          rows={field.kind === 'json' ? 5 : 3}
        />
        {field.description ? <small>{field.description}</small> : null}
      </label>
    );
  }
  return (
    <label>
      <span>{label}</span>
      <input
        type={field.kind === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(event) => onChange(field.kind === 'number' ? Number(event.target.value) : event.target.value)}
      />
      {field.description ? <small>{field.description}</small> : null}
    </label>
  );
}

function parseJsonDraft(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function workflowNodeVariableSummary(node: WorkflowNode): string {
  const refs = extractWorkflowVariableRefs(`${node.prompt}\n${node.inputRequirements}\n${node.outputRequirements}\n${JSON.stringify(node.params ?? {})}`);
  if (refs.length === 0) return node.outputRequirements || node.inputRequirements || 'No variable bindings';
  return refs.slice(0, 3).join(' · ');
}

function extractWorkflowVariableRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*){1,2})\s*\}\}/g)].map((match) => match[1]))];
}
