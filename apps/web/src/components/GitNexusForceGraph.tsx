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

function computeDagLayout(
  nodes: ForceGraphNode[],
  edges: ForceGraphEdge[],
  width: number,
  height: number,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodeMap = new Map<string, LayoutNode>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();

  for (const n of nodes) {
    nodeMap.set(n.id, { ...n, x: 0, y: 0, layer: 0, inDegree: 0, outDegree: 0 });
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
    adjList.set(n.id, []);
    reverseAdj.set(n.id, []);
  }

  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    adjList.get(e.source)!.push(e.target);
    reverseAdj.get(e.target)!.push(e.source);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }

  const layerMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layerMap.set(n.id, 0);
      queue.push(n.id);
      visited.add(n.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layerMap.get(id) ?? 0;
    for (const next of adjList.get(id) ?? []) {
      if (visited.has(next)) continue;
      const prevMax = layerMap.get(next) ?? 0;
      const newLayer = Math.max(prevMax, currentLayer + 1);
      layerMap.set(next, newLayer);
      const remainingIn = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remainingIn);
      if (remainingIn <= 0) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  const maxLayer = Math.max(...Array.from(layerMap.values()), 0);
  for (const n of nodes) {
    if (!layerMap.has(n.id)) {
      layerMap.set(n.id, Math.floor(maxLayer / 2));
    }
  }

  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) layers.push([]);
  for (const [id, layer] of layerMap) {
    if (layer >= 0 && layer <= maxLayer) {
      layers[layer].push(id);
    }
  }

  const layerCount = layers.length;
  const layerGap = layerCount > 1 ? height / (layerCount + 1) : height / 2;
  const nodeRadius = 6;

  for (let l = 0; l < layers.length; l++) {
    const layerNodes = layers[l];
    const count = layerNodes.length;
    const y = layerGap * (l + 1);
    if (count === 0) continue;
    if (count === 1) {
      const node = nodeMap.get(layerNodes[0]);
      if (node) {
        node.x = width / 2;
        node.y = y;
        node.layer = l;
      }
      continue;
    }
    const gap = width / (count + 1);
    layerNodes.sort((a, b) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      if (!na || !nb) return 0;
      return na.group.localeCompare(nb.group) || na.label.localeCompare(nb.label);
    });
    for (let i = 0; i < layerNodes.length; i++) {
      const node = nodeMap.get(layerNodes[i]);
      if (node) {
        node.x = gap * (i + 1);
        node.y = y;
        node.layer = l;
      }
    }
  }

  const layoutEdges: LayoutEdge[] = [];
  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) continue;
    layoutEdges.push({ source: src, target: tgt, weight: e.weight ?? 1 });
  }

  return { nodes: Array.from(nodeMap.values()), edges: layoutEdges };
}

export function GitNexusForceGraph({
  data,
  onNodeClick,
  height = 500,
}: {
  data: ForceGraphData;
  onNodeClick?: (node: ForceGraphNode) => void;
  height?: number;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{ nodes: LayoutNode[]; edges: LayoutEdge[] } | null>(null);
  const [hoverNode, setHoverNode] = useState<LayoutNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height });

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const computeLayout = useCallback(() => {
    const padding = 40;
    const w = Math.max(dimensions.width - padding * 2, 200);
    const h = Math.max(height - padding * 2, 200);
    const result = computeDagLayout(data.nodes, data.edges, w, h);
    for (const n of result.nodes) {
      n.x += padding;
      n.y += padding;
    }
    layoutRef.current = result;
  }, [data, dimensions, height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const transform = transformRef.current;
    const width = dimensions.width;
    const h = dimensions.height;

    ctx.clearRect(0, 0, width, h);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    for (const edge of layout.edges) {
      const src = edge.source;
      const tgt = edge.target;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nodeR = 5;
      const startX = src.x + (dx / dist) * nodeR;
      const startY = src.y + (dy / dist) * nodeR;
      const endX = tgt.x - (dx / dist) * (nodeR + 4);
      const endY = tgt.y - (dy / dist) * (nodeR + 4);

      const midY = (startY + endY) / 2;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(startX, midY, endX, midY, endX, endY);
      ctx.stroke();

      const angle = Math.atan2(endY - midY, endX - (endX - startX) * 0.1);
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
      ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
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
      const label = hoverNode.label;
      const padding = 8;
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + padding * 2;
      const boxH = 24;
      let boxX = hoverNode.x + 15;
      let boxY = hoverNode.y - boxH / 2;
      if (boxX + boxW > width / transform.scale) boxX = hoverNode.x - boxW - 15;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, boxX + padding, boxY + boxH / 2);
    }

    ctx.restore();
  }, [dimensions, hoverNode]);

  useEffect(() => {
    computeLayout();
    draw();
  }, [computeLayout, draw]);

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
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const n = layout.nodes[i];
      const dx = n.x - wx;
      const dy = n.y - wy;
      if (dx * dx + dy * dy <= 64) return n;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastPosRef.current = { x: sx, y: sy };
    isDraggingRef.current = true;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    if (isDraggingRef.current) {
      const dx = sx - lastPosRef.current.x;
      const dy = sy - lastPosRef.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      lastPosRef.current = { x: sx, y: sy };
      draw();
    } else {
      const node = findNodeAt(wx, wy);
      setHoverNode(node);
      draw();
    }
  }, [screenToWorld, findNodeAt, draw]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const t = transformRef.current;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, t.scale * factor));
    t.x = sx - wx * newScale;
    t.y = sy - wy * newScale;
    t.scale = newScale;
    draw();
  }, [screenToWorld, draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onNodeClick) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const node = findNodeAt(wx, wy);
    if (node) onNodeClick(node);
  }, [screenToWorld, findNodeAt, onNodeClick]);

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
          onWheel={handleWheel}
          onClick={handleClick}
        />
      </div>
    </div>
  );
}
