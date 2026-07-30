import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeDagLayout,
  computeGitNexusMapLayout,
  computeGraphViewportTransform,
  findNearestGraphNode,
  formatForceGraphEdgeLabel,
  formatForceGraphLaneLabel,
} from './GitNexusForceGraph.js';
import {
  buildGitNexusKnowledgeGraph,
  computeHoverLens,
} from './gitNexusKnowledgeGraph.js';

describe('GitNexusForceGraph hit testing', () => {
  it('selects the nearest node when hit areas overlap', () => {
    const target = { id: 'target', x: 100, y: 100 };
    const lower = { id: 'lower', x: 100, y: 112 };

    const hit = findNearestGraphNode([target, lower], 101, 101, 14);

    expect(hit?.id).toBe('target');
  });
});

describe('GitNexusForceGraph layout', () => {
  it('spreads dense same-layer nodes across a larger world instead of stacking them', () => {
    const nodes = Array.from({ length: 120 }, (_, i) => ({
      id: `node-${i}`,
      label: `Node ${i}`,
      group: i % 2 === 0 ? 'service' : 'controller',
    }));

    const layout = computeDagLayout(nodes, [], 600, 360);

    expect(layout.width).toBeGreaterThan(600);

    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const dx = layout.nodes[i].x - layout.nodes[j].x;
        const dy = layout.nodes[i].y - layout.nodes[j].y;
        minDistance = Math.min(minDistance, Math.sqrt(dx * dx + dy * dy));
      }
    }

    expect(minDistance).toBeGreaterThanOrEqual(30);
  });

  it('uses different lane labels for file and symbol dependency graphs', () => {
    expect(formatForceGraphLaneLabel('file', 0, 4)).toBe('上游文件');
    expect(formatForceGraphLaneLabel('file', 2, 4)).toBe('依赖层 2');
    expect(formatForceGraphLaneLabel('symbol', 0, 4)).toBe('调用入口');
    expect(formatForceGraphLaneLabel('symbol', 2, 4)).toBe('调用层 2');
  });

  it('lays out every graph node instead of collapsing nodes behind parent regions', () => {
    const layout = computeGitNexusMapLayout({
      nodes: Array.from({ length: 90 }, (_, index) => ({
        id: `node-${index}`,
        label: `file-${index}.ts`,
        group: index % 3 === 0 ? 'file' : 'method',
        file: index % 2 === 0 ? `apps/web/src/file-${index}.ts` : `apps/api/src/file-${index}.ts`,
      })),
      edges: Array.from({ length: 89 }, (_, index) => ({
        id: `edge-${index}`,
        source: `node-${index}`,
        target: `node-${index + 1}`,
      })),
    }, 900, 520, 0.4);

    expect(layout.nodes).toHaveLength(90);
    expect(layout.edges).toHaveLength(89);
    expect(layout.width).toBeGreaterThanOrEqual(900);
  });

  it('keeps dense graph nodes separated enough for labels to remain readable', () => {
    const layout = computeGitNexusMapLayout({
      nodes: Array.from({ length: 80 }, (_, index) => ({
        id: `node-${index}`,
        label: `node-${index}.tsx`,
        group: index % 4 === 0 ? 'class' : 'file',
        file: `packages/runtime/src/node-${index}.tsx`,
      })),
      edges: [],
    }, 900, 520, 1);

    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const dx = layout.nodes[i].x - layout.nodes[j].x;
        const dy = layout.nodes[i].y - layout.nodes[j].y;
        minDistance = Math.min(minDistance, Math.sqrt(dx * dx + dy * dy));
      }
    }

    expect(minDistance).toBeGreaterThanOrEqual(42);
  });

  it('places the most connected node near the center with neighbors distributed radially', () => {
    const hubId = 'service-hub';
    const layout = computeGitNexusMapLayout({
      nodes: [
        { id: hubId, label: '核心服务', group: 'service' },
        ...Array.from({ length: 18 }, (_, index) => ({
          id: `leaf-${index}`,
          label: `依赖 ${index}`,
          group: index % 3 === 0 ? 'class' : 'file',
          file: `apps/web/src/dep-${index}.ts`,
        })),
      ],
      edges: Array.from({ length: 18 }, (_, index) => ({
        id: `edge-${index}`,
        source: hubId,
        target: `leaf-${index}`,
      })),
    }, 900, 620, 1);

    const center = { x: layout.width / 2, y: layout.height / 2 };
    const hub = layout.nodes.find((node) => node.id === hubId)!;
    const hubDistance = Math.hypot(hub.x - center.x, hub.y - center.y);
    const leafAngles = layout.nodes
      .filter((node) => node.id !== hubId)
      .map((node) => Math.atan2(node.y - hub.y, node.x - hub.x));
    const quadrants = new Set(leafAngles.map((angle) => `${angle > 0 ? 'bottom' : 'top'}-${Math.cos(angle) > 0 ? 'right' : 'left'}`));

    expect(hubDistance).toBeLessThan(80);
    expect(hub.radius).toBeGreaterThan(18);
    expect(quadrants.size).toBeGreaterThanOrEqual(4);
  });

  it('formats relationship labels from graph edge metadata without inventing labels', () => {
    expect(formatForceGraphEdgeLabel({ id: 'a', source: 'a', target: 'b', label: '调用' })).toBe('调用');
    expect(formatForceGraphEdgeLabel({ id: 'b', source: 'a', target: 'b', type: 'imports' })).toBe('imports');
    expect(formatForceGraphEdgeLabel({ id: 'c', source: 'a', target: 'b', kind: 'references' })).toBe('references');
    expect(formatForceGraphEdgeLabel({ id: 'd', source: 'a', target: 'b', relation: '依赖' })).toBe('依赖');
    expect(formatForceGraphEdgeLabel({ id: 'e', source: 'a', target: 'b' })).toBeNull();
  });

  it('fits the actual node bounds into most of the viewport on first open', () => {
    const layout = computeGitNexusMapLayout({
      nodes: [
        { id: 'hub', label: '核心服务', group: 'service' },
        ...Array.from({ length: 80 }, (_, index) => ({
          id: `leaf-${index}`,
          label: `leaf-${index}`,
          group: 'file',
        })),
      ],
      edges: Array.from({ length: 80 }, (_, index) => ({
        id: `edge-${index}`,
        source: 'hub',
        target: `leaf-${index}`,
      })),
    }, 1600, 720, 1);

    const transform = computeGraphViewportTransform(layout, 1600, 720);
    const projectedWidth = transform.bounds.width * transform.scale;
    const projectedHeight = transform.bounds.height * transform.scale;

    expect(Math.max(projectedWidth / 1600, projectedHeight / 720)).toBeGreaterThan(0.82);
    expect(Math.max(projectedWidth / 1600, projectedHeight / 720)).toBeLessThanOrEqual(0.94);
  });

  it('uses the observed canvas height instead of the default height when resized inside a modal', () => {
    const source = readFileSync('apps/web/src/components/GitNexusForceGraph.tsx', 'utf8');

    expect(source).toContain('const observedHeight = Math.max(entry.contentRect.height, height);');
    expect(source).toContain('computeGraphViewportTransform(result, dimensions.width, dimensions.height)');
  });
});

describe('GitNexus knowledge graph model', () => {
  it('derives architecture clusters from file paths', () => {
    const graph = buildGitNexusKnowledgeGraph({
      nodes: [
        { id: 'web-main', label: 'main.tsx', group: 'file', file: 'apps/web/src/main.tsx' },
        { id: 'api-runtime', label: 'tenantRuntime.ts', group: 'file', file: 'apps/api/src/runtime/tenantRuntime.ts' },
        { id: 'runtime-agent', label: 'agent.ts', group: 'file', file: 'packages/runtime/src/agent.ts' },
      ],
      edges: [{ id: 'e1', source: 'web-main', target: 'api-runtime', weight: 2 }],
    });

    expect(graph.clusters.map((cluster) => cluster.id)).toEqual(
      expect.arrayContaining(['apps/web', 'apps/api', 'packages/runtime']),
    );
    expect(graph.nodes.find((node) => node.id === 'web-main')?.clusterId).toBe('apps/web');
  });

  it('computes hover lens neighborhood without mutating layout nodes', () => {
    const graph = buildGitNexusKnowledgeGraph({
      nodes: [
        { id: 'a', label: 'a.ts', group: 'file', file: 'apps/web/a.ts' },
        { id: 'b', label: 'b.ts', group: 'file', file: 'apps/web/b.ts' },
        { id: 'c', label: 'c.ts', group: 'file', file: 'apps/api/c.ts' },
      ],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
      ],
    });

    const lens = computeHoverLens(graph, 'b');

    expect(lens.focusNodeId).toBe('b');
    expect([...lens.visibleNodeIds].sort()).toEqual(['a', 'b', 'c']);
    expect([...lens.visibleEdgeIds].sort()).toEqual(['ab', 'bc']);
  });
});
