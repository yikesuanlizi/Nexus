import React, { useMemo, useState } from 'react';
import type { Locale } from '../config/config.js';
import { Icon } from './Icon.js';
import { GitNexusForceGraph } from './GitNexusForceGraph.js';
import type { ForceGraphData, ForceGraphLevel } from './GitNexusForceGraph.js';
import { GitNexusGraphModal } from './GitNexusGraphModal.js';
import type { GitNexusGraphData } from './gitNexusResult.js';
import {
  getGitNexusNodeRelations,
  type NodeRelation,
} from './gitNexusFlowLayout.js';

export function GitNexusResultView({ data, locale }: { data: GitNexusGraphData; locale: Locale }): React.ReactElement {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedNode = selectedNodeId ? data.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedRelations = selectedNode ? getGitNexusNodeRelations(data, selectedNode.id) : null;

  const forceGraphData: ForceGraphData = useMemo(() => {
    const nodes = data.nodes.map((node) => {
      const graphNode = {
        id: node.id,
        label: node.label,
        group: node.group ?? node.kind ?? 'default',
      };
      return {
        ...graphNode,
        ...(node.file ? { file: node.file } : {}),
        ...(node.kind ? { kind: node.kind } : {}),
      };
    });
    const edges = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label ? { label: edge.label } : {}),
    }));
    return { nodes, edges };
  }, [data.edges, data.nodes]);

  const graphLevel: ForceGraphLevel = useMemo(() => (
    data.nodes.some((node) => {
      const kind = (node.kind ?? node.group ?? '').toLowerCase();
      return kind === 'file' || Boolean(node.file);
    }) ? 'file' : 'symbol'
  ), [data.nodes]);

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

  const renderGraph = () => (
    <div className="gitNexusGraph gitNexusGraph--force">
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
      <GitNexusForceGraph
        data={forceGraphData}
        height={360}
        level={graphLevel}
        onNodeClick={(node) => setSelectedNodeId(node.id)}
      />
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
          {renderGraph()}
          <GitNexusGraphModal
            isOpen={previewOpen}
            onClose={() => setPreviewOpen(false)}
            data={forceGraphData}
            level={graphLevel}
            title={data.title}
            onNodeClick={(node) => setSelectedNodeId(node.id)}
          />
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
