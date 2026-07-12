import React, { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Locale } from '../config/config.js';
import { Icon } from './Icon.js';
import type { GitNexusGraphData } from './gitNexusResult.js';
import {
  computeGitNexusFlowLayout,
  getGitNexusNodeRelations,
  nodeSummary,
  type NodeRelation,
} from './gitNexusFlowLayout.js';

export function GitNexusResultView({ data, locale }: { data: GitNexusGraphData; locale: Locale }): React.ReactElement {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const layout = useMemo(() => computeGitNexusFlowLayout(data), [data]);
  const selectedNode = selectedNodeId ? data.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedRelations = selectedNode ? getGitNexusNodeRelations(data, selectedNode.id) : null;

  const nodes: Node[] = useMemo(() => {
    const laneNodes: Node[] = layout.groupLabels.map((lane) => ({
      id: lane.id,
      data: { label: <div className="gitNexusLaneLabel">{lane.label}: {lane.count}</div> },
      position: lane.position,
      className: 'gitNexusLaneNode',
      selectable: false,
      draggable: false,
    }));

    const graphNodes: Node[] = layout.nodes.map((n) => ({
      id: n.id,
      data: {
        label: (
          <div className="gitNexusNodeLabel">
            <span className="gitNexusNodeTitle">{n.label}</span>
            {nodeSummary(n) ? <span className="gitNexusNodeSubtitle">{nodeSummary(n)}</span> : null}
          </div>
        ),
      },
      position: n.position,
      className: `gitNexusNode gitNexusNode-${n.group ?? 'default'}`,
      draggable: false,
    }));

    return [...laneNodes, ...graphNodes];
  }, [layout]);

  const edges: Edge[] = useMemo(() => data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: false,
    className: 'gitNexusFlowEdge',
  })), [data.edges]);

  const relationList = (items: NodeRelation[], title: string) => (
    <div className="gitNexusDetailRelationGroup">
      <div className="gitNexusDetailRelationTitle">{title}</div>
      {items.length === 0 ? (
        <div className="gitNexusDetailEmpty">{locale === 'zh' ? '无' : 'None'}</div>
      ) : items.slice(0, 8).map((item, index) => (
        <div key={`${item.relation}-${item.node.id}-${index}`} className="gitNexusDetailRelation">
          <span className="gitNexusDetailRelationType">{item.relation}</span>
          <span className="gitNexusDetailRelationNode">{item.node.label}</span>
        </div>
      ))}
    </div>
  );

  const renderGraph = (preview = false) => (
    <div className={preview ? 'gitNexusGraph gitNexusGraphPreviewCanvas' : 'gitNexusGraph'}>
      {!preview ? (
        <button
          type="button"
          className="gitNexusGraphPreviewButton"
          onClick={() => setPreviewOpen(true)}
          title={locale === 'zh' ? '放大预览' : 'Open preview'}
          aria-label={locale === 'zh' ? '放大预览' : 'Open preview'}
        >
          <Icon name="monitor" />
          <span>{locale === 'zh' ? '预览' : 'Preview'}</span>
        </button>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: preview ? 0.28 : 0.22 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => {
          if (!String(node.id).startsWith('lane-')) setSelectedNodeId(node.id);
        }}
        onPaneClick={() => setSelectedNodeId(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} showFitView={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {selectedNode && selectedRelations ? (
        <div className="gitNexusGraphDetailPanel">
          <button
            type="button"
            className="gitNexusGraphDetailClose"
            onClick={() => setSelectedNodeId(null)}
            aria-label={locale === 'zh' ? '关闭' : 'Close'}
          >
            ×
          </button>
          <div className="gitNexusGraphDetailTitle">{selectedNode.label}</div>
          <div className="gitNexusGraphDetailMeta">
            {[selectedNode.kind, selectedNode.file, selectedNode.line ? `L${selectedNode.line}` : ''].filter(Boolean).join(' · ')}
          </div>
          {relationList(selectedRelations.incoming, locale === 'zh' ? '入边' : 'Incoming')}
          {relationList(selectedRelations.outgoing, locale === 'zh' ? '出边' : 'Outgoing')}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="gitNexusResult">
      <div className="gitNexusHeader">{data.title}</div>
      {data.groups && data.groups.length > 0 ? (
        <div className="gitNexusGroups">
          {data.groups.map((g) => (
            <span key={g.label} className="gitNexusGroupTag">{g.label}: {g.count}</span>
          ))}
        </div>
      ) : null}
      {data.kind === 'graph' ? (
        <>
          {renderGraph(false)}
          {previewOpen ? (
            <div className="gitNexusFlowPreviewBackdrop" onClick={() => setPreviewOpen(false)}>
              <div className="gitNexusFlowPreviewPanel" onClick={(e) => e.stopPropagation()}>
                <div className="gitNexusFlowPreviewHeader">
                  <div className="gitNexusFlowPreviewTitle">{data.title}</div>
                  <button
                    type="button"
                    className="gitNexusFlowPreviewClose"
                    onClick={() => setPreviewOpen(false)}
                    aria-label={locale === 'zh' ? '关闭预览' : 'Close preview'}
                    title={locale === 'zh' ? '关闭预览' : 'Close preview'}
                  >
                    <Icon name="x" />
                  </button>
                </div>
                {renderGraph(true)}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="gitNexusList">
          {(data.rows ?? []).length === 0 ? (
            <div className="gitNexusEmpty">{locale === 'zh' ? '无结果' : 'No results'}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{locale === 'zh' ? '符号' : 'Symbol'}</th>
                  <th>{locale === 'zh' ? '类型' : 'Kind'}</th>
                  <th>{locale === 'zh' ? '文件' : 'File'}</th>
                  <th>{locale === 'zh' ? '行' : 'Line'}</th>
                  <th>{locale === 'zh' ? '分数' : 'Score'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows ?? []).map((row, i) => (
                  <tr key={`${row.name}-${i}`}>
                    <td className="gitNexusNodeMeta">{row.name}</td>
                    <td>{row.kind ?? ''}</td>
                    <td>{row.file ?? ''}</td>
                    <td>{row.line ?? ''}</td>
                    <td>{row.score ?? row.confidence ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
