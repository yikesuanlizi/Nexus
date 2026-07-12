import { describe, expect, it } from 'vitest';
import { computeDagLayout, findNearestGraphNode, formatForceGraphLaneLabel } from './GitNexusForceGraph.js';

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
});
