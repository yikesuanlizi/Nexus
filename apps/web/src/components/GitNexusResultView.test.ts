import { describe, expect, it } from 'vitest';
import { computeGitNexusFlowLayout, getGitNexusNodeRelations } from './gitNexusFlowLayout.js';
import type { GitNexusGraphData } from './gitNexusResult.js';

function sampleContextGraph(): GitNexusGraphData {
  return {
    kind: 'graph',
    title: 'context: Insight.vue',
    nodes: [
      { id: 'center', label: 'Insight.vue', group: 'center', kind: 'File', file: 'frontend/src/views/bi/Insight.vue' },
      { id: 'caller-1', label: 'Dashboard.vue', group: 'caller', kind: 'File', file: 'frontend/src/views/bi/Dashboard.vue' },
      { id: 'proc-1', label: 'fetchDatasets', group: 'process', kind: 'Function', file: 'frontend/src/views/bi/Insight.vue', line: 34 },
      { id: 'proc-2', label: 'handleGenerate', group: 'process', kind: 'Function', file: 'frontend/src/views/bi/Insight.vue', line: 88 },
      { id: 'callee-1', label: 'sanitizeHtml', group: 'callee', kind: 'Function', file: 'frontend/src/utils/sanitize.ts', line: 6 },
      { id: 'callee-2', label: 'pageDatasets', group: 'callee', kind: 'Function', file: 'frontend/src/api/dataset.ts', line: 10 },
    ],
    edges: [
      { id: 'e1', source: 'caller-1', target: 'center', label: 'IMPORTS' },
      { id: 'e2', source: 'center', target: 'proc-1', label: 'DEFINES' },
      { id: 'e3', source: 'proc-2', target: 'callee-1', label: 'CALLS' },
      { id: 'e4', source: 'proc-1', target: 'callee-2', label: 'CALLS' },
    ],
  };
}

describe('GitNexusResultView layout helpers', () => {
  it('spreads context graph nodes by semantic lanes without overlapping positions', () => {
    const layout = computeGitNexusFlowLayout(sampleContextGraph());

    const positionKeys = layout.nodes.map((node) => `${node.position.x}:${node.position.y}`);
    expect(new Set(positionKeys).size).toBe(layout.nodes.length);
    expect(layout.groupLabels.map((label) => label.label)).toEqual([
      '调用方',
      '当前符号',
      '内部符号',
      '依赖目标',
    ]);

    const processNodes = layout.nodes.filter((node) => node.group === 'process');
    expect(Math.abs(processNodes[0].position.y - processNodes[1].position.y)).toBeGreaterThanOrEqual(86);
  });

  it('collects incoming and outgoing relation details for the clicked node', () => {
    const relations = getGitNexusNodeRelations(sampleContextGraph(), 'proc-2');

    expect(relations.incoming).toEqual([]);
    expect(relations.outgoing).toEqual([
      {
        relation: 'CALLS',
        node: {
          id: 'callee-1',
          label: 'sanitizeHtml',
          group: 'callee',
          kind: 'Function',
          file: 'frontend/src/utils/sanitize.ts',
          line: 6,
        },
      },
    ]);
  });
});
