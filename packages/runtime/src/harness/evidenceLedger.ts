// 证据收据索引层：不复制全量历史，只存索引和收据。
// 原始内容通过 itemId 从 ThreadStore.getItems() 获取。
//
// 借鉴 Reasonix evidence.Ledger，但：
// - 不做平行历史库
// - 支持从 ThreadStore items 重建（Gap 5: rebuildFromThreadItems）
// - 按 harnessRunId 过滤（实施点 2: item.harnessRunId 字段）
// - supportsCriteria 两层填充（Gap 8: deterministic + evaluator）

import type { ThreadId, ThreadItem, TurnId } from '@nexus/protocol';
import type {
  EvidenceReceipt,
  EvidenceReceiptKind,
  EvidenceReceiptStatus,
  HarnessItemFields,
} from './types.js';

// ─── 辅助：从 ThreadItem 提取 harnessRunId（实施点 2） ────────────────────────
function getItemHarnessRunId(item: ThreadItem): string | undefined {
  const fields = item as unknown as HarnessItemFields;
  return fields.harnessRunId;
}

// ─── 辅助：从 ThreadItem 提取文本/路径/命令 ───────────────────────────────────

function extractItemPaths(item: ThreadItem): string[] {
  if (item.type === 'file_change') {
    return (item.changes ?? []).map(c => c.path);
  }
  return [];
}

function extractItemCommand(item: ThreadItem): string | undefined {
  if (item.type === 'command_execution') {
    return item.command;
  }
  return undefined;
}

function extractItemToolName(item: ThreadItem): string | undefined {
  if (item.type === 'tool_call') {
    return item.toolName;
  }
  if (item.type === 'mcp_tool_call') {
    return `${item.server}:${item.tool}`;
  }
  return undefined;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? p;
}

// ─── Gap 8: supportsCriteria deterministic 推导 ────────────────────────────────
// 规则 1：criterion 中提到路径/文件名，且 item 改了对应文件
// 规则 2：criterion 提到 test/build/lint/typecheck，且 item 是对应 verification command
// 规则 3：criterion 包含 tool name 关键词，且 item 是该 tool 调用
//
// 注意：isVerificationCommand 在 readinessCritic.ts 中定义；这里只做关键词匹配，
// 真正的 verification 判定由 ReadinessCritic.mutation_verified gate 完成。
function deriveSupportsCriteria(item: ThreadItem, criteria: string[]): string[] {
  const supported: string[] = [];
  const paths = extractItemPaths(item);
  const command = extractItemCommand(item);
  const toolName = extractItemToolName(item);

  for (const criterion of criteria) {
    const c = criterion.toLowerCase();

    // 规则 1：criterion 中提到路径/文件名，且 item 改了对应文件
    let matched = false;
    for (const p of paths) {
      const lower = p.toLowerCase();
      const base = basename(p).toLowerCase();
      if (c.includes(lower) || c.includes(base)) {
        supported.push(criterion);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 规则 2：criterion 提到 test/build/lint/typecheck，且 item 是对应 command
    // （这里只做弱关键词匹配；严格 verification 由 ReadinessCritic 判定）
    if (/test|build|lint|typecheck/.test(c) && command) {
      if (/^(npm|pnpm|yarn|npx|tsc|vitest|jest|pytest|python|go|cargo|mvn|gradle|make|dotnet)\b/.test(command.trim())) {
        supported.push(criterion);
        continue;
      }
    }

    // 规则 3：criterion 包含 tool name 关键词，且 item 是该 tool 调用
    if (toolName && c.includes(toolName.toLowerCase())) {
      supported.push(criterion);
    }
  }
  return [...new Set(supported)];  // 去重
}

// ─── EvidenceLedger ───────────────────────────────────────────────────────────

export class EvidenceLedger {
  // receipts: id → EvidenceReceipt
  private receipts: Map<string, EvidenceReceipt> = new Map();
  // byThread: threadId → Set<receiptId>
  private byThread: Map<ThreadId, Set<string>> = new Map();
  // byTurn: turnId → Set<receiptId>
  private byTurn: Map<TurnId, Set<string>> = new Map();

  // 当前关联的 criteria（用于 deriveSupportsCriteria）
  private currentCriteria: string[] = [];

  /**
   * 设置当前验收标准，用于后续 recordItem 时推导 supportsCriteria。
   * 每次 harness iteration 开始前由 TaskHarnessEngine 调用。
   */
  setCriteria(criteria: string[]): void {
    this.currentCriteria = criteria;
  }

  /**
   * 从单个 ThreadItem 提取证据收据。
   * 不产生证据的 item 类型（user_message / reasoning / todo_list 等）返回 null。
   */
  recordItem(
    item: ThreadItem,
    threadId: ThreadId,
    harnessRunId: string,
  ): EvidenceReceipt | null {
    const receipt = this.buildReceipt(item, threadId, harnessRunId);
    if (!receipt) return null;

    this.receipts.set(receipt.id, receipt);
    if (!this.byThread.has(threadId)) this.byThread.set(threadId, new Set());
    this.byThread.get(threadId)!.add(receipt.id);
    if (receipt.turnId) {
      if (!this.byTurn.has(receipt.turnId)) this.byTurn.set(receipt.turnId, new Set());
      this.byTurn.get(receipt.turnId)!.add(receipt.id);
    }
    return receipt;
  }

  /**
   * 批量记录一个 turn 的所有 item。
   * 返回实际产生的证据收据（跳过不产生证据的 item）。
   */
  recordTurn(
    items: ThreadItem[],
    threadId: ThreadId,
    turnId: TurnId,
    harnessRunId: string,
  ): EvidenceReceipt[] {
    const out: EvidenceReceipt[] = [];
    for (const item of items) {
      // 实施点 2: 优先用 item.harnessRunId 校验（若存在则必须匹配）
      const itemRunId = getItemHarnessRunId(item);
      if (itemRunId && itemRunId !== harnessRunId) continue;

      const r = this.recordItem(item, threadId, harnessRunId);
      if (r) {
        // 确保 turnId 一致（buildReceipt 里可能已用 item.turnId）
        r.turnId = turnId;
        out.push(r);
      }
    }
    return out;
  }

  // ─── 构造 receipt ──────────────────────────────────────────────────────────

  private buildReceipt(
    item: ThreadItem,
    threadId: ThreadId,
    harnessRunId: string,
  ): EvidenceReceipt | null {
    const id = `ev_${item.id}`;
    const timestamp = (item as { timestamp?: string }).timestamp ?? new Date().toISOString();
    const turnId = (item as { turnId?: string }).turnId ?? '';
    const supports = deriveSupportsCriteria(item, this.currentCriteria);

    switch (item.type) {
      case 'tool_call': {
        const status: EvidenceReceiptStatus =
          item.status === 'completed' ? 'passed' :
          item.status === 'failed' ? 'failed' : 'unknown';
        const kind: EvidenceReceiptKind = item.status === 'failed' ? 'error' : 'tool';
        return {
          id, threadId, turnId, itemId: item.id, harnessRunId,
          kind,
          summary: this.truncate(`${item.toolName}: ${this.stringifyResult(item.result)}`, 200),
          refs: { toolName: item.toolName },
          supportsCriteria: supports,
          status,
          timestamp,
        };
      }
      case 'command_execution': {
        const status: EvidenceReceiptStatus =
          item.status === 'completed' ? 'passed' :
          item.status === 'failed' ? 'failed' : 'unknown';
        const kind: EvidenceReceiptKind = item.status === 'failed' ? 'error' : 'command';
        return {
          id, threadId, turnId, itemId: item.id, harnessRunId,
          kind,
          summary: this.truncate(`${item.command}\n${item.aggregatedOutput ?? ''}`, 200),
          refs: { command: item.command },
          supportsCriteria: supports,
          status,
          timestamp,
        };
      }
      case 'file_change': {
        if (item.status !== 'completed') return null;
        const paths = (item.changes ?? []).map(c => c.path);
        return {
          id, threadId, turnId, itemId: item.id, harnessRunId,
          kind: 'file_change',
          summary: this.truncate(paths.join(', '), 200),
          refs: { path: paths[0] },
          supportsCriteria: supports,
          status: 'passed',
          timestamp,
        };
      }
      case 'mcp_tool_call': {
        const status: EvidenceReceiptStatus =
          item.status === 'completed' ? 'passed' :
          item.status === 'failed' ? 'failed' : 'unknown';
        const kind: EvidenceReceiptKind = item.status === 'failed' ? 'error' : 'mcp';
        return {
          id, threadId, turnId, itemId: item.id, harnessRunId,
          kind,
          summary: this.truncate(`${item.server}:${item.tool}`, 200),
          refs: { toolName: `${item.server}:${item.tool}` },
          supportsCriteria: supports,
          status,
          timestamp,
        };
      }
      case 'error': {
        return {
          id, threadId, turnId, itemId: item.id, harnessRunId,
          kind: 'error',
          summary: this.truncate(item.message, 200),
          refs: {},
          supportsCriteria: supports,
          status: 'failed',
          timestamp,
        };
      }
      default:
        // user_message / agent_message / reasoning / workflow_checkpoint / project_checkpoint /
        // rollback_conflict / context_compaction / web_search / todo_list / harness_continuation
        // 这些类型不产生证据
        return null;
    }
  }

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + '…';
  }

  private stringifyResult(result: unknown): string {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result).slice(0, 200);
    } catch {
      return String(result);
    }
  }

  // ─── 查询 API ──────────────────────────────────────────────────────────────

  hasSuccessfulCommand(command: string, sinceTurnId?: TurnId): boolean {
    for (const r of this.receipts.values()) {
      if (sinceTurnId && r.turnId && this.isTurnBefore(r.turnId, sinceTurnId)) continue;
      if (r.kind === 'command' && r.status === 'passed' && r.refs.command === command) {
        return true;
      }
    }
    return false;
  }

  hasSuccessfulWrite(paths: string[], sinceTurnId?: TurnId): boolean {
    const set = new Set(paths);
    for (const r of this.receipts.values()) {
      if (sinceTurnId && r.turnId && this.isTurnBefore(r.turnId, sinceTurnId)) continue;
      if (r.kind === 'file_change' && r.status === 'passed' && r.refs.path && set.has(r.refs.path)) {
        return true;
      }
    }
    return false;
  }

  hasSuccessfulReadOrWrite(paths: string[], sinceTurnId?: TurnId): boolean {
    // MVP: 等同 hasSuccessfulWrite；read 证据由 tool_call 类型承载
    return this.hasSuccessfulWrite(paths, sinceTurnId);
  }

  hasFailedTool(toolName: string, sinceTurnId?: TurnId): boolean {
    for (const r of this.receipts.values()) {
      if (sinceTurnId && r.turnId && this.isTurnBefore(r.turnId, sinceTurnId)) continue;
      if (r.status === 'failed' && r.refs.toolName === toolName) return true;
    }
    return false;
  }

  getEvidenceForCriteria(criteria: string): EvidenceReceipt[] {
    const out: EvidenceReceipt[] = [];
    for (const r of this.receipts.values()) {
      if (r.supportsCriteria.includes(criteria)) out.push(r);
    }
    return out;
  }

  getRecentEvidence(limit: number): EvidenceReceipt[] {
    const all = [...this.receipts.values()];
    all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return all.slice(0, limit);
  }

  getToolCallCount(toolName: string): number {
    let count = 0;
    for (const r of this.receipts.values()) {
      if (r.refs.toolName === toolName) count++;
    }
    return count;
  }

  getErrorCount(): number {
    let count = 0;
    for (const r of this.receipts.values()) {
      if (r.kind === 'error' || r.status === 'failed') count++;
    }
    return count;
  }

  getAll(): EvidenceReceipt[] {
    return [...this.receipts.values()];
  }

  size(): number {
    return this.receipts.size;
  }

  // ─── Gap 8: evaluator 反向更新 supportsCriteria ──────────────────────────

  /**
   * 由 GoalEvaluator 输出的 criteriaEvidenceMap 反向更新 receipt.supportsCriteria。
   * map: criterion → evidenceId[]
   */
  applyCriteriaMap(map: Record<string, string[]>): void {
    for (const [criterion, evidenceIds] of Object.entries(map)) {
      for (const eid of evidenceIds) {
        const r = this.receipts.get(eid);
        if (r && !r.supportsCriteria.includes(criterion)) {
          r.supportsCriteria.push(criterion);
        }
      }
    }
  }

  // ─── Gap 5: 从 ThreadStore items 重建 ledger ──────────────────────────────

  /**
   * 从 ThreadStore items 重建 ledger（服务重启或 resume 时调用）。
   * 实施点 2: 优先用 item.harnessRunId 字段过滤；若 item 没有该字段则跳过。
   *
   * @param threadId 线程 ID
   * @param store    ThreadStore 实例
   * @param harnessRunId 可选，只重建该 run 的证据
   */
  async rebuildFromThreadItems(
    threadId: ThreadId,
    store: { getItems(threadId: ThreadId): Promise<ThreadItem[]> },
    harnessRunId?: string,
  ): Promise<void> {
    this.receipts.clear();
    this.byThread.clear();
    this.byTurn.clear();

    const items = await store.getItems(threadId);
    for (const item of items) {
      const itemRunId = getItemHarnessRunId(item);
      // 实施点 2: 用 item.harnessRunId 字段直接过滤
      if (harnessRunId) {
        if (itemRunId !== harnessRunId) continue;
      }
      // harness_continuation 本身不作为证据
      if (item.type === 'harness_continuation') continue;

      this.recordItem(item, threadId, harnessRunId ?? itemRunId ?? '');
    }
  }

  // ─── 内部工具 ──────────────────────────────────────────────────────────────

  /** 简单的 turnId 顺序比较：MVP 假设 turnId 是递增字符串或 UUID。 */
  private isTurnBefore(a: TurnId, b: TurnId): boolean {
    return a < b;
  }
}
