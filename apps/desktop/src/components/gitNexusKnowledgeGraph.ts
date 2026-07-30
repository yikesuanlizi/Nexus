import type { ForceGraphData, ForceGraphEdge, ForceGraphNode } from './GitNexusForceGraph.js';

export type GitNexusGraphLodLevel = 'cluster' | 'summary' | 'file' | 'symbol';

export interface GitNexusKnowledgeNode extends ForceGraphNode {
  clusterId: string;
  weight: number;
  nodeType: 'file' | 'symbol' | 'finding';
  inDegree: number;
  outDegree: number;
}

export interface GitNexusKnowledgeCluster {
  id: string;
  label: string;
  count: number;
  weight: number;
}

export interface GitNexusKnowledgeGraph {
  nodes: GitNexusKnowledgeNode[];
  edges: ForceGraphEdge[];
  clusters: GitNexusKnowledgeCluster[];
}

export interface GitNexusGraphLod {
  level: GitNexusGraphLodLevel;
  visibleNodes: GitNexusKnowledgeNode[];
  visibleClusters: GitNexusKnowledgeCluster[];
  visibleEdges: ForceGraphEdge[];
}

export interface GitNexusHoverLens {
  focusNodeId: string;
  visibleNodeIds: Set<string>;
  visibleEdgeIds: Set<string>;
}

export function buildGitNexusKnowledgeGraph(data: ForceGraphData): GitNexusKnowledgeGraph {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const node of data.nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }
  for (const edge of data.edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const nodes = data.nodes.map((node): GitNexusKnowledgeNode => {
    const input = inDegree.get(node.id) ?? 0;
    const output = outDegree.get(node.id) ?? 0;
    return {
      ...node,
      clusterId: clusterIdForNode(node),
      nodeType: node.kind && node.kind !== 'file' ? 'symbol' : 'file',
      inDegree: input,
      outDegree: output,
      weight: Math.max(1, input + output + (node.group === 'center' ? 6 : 0)),
    };
  });

  const clusterMap = new Map<string, GitNexusKnowledgeCluster>();
  for (const node of nodes) {
    const current = clusterMap.get(node.clusterId) ?? {
      id: node.clusterId,
      label: node.clusterId,
      count: 0,
      weight: 0,
    };
    current.count += 1;
    current.weight += node.weight;
    clusterMap.set(node.clusterId, current);
  }

  return {
    nodes,
    edges: data.edges,
    clusters: [...clusterMap.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
  };
}

export function computeGitNexusGraphLod(graph: GitNexusKnowledgeGraph, scale: number): GitNexusGraphLod {
  const level: GitNexusGraphLodLevel = scale < 0.8 ? 'cluster' : scale < 1.35 ? 'summary' : scale < 2.6 ? 'file' : 'symbol';
  const maxNodes = level === 'cluster' ? 0 : level === 'summary' ? 24 : level === 'file' ? 120 : 260;
  const visibleNodes = maxNodes === 0
    ? []
    : [...graph.nodes].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)).slice(0, maxNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return {
    level,
    visibleNodes,
    visibleClusters: graph.clusters,
    visibleEdges,
  };
}

export function computeHoverLens(graph: GitNexusKnowledgeGraph, focusNodeId: string): GitNexusHoverLens {
  const visibleNodeIds = new Set<string>([focusNodeId]);
  const visibleEdgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === focusNodeId || edge.target === focusNodeId) {
      visibleEdgeIds.add(edge.id);
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    }
  }
  return { focusNodeId, visibleNodeIds, visibleEdgeIds };
}

function clusterIdForNode(node: ForceGraphNode): string {
  const path = (node.file ?? '').replace(/\\/g, '/');
  if (path.startsWith('apps/web/')) return 'apps/web';
  if (path.startsWith('apps/desktop/')) return 'apps/desktop';
  if (path.startsWith('apps/api/')) return 'apps/api';
  if (path.startsWith('packages/')) {
    const parts = path.split('/');
    return parts.length >= 2 ? `packages/${parts[1]}` : 'packages';
  }
  if (path.startsWith('docs/')) return 'docs';
  if (path.includes('/test') || path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return 'tests';
  return node.group || '其他';
}
