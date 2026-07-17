import type { GitNexusGraphData, GitNexusNode } from './gitNexusResult.js';

export interface FlowLayoutNode extends GitNexusNode {
  position: { x: number; y: number };
}

export interface FlowGroupLabel {
  id: string;
  label: string;
  count: number;
  position: { x: number; y: number };
}

export interface FlowLayout {
  nodes: FlowLayoutNode[];
  groupLabels: FlowGroupLabel[];
}

export interface NodeRelation {
  relation: string;
  node: GitNexusNode;
}

const GROUP_LABELS: Record<string, string> = {
  caller: '调用方',
  upstream: '上游影响',
  route: '路由',
  changed: '变更文件',
  center: '当前符号',
  handler: '处理器',
  process: '内部符号',
  callee: '依赖目标',
  downstream: '下游影响',
  consumer: '消费者',
  affected: '受影响项',
  default: '其他',
};

const COLUMN_ORDER = [
  'caller',
  'upstream',
  'changed',
  'route',
  'center',
  'handler',
  'process',
  'callee',
  'downstream',
  'consumer',
  'affected',
  'default',
];

function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group;
}

export function nodeSummary(node: GitNexusNode): string {
  const file = node.file ? node.file.split(/[\\/]/).pop() : '';
  const parts = [node.kind, file].filter(Boolean);
  return parts.join(' / ');
}

export function computeGitNexusFlowLayout(data: GitNexusGraphData): FlowLayout {
  const isTrace = data.title.startsWith('trace:') || (
    data.nodes.length > 1 && data.nodes.every((node) => (node.group ?? 'default') === 'route')
  );

  if (isTrace) {
    return {
      nodes: data.nodes.map((node, index) => ({
        ...node,
        position: { x: 120 + index * 240, y: 170 },
      })),
      groupLabels: [{
        id: 'lane-route',
        label: '调用路径',
        count: data.nodes.length,
        position: { x: 120, y: 58 },
      }],
    };
  }

  const grouped = new Map<string, GitNexusNode[]>();
  for (const node of data.nodes) {
    const group = node.group ?? 'default';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(node);
  }

  const orderedGroups = COLUMN_ORDER.filter((group) => grouped.has(group));
  for (const group of grouped.keys()) {
    if (!orderedGroups.includes(group)) orderedGroups.push(group);
  }

  const layoutNodes: FlowLayoutNode[] = [];
  const groupLabels: FlowGroupLabel[] = [];
  const columnGap = 250;
  const rowGap = 92;
  const startX = 100;
  const startY = 128;

  orderedGroups.forEach((group, groupIndex) => {
    const groupNodes = [...(grouped.get(group) ?? [])].sort((a, b) => a.label.localeCompare(b.label));
    const x = startX + groupIndex * columnGap;
    groupLabels.push({
      id: `lane-${group}`,
      label: groupLabel(group),
      count: groupNodes.length,
      position: { x, y: 54 },
    });

    groupNodes.forEach((node, nodeIndex) => {
      layoutNodes.push({
        ...node,
        position: { x, y: startY + nodeIndex * rowGap },
      });
    });
  });

  return { nodes: layoutNodes, groupLabels };
}

export function getGitNexusNodeRelations(data: GitNexusGraphData, nodeId: string): { incoming: NodeRelation[]; outgoing: NodeRelation[] } {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const incoming: NodeRelation[] = [];
  const outgoing: NodeRelation[] = [];

  for (const edge of data.edges) {
    const relation = edge.label ?? 'RELATED';
    if (edge.target === nodeId) {
      const node = nodeById.get(edge.source);
      if (node) incoming.push({ relation, node });
    }
    if (edge.source === nodeId) {
      const node = nodeById.get(edge.target);
      if (node) outgoing.push({ relation, node });
    }
  }

  return { incoming, outgoing };
}
