import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildGitNexusKnowledgeGraph,
  computeHoverLens,
  type GitNexusKnowledgeGraph,
} from './gitNexusKnowledgeGraph.js';

export interface ForceGraphNode {
  id: string;
  label: string;
  group: string;
  file?: string;
  kind?: string;
}

export interface ForceGraphEdge {
  id: string;
  source: string;
  target: string;
  weight?: number;
  label?: string;
  type?: string;
  kind?: string;
  relation?: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  edges: ForceGraphEdge[];
}

interface LayoutNode extends ForceGraphNode {
  x: number;
  y: number;
  layer: number;
  inDegree: number;
  outDegree: number;
  clusterId?: string;
  weight?: number;
  nodeType?: 'file' | 'symbol' | 'finding';
  radius?: number;
}

interface LayoutEdge {
  id: string;
  source: LayoutNode;
  target: LayoutNode;
  weight: number;
  label?: string;
}

interface LayoutLane {
  x: number;
  y: number;
  layer: number;
  count: number;
}

interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  lanes: LayoutLane[];
  width: number;
  height: number;
}

export interface MapGraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  graph: GitNexusKnowledgeGraph;
  width: number;
  height: number;
}

export interface GraphViewportTransform {
  x: number;
  y: number;
  scale: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type ForceGraphLevel = 'file' | 'symbol';

export function findNearestGraphNode<T extends { x: number; y: number }>(
  nodes: T[],
  wx: number,
  wy: number,
  radius: number,
): T | null {
  const maxDistSq = radius * radius;
  let best: T | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const dx = node.x - wx;
    const dy = node.y - wy;
    const distSq = dx * dx + dy * dy;
    if (distSq <= maxDistSq && distSq < bestDistSq) {
      best = node;
      bestDistSq = distSq;
    }
  }
  return best;
}

const GROUP_COLORS: Record<string, string> = {
  class: '#0284c7',
  interface: '#0891b2',
  method: '#0d9488',
  function: '#059669',
  variable: '#d97706',
  file: '#4f46e5',
  default: '#64748b',
};

function getGroupColor(group: string): string {
  const key = group.toLowerCase();
  if (GROUP_COLORS[key]) return GROUP_COLORS[key];
  let hash = 0;
  for (let i = 0; i < group.length; i++) {
    hash = ((hash << 5) - hash + group.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

const LAYOUT_PADDING = 56;
const LAYER_GAP = 280;
const MIN_LAYER_WIDTH = 220;
const LANE_GAP = 56;
const ROW_GAP = 38;

export function formatForceGraphLaneLabel(level: ForceGraphLevel, index: number, total: number): string {
  const last = Math.max(0, total - 1);
  if (level === 'symbol') {
    if (index === 0) return '调用入口';
    if (index === last) return '调用末端';
    return `调用层 ${index}`;
  }
  if (index === 0) return '上游文件';
  if (index === last) return '底层依赖';
  return `依赖层 ${index}`;
}

export function formatForceGraphEdgeLabel(edge: ForceGraphEdge): string | null {
  const raw = edge.label ?? edge.type ?? edge.kind ?? edge.relation;
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

function compareNodeIds(nodeMap: Map<string, LayoutNode>, a: string, b: string): number {
  const na = nodeMap.get(a);
  const nb = nodeMap.get(b);
  if (!na || !nb) return 0;
  return na.group.localeCompare(nb.group) || na.label.localeCompare(nb.label) || na.id.localeCompare(nb.id);
}

export function computeDagLayout(
  nodes: ForceGraphNode[],
  edges: ForceGraphEdge[],
  width: number,
  height: number,
): GraphLayout {
  const nodeMap = new Map<string, LayoutNode>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const n of nodes) {
    nodeMap.set(n.id, { ...n, x: 0, y: 0, layer: 0, inDegree: 0, outDegree: 0 });
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
    adjList.set(n.id, []);
  }

  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    adjList.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }

  const originalInDegree = new Map(inDegree);
  const originalOutDegree = new Map(outDegree);
  const layerMap = new Map<string, number>();
  const queue: string[] = [];
  const queued = new Set<string>();

  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layerMap.set(n.id, 0);
      queue.push(n.id);
      queued.add(n.id);
    }
  }

  if (queue.length === 0) {
    for (const n of nodes) {
      layerMap.set(n.id, 0);
      queue.push(n.id);
      queued.add(n.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layerMap.get(id) ?? 0;
    for (const next of adjList.get(id) ?? []) {
      const prevMax = layerMap.get(next) ?? 0;
      layerMap.set(next, Math.max(prevMax, currentLayer + 1));
      const remainingIn = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remainingIn);
      if (remainingIn <= 0 && !queued.has(next)) {
        queue.push(next);
        queued.add(next);
      }
    }
  }

  const resolvedMaxLayer = Math.max(...Array.from(layerMap.values()), 0);
  for (const n of nodes) {
    if (!layerMap.has(n.id)) {
      const fallbackLayer = (originalOutDegree.get(n.id) ?? 0) === 0
        ? resolvedMaxLayer + 1
        : Math.max(0, Math.floor(resolvedMaxLayer / 2));
      layerMap.set(n.id, fallbackLayer);
    }
  }

  const maxLayer = Math.max(...Array.from(layerMap.values()), 0);
  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) layers.push([]);
  for (const [id, layer] of layerMap) {
    if (layer >= 0 && layer <= maxLayer) {
      layers[layer].push(id);
    }
  }

  const layerPlans = layers.map((layerNodes) => {
    layerNodes.sort((a, b) => compareNodeIds(nodeMap, a, b));
    const count = layerNodes.length;
    const rowsPerColumn = count > 0 ? Math.max(1, Math.ceil(Math.sqrt(count * 1.4))) : 1;
    const columns = count > 0 ? Math.ceil(count / rowsPerColumn) : 1;
    const planWidth = Math.max(MIN_LAYER_WIDTH, (columns - 1) * LANE_GAP + 160);
    const planHeight = Math.max(ROW_GAP, rowsPerColumn * ROW_GAP);
    return { ids: layerNodes, rowsPerColumn, columns, width: planWidth, height: planHeight };
  });

  const worldWidth = Math.max(
    width,
    LAYOUT_PADDING * 2
      + layerPlans.reduce((sum, plan) => sum + plan.width, 0)
      + Math.max(0, layerPlans.length - 1) * LAYER_GAP,
  );
  const worldHeight = Math.max(
    height,
    LAYOUT_PADDING * 2 + Math.max(...layerPlans.map((plan) => plan.height), ROW_GAP),
  );

  let layerLeft = LAYOUT_PADDING;
  const lanes: LayoutLane[] = [];
  for (let l = 0; l < layerPlans.length; l++) {
    const plan = layerPlans[l];
    const layerCenterX = layerLeft + plan.width / 2;
    const layerTop = (worldHeight - plan.height) / 2 + ROW_GAP / 2;
    lanes.push({ x: layerCenterX, y: LAYOUT_PADDING * 0.55, layer: l, count: plan.ids.length });

    for (let i = 0; i < plan.ids.length; i++) {
      const node = nodeMap.get(plan.ids[i]);
      if (!node) continue;
      const col = Math.floor(i / plan.rowsPerColumn);
      const row = i % plan.rowsPerColumn;
      node.x = layerCenterX + (col - (plan.columns - 1) / 2) * LANE_GAP;
      node.y = layerTop + row * ROW_GAP;
      node.layer = l;
      node.inDegree = originalInDegree.get(node.id) ?? 0;
      node.outDegree = originalOutDegree.get(node.id) ?? 0;
    }
    layerLeft += plan.width + LAYER_GAP;
  }

  const layoutEdges: LayoutEdge[] = [];
  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    layoutEdges.push({ id: e.id, source: src, target: tgt, weight: e.weight ?? 1 });
  }

  return { nodes: Array.from(nodeMap.values()), edges: layoutEdges, lanes, width: worldWidth, height: worldHeight };
}

export function computeGitNexusMapLayout(
  data: ForceGraphData,
  width: number,
  height: number,
  _scale = 1,
): MapGraphLayout {
  const graph = buildGitNexusKnowledgeGraph(data);
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    return b.weight - a.weight
      || a.clusterId.localeCompare(b.clusterId)
      || a.label.localeCompare(b.label)
      || a.id.localeCompare(b.id);
  });
  const nodeCount = Math.max(1, sortedNodes.length);
  const worldWidth = Math.max(width, 860, Math.ceil(Math.sqrt(nodeCount)) * 112 + LAYOUT_PADDING * 2);
  const worldHeight = Math.max(height, 620, Math.ceil(Math.sqrt(nodeCount)) * 86 + LAYOUT_PADDING * 2);
  const centerX = worldWidth / 2;
  const centerY = worldHeight / 2;
  const maxWeight = Math.max(...sortedNodes.map((node) => node.weight), 1);
  const clusterAnchors = computeClusterAnchors(graph.clusters.map((cluster) => cluster.id), centerX, centerY, worldWidth, worldHeight);
  const nodes = sortedNodes.map((node, index): LayoutNode => {
    const centrality = node.weight / maxWeight;
    const angle = stableAngle(node.id);
    const rank = sortedNodes.length <= 1 ? 0 : index / (sortedNodes.length - 1);
    const orbit = Math.max(36, Math.sqrt(rank) * Math.min(worldWidth, worldHeight) * 0.42);
    const anchor = clusterAnchors.get(node.clusterId) ?? { x: centerX, y: centerY };
    const clusterBlend = Math.min(0.42, Math.max(0.12, 1 - centrality) * 0.36);
    const baseX = centerX + Math.cos(angle) * orbit;
    const baseY = centerY + Math.sin(angle) * orbit;
    return {
      ...node,
      x: baseX * (1 - clusterBlend) + anchor.x * clusterBlend,
      y: baseY * (1 - clusterBlend) + anchor.y * clusterBlend,
      layer: 0,
      radius: Math.max(10, Math.min(34, 8 + Math.sqrt(node.weight) * 3.6)),
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: LayoutEdge[] = graph.edges.flatMap((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const label = formatForceGraphEdgeLabel(edge);
    return source && target ? [{ id: edge.id, source, target, weight: edge.weight ?? 1, ...(label ? { label } : {}) }] : [];
  });
  relaxRadialGraph(nodes, edges, worldWidth, worldHeight);
  return {
    nodes,
    edges,
    graph,
    width: worldWidth,
    height: worldHeight,
  };
}

export function computeGraphViewportTransform(
  layout: Pick<MapGraphLayout, 'nodes' | 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  targetFill = 0.9,
): GraphViewportTransform {
  if (layout.nodes.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      x: 0,
      y: 0,
      scale: 1,
      bounds: { x: 0, y: 0, width: layout.width, height: layout.height },
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of layout.nodes) {
    const radius = (node.radius ?? 10) + 34;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }

  const bounds = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
  const safeFill = Math.max(0.42, Math.min(0.94, targetFill));
  const fitScale = Math.min(
    (viewportWidth * safeFill) / bounds.width,
    (viewportHeight * safeFill) / bounds.height,
  );
  const scale = Math.max(0.18, Math.min(3.2, fitScale));
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;
  return {
    x: viewportWidth / 2 - boundsCenterX * scale,
    y: viewportHeight / 2 - boundsCenterY * scale,
    scale,
    bounds,
  };
}

function computeClusterAnchors(
  clusterIds: string[],
  centerX: number,
  centerY: number,
  worldWidth: number,
  worldHeight: number,
): Map<string, { x: number; y: number }> {
  const anchors = new Map<string, { x: number; y: number }>();
  const radiusX = Math.max(180, worldWidth * 0.26);
  const radiusY = Math.max(130, worldHeight * 0.22);
  const ids = clusterIds.length > 0 ? clusterIds : ['root'];
  ids.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, ids.length)) * Math.PI * 2;
    anchors.set(id, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  });
  return anchors;
}

function relaxRadialGraph(nodes: LayoutNode[], edges: LayoutEdge[], worldWidth: number, worldHeight: number): void {
  if (nodes.length <= 1) {
    if (nodes[0]) {
      nodes[0].x = worldWidth / 2;
      nodes[0].y = worldHeight / 2;
    }
    return;
  }

  const centerX = worldWidth / 2;
  const centerY = worldHeight / 2;
  const maxWeight = Math.max(...nodes.map((node) => node.weight ?? 1), 1);
  const hub = nodes.reduce((best, node) => ((node.weight ?? 1) > (best.weight ?? 1) ? node : best), nodes[0]);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const iterations = nodes.length > 360 ? 82 : 128;
  const ideal = Math.sqrt((worldWidth * worldHeight) / nodes.length);
  const repulsion = ideal * ideal * 0.42;
  const margin = LAYOUT_PADDING * 0.75;

  for (let step = 0; step < iterations; step++) {
    const progress = step / iterations;
    const maxStep = 18 * (1 - progress) + 2.2;
    const dx = new Array(nodes.length).fill(0);
    const dy = new Array(nodes.length).fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let vx = a.x - b.x;
        let vy = a.y - b.y;
        let distSq = vx * vx + vy * vy;
        if (distSq < 0.01) {
          const angle = stableAngle(`${a.id}:${b.id}`);
          vx = Math.cos(angle);
          vy = Math.sin(angle);
          distSq = 1;
        }
        const dist = Math.sqrt(distSq);
        const force = Math.min(26, repulsion / distSq);
        const fx = (vx / dist) * force;
        const fy = (vy / dist) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }

    for (const edge of edges) {
      const sourceIndex = indexById.get(edge.source.id);
      const targetIndex = indexById.get(edge.target.id);
      if (sourceIndex == null || targetIndex == null) continue;
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      const vx = target.x - source.x;
      const vy = target.y - source.y;
      const dist = Math.sqrt(vx * vx + vy * vy) || 1;
      const desired = 116 + Math.max(0, 5 - Math.min(edge.weight, 5)) * 8;
      const force = (dist - desired) * 0.036 * Math.min(2.2, Math.max(0.7, edge.weight));
      const fx = (vx / dist) * force;
      const fy = (vy / dist) * force;
      dx[sourceIndex] += fx;
      dy[sourceIndex] += fy;
      dx[targetIndex] -= fx;
      dy[targetIndex] -= fy;
    }

    nodes.forEach((node, index) => {
      const centrality = (node.weight ?? 1) / maxWeight;
      const centerPull = node.id === hub.id ? 0.18 : 0.012 + centrality * 0.038;
      dx[index] += (centerX - node.x) * centerPull;
      dy[index] += (centerY - node.y) * centerPull;
    });

    for (let i = 0; i < nodes.length; i++) {
      const distance = Math.hypot(dx[i], dy[i]) || 1;
      const stepSize = Math.min(maxStep, distance);
      nodes[i].x += (dx[i] / distance) * stepSize;
      nodes[i].y += (dy[i] / distance) * stepSize;
      nodes[i].x = Math.max(margin, Math.min(worldWidth - margin, nodes[i].x));
      nodes[i].y = Math.max(margin, Math.min(worldHeight - margin, nodes[i].y));
    }
  }

  for (let pass = 0; pass < 32; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let vx = b.x - a.x;
        let vy = b.y - a.y;
        let dist = Math.sqrt(vx * vx + vy * vy);
        if (dist < 0.01) {
          const angle = stableAngle(`${a.id}:${b.id}:collision`);
          vx = Math.cos(angle);
          vy = Math.sin(angle);
          dist = 1;
        }
        const minDist = (a.radius ?? 10) + (b.radius ?? 10) + 20;
        if (dist >= minDist) continue;
        const shift = (minDist - dist) / 2;
        const axWeight = (a.weight ?? 1) >= (b.weight ?? 1) ? 0.35 : 0.65;
        const bxWeight = 1 - axWeight;
        const ux = vx / dist;
        const uy = vy / dist;
        a.x -= ux * shift * axWeight;
        a.y -= uy * shift * axWeight;
        b.x += ux * shift * bxWeight;
        b.y += uy * shift * bxWeight;
      }
    }
  }

  if (edges.length > 0) {
    hub.x += (centerX - hub.x) * 0.62;
    hub.y += (centerY - hub.y) * 0.62;
  }
  for (const node of nodes) {
    node.x = Math.max(margin, Math.min(worldWidth - margin, node.x));
    node.y = Math.max(margin, Math.min(worldHeight - margin, node.y));
  }
}

function stableAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return ((Math.abs(hash) % 360) / 360) * Math.PI * 2;
}

function trimGraphLabel(label: string, maxLength = 28): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(1, maxLength - 1))}…` : label;
}

export function GitNexusForceGraph({
  data,
  onNodeClick,
  height = 500,
  disableZoom = false,
  level = 'file',
}: {
  data: ForceGraphData;
  onNodeClick?: (node: ForceGraphNode) => void;
  height?: number;
  disableZoom?: boolean;
  level?: ForceGraphLevel;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<MapGraphLayout | null>(null);
  const [hoverNode, setHoverNode] = useState<LayoutNode | null>(null);
  const [pinnedNode, setPinnedNode] = useState<LayoutNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height });

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);

  const computeLayout = useCallback(() => {
    const viewportWidth = Math.max(dimensions.width, 200);
    const viewportHeight = Math.max(dimensions.height, 200);
    const result = computeGitNexusMapLayout(
      data,
      viewportWidth,
      viewportHeight,
      transformRef.current.scale,
    );
    transformRef.current = computeGraphViewportTransform(result, dimensions.width, dimensions.height);
    layoutRef.current = result;
  }, [data, dimensions]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const transform = transformRef.current;
    const width = canvas.width;
    const canvasHeight = canvas.height;

    ctx.clearRect(0, 0, width, canvasHeight);
    const background = ctx.createLinearGradient(0, 0, width, canvasHeight);
    background.addColorStop(0, '#f8fafc');
    background.addColorStop(0.56, '#eef6ff');
    background.addColorStop(1, '#f8fafc');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, canvasHeight);

    const focusNode = pinnedNode ?? hoverNode;
    const lens = focusNode ? computeHoverLens(layout.graph, focusNode.id) : null;
    const now = performance.now();

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    for (const edge of layout.edges) {
      const src = edge.source;
      const tgt = edge.target;
      const focused = lens ? lens.visibleNodeIds.has(src.id) && lens.visibleNodeIds.has(tgt.id) : false;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nodeR = 5;
      const startX = src.x + (dx / dist) * nodeR;
      const startY = src.y + (dy / dist) * nodeR;
      const endX = tgt.x - (dx / dist) * (nodeR + 4);
      const endY = tgt.y - (dy / dist) * (nodeR + 4);

      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      ctx.strokeStyle = focused ? 'rgba(245, 158, 11, 0.72)' : 'rgba(100, 116, 139, 0.34)';
      ctx.lineWidth = focused ? 2.2 : Math.max(0.85, Math.min(1.6, edge.weight * 0.55));
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
      ctx.stroke();

      const arrowAngle = Math.atan2(endY - midY, endX - midX);
      ctx.fillStyle = focused ? 'rgba(245, 158, 11, 0.8)' : 'rgba(100, 116, 139, 0.42)';
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - 7 * Math.cos(arrowAngle - Math.PI / 6), endY - 7 * Math.sin(arrowAngle - Math.PI / 6));
      ctx.lineTo(endX - 7 * Math.cos(arrowAngle + Math.PI / 6), endY - 7 * Math.sin(arrowAngle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();

      if (edge.label && (focused || layout.edges.length <= 160 || edge.weight >= 3)) {
        const label = trimGraphLabel(edge.label, 12);
        ctx.save();
        ctx.translate(midX, midY);
        const labelAngle = Math.abs(arrowAngle) > Math.PI / 2 ? arrowAngle + Math.PI : arrowAngle;
        ctx.rotate(labelAngle);
        ctx.font = `${focused ? 700 : 600} 9.5px system-ui, -apple-system, sans-serif`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = focused ? 'rgba(255, 251, 235, 0.96)' : 'rgba(248, 250, 252, 0.9)';
        ctx.strokeStyle = focused ? 'rgba(245, 158, 11, 0.5)' : 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-textWidth / 2 - 5, -8, textWidth + 10, 16, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = focused ? '#92400e' : '#475569';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    for (const node of layout.nodes) {
      const color = getGroupColor(node.group);
      const focused = lens ? lens.visibleNodeIds.has(node.id) : false;
      const dimmed = Boolean(lens && !focused);
      const important = (node.weight ?? 1) >= 4 || node.nodeType === 'file';
      const pulse = important ? 1 + Math.sin(now / 520 + stableAngle(node.id)) * 0.12 : 1;
      const radius = (node.radius ?? 6) * (important ? pulse : 1);
      if (important) {
        ctx.globalAlpha = dimmed ? 0.08 : focused ? 0.25 : 0.13;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = dimmed ? 0.2 : focused ? 1 : 0.9;
      ctx.shadowColor = dimmed ? 'transparent' : 'rgba(15, 23, 42, 0.2)';
      ctx.shadowBlur = dimmed ? 0 : 12;
      ctx.shadowOffsetY = dimmed ? 0 : 4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = focused ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = focused ? 2.2 : 1.2;
      ctx.stroke();
      const showLabel = focused || radius >= 13 || transform.scale > 1.25 || layout.nodes.length <= 140;
      if (showLabel && !dimmed) {
        ctx.globalAlpha = 0.96;
        ctx.fillStyle = '#ffffff';
        ctx.font = `${focused ? 700 : 650} ${Math.max(9, Math.min(13, radius * 0.45))}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(trimGraphLabel(node.label, radius >= 22 ? 9 : 6), node.x, node.y);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [hoverNode, pinnedNode]);

  useEffect(() => {
    computeLayout();
    draw();
  }, [computeLayout]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    let lastFrame = 0;
    const tick = (time: number) => {
      if (time - lastFrame > 90) {
        draw();
        lastFrame = time;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const observedWidth = Math.max(entry.contentRect.width, 200);
        const observedHeight = Math.max(entry.contentRect.height, height);
        setDimensions((current) => (
          Math.abs(current.width - observedWidth) < 1 && Math.abs(current.height - observedHeight) < 1
            ? current
            : { width: observedWidth, height: observedHeight }
        ));
      }
    });
    resizeObs.observe(el);
    return () => resizeObs.disconnect();
  }, [height]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const t = transformRef.current;
    return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
  }, []);

  const findNodeAt = useCallback((wx: number, wy: number): LayoutNode | null => {
    const layout = layoutRef.current;
    if (!layout) return null;
    const scale = Math.max(transformRef.current.scale, 0.1);
    return findNearestGraphNode(layout.nodes, wx, wy, 12 / scale);
  }, []);

  const eventToCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratioX = rect.width > 0 ? canvas.width / rect.width : 1;
    const ratioY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * ratioX,
      y: (e.clientY - rect.top) * ratioY,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = eventToCanvasPoint(e);
    if (!point) return;
    lastPosRef.current = point;
    isDraggingRef.current = true;
  }, [eventToCanvasPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = eventToCanvasPoint(e);
    if (!point) return;
    const sx = point.x;
    const sy = point.y;
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    if (isDraggingRef.current) {
      const dx = sx - lastPosRef.current.x;
      const dy = sy - lastPosRef.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      lastPosRef.current = point;
      draw();
    } else {
      const node = findNodeAt(wx, wy);
      setHoverNode(node);
      draw();
    }
  }, [eventToCanvasPoint, screenToWorld, findNodeAt, draw]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const point = eventToCanvasPoint(e);
    if (!point) return;
    const sx = point.x;
    const sy = point.y;
    const t = transformRef.current;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, t.scale * factor));
    t.x = sx - wx * newScale;
    t.y = sy - wy * newScale;
    t.scale = newScale;
    const hoveredNode = findNodeAt(wx, wy);
    if (hoveredNode) {
      setHoverNode(hoveredNode);
    }
    layoutRef.current = computeGitNexusMapLayout(
      data,
      Math.max(dimensions.width, 200),
      Math.max(height, 200),
      newScale,
    );
    draw();
  }, [data, dimensions.width, eventToCanvasPoint, height, screenToWorld, findNodeAt, draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = eventToCanvasPoint(e);
    if (!point) return;
    const sx = point.x;
    const sy = point.y;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const node = findNodeAt(wx, wy);
    setPinnedNode(node);
    if (!node) {
      setHoverNode(null);
    }
    if (node) onNodeClick?.(node);
  }, [eventToCanvasPoint, screenToWorld, findNodeAt, onNodeClick]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data.nodes) {
      counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.nodes]);

  const inspectorNode = pinnedNode ?? hoverNode;

  return (
    <div className="gitNexusForceGraph">
      <div className="gitNexusForceGraphLegend">
        <span className="gitNexusForceGraphStat">
          {data.nodes.length} 节点 / {data.edges.length} 边
        </span>
        <span className="gitNexusGraphModePill">
          {level === 'symbol' ? '符号图谱' : '代码图谱'}
        </span>
        <div className="gitNexusForceGraphGroups">
          {groupCounts.slice(0, 8).map(([group, count]) => (
            <span key={group} className="gitNexusForceGraphGroupTag">
              <span
                className="gitNexusForceGraphGroupDot"
                style={{ backgroundColor: getGroupColor(group) }}
              />
              {group}: {count}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="gitNexusForceGraphCanvasWrap" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            handleMouseUp();
            setHoverNode(null);
          }}
          {...(disableZoom ? {} : { onWheel: handleWheel })}
          onClick={handleClick}
        />
        {inspectorNode ? (
          <div className="gitNexusGraphInspector">
            <div className="gitNexusGraphInspectorEyebrow">
              {pinnedNode ? '已固定' : '悬浮'} · {inspectorNode.group}
            </div>
            <strong>{inspectorNode.label}</strong>
            {inspectorNode.file ? <span>{inspectorNode.file}</span> : null}
            <dl>
              <div><dt>入边</dt><dd>{inspectorNode.inDegree}</dd></div>
              <div><dt>出边</dt><dd>{inspectorNode.outDegree}</dd></div>
              <div><dt>区域</dt><dd>{inspectorNode.clusterId ?? inspectorNode.group}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
