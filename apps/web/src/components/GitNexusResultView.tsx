import type React from 'react';
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
import type { GitNexusGraphData, GitNexusNode, GitNexusEdge, GitNexusRow } from './gitNexusResult.js';

// 根据 group 分区域布局的简单固定布局（不依赖 dagre）：
// - center 居中
// - caller / upstream / route / changed 左列纵向
// - callee / downstream / consumer / affected 右列纵向
// - process 下方纵向
// - handler 上方纵向
// - 默认（含 trace 步骤）水平链路
function computePosition(node: GitNexusNode, index: number): { x: number; y: number } {
  switch (node.group) {
    case 'center':
      return { x: 400, y: 200 };
    case 'caller':
    case 'upstream':
    case 'route':
    case 'changed':
      return { x: 100, y: 100 + index * 60 };
    case 'callee':
    case 'downstream':
    case 'consumer':
    case 'affected':
      return { x: 700, y: 100 + index * 60 };
    case 'process':
      return { x: 400, y: 400 + index * 60 };
    case 'handler':
      return { x: 400, y: 100 + index * 60 };
    default:
      // 默认或 trace 的步骤：水平链路
      return { x: 100 + index * 180, y: 200 };
  }
}

export function GitNexusResultView({ data, locale }: { data: GitNexusGraphData; locale: Locale }): React.ReactElement {
  // 按 group 分组并按顺序累加 index，用于同组节点纵向错位
  const groupIndex = new Map<string, number>();
  const nodes: Node[] = data.nodes.map((n) => {
    const group = n.group ?? 'default';
    const index = groupIndex.get(group) ?? 0;
    groupIndex.set(group, index + 1);
    return {
      id: n.id,
      data: { label: <div className="gitNexusNodeLabel">{n.label}</div> },
      position: computePosition(n, index),
      className: `gitNexusNode gitNexusNode-${n.group ?? 'default'}`,
    };
  });

  const edges: Edge[] = data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: false,
  }));

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
        <div className="gitNexusGraph">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
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
