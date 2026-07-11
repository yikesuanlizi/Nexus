import { describe, it, expect } from 'vitest';
import { parseGitNexusResult } from './gitNexusResult.js';
import type { ThreadItem } from '../shared/types.js';

function makeMcpItem(server: string, tool: string, result: unknown, args: unknown = {}): ThreadItem {
  return {
    id: 'item-1',
    type: 'mcp_tool_call',
    turnId: 'turn-1',
    server,
    tool,
    arguments: args,
    result: result as any,
    status: 'completed',
    timestamp: '2026-01-01T00:00:00Z',
  } as ThreadItem;
}

describe('parseGitNexusResult', () => {
  it('context 工具：symbol 为对象时生成中心节点、callers、callees', () => {
    // 真实 GitNexus 返回形态：symbol 是对象 { name, kind, file, line }
    const item = makeMcpItem('gitnexus', 'context', {
      structuredContent: {
        symbol: { name: 'AuthService.login', kind: 'function', file: 'auth.ts', line: 10 },
        callers: [
          { name: 'LoginController.handle', kind: 'method', file: 'controller.ts', line: 20 },
        ],
        callees: [
          { name: 'hashPassword', kind: 'function', file: 'crypto.ts', line: 30 },
        ],
        processes: [],
      },
    });
    const result = parseGitNexusResult(item);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('graph');
    expect(result!.nodes.length).toBeGreaterThan(0);
    // 中心节点 label 必须是符号名，不能是 [object Object]
    const center = result!.nodes.find((n) => n.group === 'center');
    expect(center).toBeDefined();
    expect(center!.label).toBe('AuthService.login');
    expect(center!.label).not.toContain('[object Object]');
    expect(center!.kind).toBe('function');
    expect(center!.file).toBe('auth.ts');
    expect(center!.line).toBe(10);
    // caller 和 callee
    const caller = result!.nodes.find((n) => n.group === 'caller');
    expect(caller).toBeDefined();
    const callee = result!.nodes.find((n) => n.group === 'callee');
    expect(callee).toBeDefined();
    expect(result!.edges.length).toBeGreaterThan(0);
  });

  it('context 工具：symbol 为字符串时仍兼容解析', () => {
    // 旧形态/简化形态：symbol 直接是字符串
    const item = makeMcpItem('gitnexus', 'context', {
      structuredContent: {
        symbol: 'AuthService.login',
        kind: 'function',
        file: 'auth.ts',
        line: 10,
        callers: [{ name: 'LoginController.handle' }],
        callees: [],
        processes: [],
      },
    });
    const result = parseGitNexusResult(item);
    expect(result).not.toBeNull();
    const center = result!.nodes.find((n) => n.group === 'center');
    expect(center).toBeDefined();
    expect(center!.label).toBe('AuthService.login');
    expect(center!.kind).toBe('function');
  });

  it('mcp_call_tool 包装调用时使用 arguments.tool 识别真实 GitNexus 工具', () => {
    const item = makeMcpItem('gitnexus', 'mcp_call_tool', {
      structuredContent: {
        symbol: { name: 'AuthService.login', kind: 'function', file: 'auth.ts', line: 10 },
        callers: [{ name: 'LoginController.handle' }],
        callees: [{ name: 'hashPassword' }],
      },
    }, {
      tool: 'context',
      arguments: { symbol: 'AuthService.login' },
    });

    const result = parseGitNexusResult(item);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('graph');
    expect(result!.title).toContain('context');
    expect(result!.nodes.find((n) => n.group === 'center')?.label).toBe('AuthService.login');
  });

  it('impact 工具按 upstream/downstream 生成边', () => {
    const item = makeMcpItem('gitnexus', 'impact', {
      structuredContent: {
        root: { name: 'UserService.update', kind: 'function' },
        upstream: [{ name: 'AdminController.updateUser', depth: 1 }],
        downstream: [{ name: 'db.update', depth: 1 }],
      },
    });
    const result = parseGitNexusResult(item);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('graph');
    const root = result!.nodes.find((n) => n.group === 'center');
    expect(root).toBeDefined();
    const upstream = result!.nodes.find((n) => n.group === 'upstream');
    expect(upstream).toBeDefined();
    const downstream = result!.nodes.find((n) => n.group === 'downstream');
    expect(downstream).toBeDefined();
    expect(result!.edges.length).toBeGreaterThan(0);
  });

  it('trace 工具生成顺序链路', () => {
    const item = makeMcpItem('gitnexus', 'trace', {
      structuredContent: {
        path: [{ name: 'entry' }, { name: 'middleware' }, { name: 'handler' }],
      },
    });
    const result = parseGitNexusResult(item);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('graph');
    expect(result!.nodes.length).toBe(3);
    // 至少有 2 条边连接 3 个节点
    expect(result!.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('query 工具返回 list 类型', () => {
    const item = makeMcpItem('gitnexus', 'query', {
      structuredContent: {
        results: [
          { name: 'AuthService', kind: 'class', file: 'auth.ts', line: 5, score: 0.95 },
          { name: 'authMiddleware', kind: 'function', file: 'middleware.ts', line: 12, score: 0.8 },
        ],
      },
    });
    const result = parseGitNexusResult(item);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('list');
    expect(result!.rows).toBeDefined();
    expect(result!.rows!.length).toBe(2);
    expect(result!.rows![0].name).toBe('AuthService');
  });

  it('非 gitnexus 的 MCP 工具返回 null', () => {
    const item = makeMcpItem('playwright', 'screenshot', {
      structuredContent: { some: 'data' },
    });
    const result = parseGitNexusResult(item);
    expect(result).toBeNull();
  });

  it('无法解析的 content 返回 null', () => {
    const item = makeMcpItem('gitnexus', 'context', {
      content: [{ type: 'text', text: 'not valid json {{' }],
    });
    const result = parseGitNexusResult(item);
    expect(result).toBeNull();
  });
});
