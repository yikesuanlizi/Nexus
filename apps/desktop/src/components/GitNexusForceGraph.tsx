import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
}

interface LayoutEdge {
  source: LayoutNode;
  target: LayoutNode;
  weight: number;
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
    layoutEdges.push({ source: src, target: tgt, weight: e.weight ?? 1 });
  }

  return { nodes: Array.from(nodeMap.values()), edges: layoutEdges, lanes, width: worldWidth, height: worldHeight };
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
  const layoutRef = useRef<GraphLayout | null>(null);
  const [hoverNode, setHoverNode] = useState<LayoutNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height });

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const computeLayout = useCallback(() => {
    const result = computeDagLayout(data.nodes, data.edges, Math.max(dimensions.width, 200), Math.max(height, 200));
    const scale = Math.min(
      1,
      dimensions.width > 0 ? (dimensions.width * 0.92) / result.width : 1,
      height > 0 ? (height * 0.92) / result.height : 1,
    );
    transformRef.current = {
      x: (dimensions.width - result.width * scale) / 2,
      y: (height - result.height * scale) / 2,
      scale,
    };
    layoutRef.current = result;
  }, [data, dimensions, height]);

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
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    for (const edge of layout.edges) {
      const src = edge.source;
      const tgt = edge.target;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nodeR = 6;
      const startX = src.x + (dx / dist) * nodeR;
      const startY = src.y + (dy / dist) * nodeR;
      const endX = tgt.x - (dx / dist) * (nodeR + 4);
      const endY = tgt.y - (dy / dist) * (nodeR + 4);

      const midX = (startX + endX) / 2;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
      ctx.stroke();

      const angle = Math.atan2(endY - startY, endX - startX);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - 6 * Math.cos(angle - Math.PI / 6), endY - 6 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(endX - 6 * Math.cos(angle + Math.PI / 6), endY - 6 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    for (const node of layout.nodes) {
      const color = getGroupColor(node.group);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoverNode) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hoverNode.x, hoverNode.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1;

      const lines: string[] = [];
      lines.push(hoverNode.label);
      if (hoverNode.file && hoverNode.file !== hoverNode.label) {
        lines.push(hoverNode.file);
      }
      if (hoverNode.group) {
        lines.push(`分组: ${hoverNode.group}`);
      }
      if (hoverNode.kind) {
        lines.push(`类型: ${hoverNode.kind}`);
      }

      const padding = 10;
      const lineHeight = 18;
      const tooltipMaxWidth = (width / transform.scale) * 0.7;
      let maxTextW = 0;
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      for (const line of lines) {
        maxTextW = Math.min(tooltipMaxWidth - padding * 2, Math.max(maxTextW, ctx.measureText(line).width));
      }
      const boxW = maxTextW + padding * 2;
      const boxH = lines.length * lineHeight + padding;
      let boxX = hoverNode.x + 15;
      let boxY = hoverNode.y - boxH / 2;
      if (boxX + boxW > width / transform.scale) boxX = hoverNode.x - boxW - 15;
      if (boxY < 0) boxY = 0;
      if (boxY + boxH > height / transform.scale) boxY = height / transform.scale - boxH;

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f1f5f9';
      ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          ctx.font = '600 12px system-ui, -apple-system, sans-serif';
        } else {
          ctx.font = '11px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
        }
        let displayLine = lines[i];
        const textW = ctx.measureText(displayLine).width;
        if (textW > maxTextW) {
          const avgCharW = textW / displayLine.length;
          const maxChars = Math.floor(maxTextW / avgCharW) - 1;
          displayLine = displayLine.slice(0, Math.max(0, maxChars)) + '…';
        }
        ctx.fillText(displayLine, boxX + padding, boxY + padding / 2 + i * lineHeight);
      }
    }

    ctx.restore();

    ctx.save();
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    for (const lane of layout.lanes) {
      if (lane.count === 0) continue;
      const label = `${formatForceGraphLaneLabel(level, lane.layer, layout.lanes.length)} · ${lane.count}`;
      const sx = lane.x * transform.scale + transform.x;
      const sy = lane.y * transform.scale + transform.y;
      if (sx < -80 || sx > width + 80 || sy < -24 || sy > canvasHeight + 24) continue;
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + 18;
      const boxH = 24;
      const boxX = Math.max(8, Math.min(width - boxW - 8, sx - boxW / 2));
      const boxY = Math.max(8, sy - boxH / 2);
      ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#334155';
      ctx.fillText(label, boxX + 9, boxY + boxH / 2);
    }
    ctx.restore();
  }, [height, hoverNode, level]);

  useEffect(() => {
    computeLayout();
    draw();
  }, [computeLayout]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height });
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
    draw();
  }, [eventToCanvasPoint, screenToWorld, draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNodeClick) return;
    const point = eventToCanvasPoint(e);
    if (!point) return;
    const sx = point.x;
    const sy = point.y;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const node = findNodeAt(wx, wy);
    if (node) onNodeClick(node);
  }, [eventToCanvasPoint, screenToWorld, findNodeAt, onNodeClick]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data.nodes) {
      counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.nodes]);

  return (
    <div className="gitNexusForceGraph">
      <div className="gitNexusForceGraphLegend">
        <span className="gitNexusForceGraphStat">
          {data.nodes.length} 节点 / {data.edges.length} 边
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
          onMouseLeave={handleMouseUp}
          {...(disableZoom ? {} : { onWheel: handleWheel })}
          onClick={handleClick}
        />
      </div>
    </div>
  );
}
