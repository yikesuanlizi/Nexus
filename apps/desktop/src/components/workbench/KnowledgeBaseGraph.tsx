import { useMemo, useState } from 'react';
import type { Locale } from '../../config/config.js';
import type { KnowledgeWikiGraph, KnowledgeWikiGraphNode } from '../../api/knowledgeClient.js';
import { Icon } from '../Icon.js';

const GRAPH_WIDTH = 760;
const GRAPH_HEIGHT = 410;

interface PositionedNode {
  node: KnowledgeWikiGraphNode;
  x: number;
  y: number;
  degree: number;
}

interface GraphLayout {
  nodes: PositionedNode[];
  edges: Array<{ source: PositionedNode; target: PositionedNode }>;
}

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function createLayout(graph: KnowledgeWikiGraph): GraphLayout {
  const nodes = graph.nodes ?? [];
  const padding = 34;
  const byId = new Map<string, PositionedNode>();
  const positioned = nodes.map((node, index) => {
    const angle = stableSeed(node.pageId) * Math.PI * 2;
    const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * (0.18 + ((index % 5) / 5) * 0.12);
    const item: PositionedNode = {
      node,
      x: GRAPH_WIDTH / 2 + Math.cos(angle) * radius,
      y: GRAPH_HEIGHT / 2 + Math.sin(angle) * radius,
      degree: 0,
    };
    byId.set(node.pageId, item);
    return item;
  });

  const links = (graph.edges ?? [])
    .filter((edge) => edge.resolved && edge.targetPageId)
    .map((edge) => {
      const source = byId.get(edge.sourcePageId);
      const target = byId.get(edge.targetPageId!);
      return source && target && source !== target ? { source, target } : null;
    })
    .filter((link): link is { source: PositionedNode; target: PositionedNode } => Boolean(link));

  for (const link of links) {
    link.source.degree += 1;
    link.target.degree += 1;
  }

  const uniqueLinks = [...new Map(links.map((link) => [`${link.source.node.pageId}:${link.target.node.pageId}`, link])).values()];
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const forces = positioned.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < positioned.length; left += 1) {
      for (let right = left + 1; right < positioned.length; right += 1) {
        const a = positioned[left]!;
        const b = positioned[right]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(18, Math.hypot(dx, dy));
        const force = 4200 / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces[left]!.x -= fx;
        forces[left]!.y -= fy;
        forces[right]!.x += fx;
        forces[right]!.y += fy;
      }
    }
    for (const link of uniqueLinks) {
      const sourceIndex = positioned.indexOf(link.source);
      const targetIndex = positioned.indexOf(link.target);
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 112) * 0.012;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      forces[sourceIndex]!.x += fx;
      forces[sourceIndex]!.y += fy;
      forces[targetIndex]!.x -= fx;
      forces[targetIndex]!.y -= fy;
    }
    for (let index = 0; index < positioned.length; index += 1) {
      const item = positioned[index]!;
      const force = forces[index]!;
      item.x = Math.max(padding, Math.min(GRAPH_WIDTH - padding, item.x + force.x + (GRAPH_WIDTH / 2 - item.x) * 0.006));
      item.y = Math.max(padding, Math.min(GRAPH_HEIGHT - padding, item.y + force.y + (GRAPH_HEIGHT / 2 - item.y) * 0.006));
    }
  }

  return { nodes: positioned, edges: uniqueLinks };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function KnowledgeBaseGraph({
  locale,
  graph,
  onNodeClick,
}: {
  locale: Locale;
  graph: KnowledgeWikiGraph | null | undefined;
  onNodeClick?: (node: KnowledgeWikiGraphNode) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const layout = useMemo(() => createLayout(graph ?? { nodes: [], edges: [] }), [graph]);
  const selected = layout.nodes.find((item) => item.node.pageId === (selectedId ?? hoveredId))?.node ?? null;

  if (!layout.nodes.length) {
    return (
      <div className="knowledgeGraphEmpty">
        <Icon name="workflow" />
        <span>{locale === 'zh' ? '当前快照没有可展示的页面关系。' : 'This snapshot has no page relationships to display.'}</span>
      </div>
    );
  }

  return (
    <div className="knowledgeBaseGraph">
      <div className="knowledgeGraphMeta">
        <span>{layout.nodes.length} {locale === 'zh' ? '个页面' : 'pages'}</span>
        <span>{layout.edges.length} {locale === 'zh' ? '条已解析链接' : 'resolved links'}</span>
        {(graph?.edges.filter((edge) => !edge.resolved).length ?? 0) > 0 ? <span>{graph?.edges.filter((edge) => !edge.resolved).length} {locale === 'zh' ? '条未解析' : 'unresolved'}</span> : null}
      </div>
      <div className="knowledgeGraphCanvas" role="img" aria-label={locale === 'zh' ? '知识库页面链接力导向图' : 'Knowledge base page link force graph'}>
        <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="knowledge-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0 0L8 4L0 8Z" />
            </marker>
          </defs>
          <g className="knowledgeGraphEdges">
            {layout.edges.map((edge) => (
              <line
                key={`${edge.source.node.pageId}:${edge.target.node.pageId}`}
                x1={edge.source.x}
                y1={edge.source.y}
                x2={edge.target.x}
                y2={edge.target.y}
                markerEnd="url(#knowledge-graph-arrow)"
              />
            ))}
          </g>
          <g className="knowledgeGraphNodes">
            {layout.nodes.map((item) => {
              const isActive = item.node.pageId === hoveredId || item.node.pageId === selectedId;
              const radius = Math.min(18, 8 + Math.sqrt(item.degree) * 2.3);
              return (
                <g
                  className={isActive ? 'is-active' : undefined}
                  key={item.node.pageId}
                  transform={`translate(${item.x} ${item.y})`}
                  onMouseEnter={() => setHoveredId(item.node.pageId)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => { setSelectedId(item.node.pageId); onNodeClick?.(item.node); }}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.node.pageId); onNodeClick?.(item.node); } }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.node.title} · ${item.node.relativePath}`}
                >
                  <circle r={radius} />
                  <text y={radius + 15}>{truncate(item.node.title || item.node.slug, 24)}</text>
                </g>
              );
            })}
          </g>
        </svg>
        {selected ? <div className="knowledgeGraphSelection"><strong>{selected.title || selected.slug}</strong><span>{selected.relativePath}</span></div> : null}
      </div>
    </div>
  );
}

export { createLayout as createKnowledgeGraphLayout };
