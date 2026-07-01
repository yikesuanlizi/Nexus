import type {
  Checkpoint,
  ThreadId,
  ThreadItem,
  MemoryRecord,
  MemorySearchOptions,
  ThreadMeta,
  ThreadSpawnEdge,
  ThreadSpawnEdgeStatus,
  TurnMeta,
  ThreadWorkingSetSnapshot,
} from '@nexus/protocol';
import { DEFAULT_TENANT_ID, safeTenantId, type ThreadStore } from './store.js';
import type { RunEvent, RunFeedback, RunRecord, RunStatus } from './store.js';

export interface PgQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface PgClientLike {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<PgQueryResult<T>>;
}

export class PostgresThreadStore implements ThreadStore {
  readonly tenantId: string;
  private ready: Promise<void>;

  constructor(
    private readonly client: PgClientLike,
    tenantId: string = DEFAULT_TENANT_ID,
  ) {
    this.tenantId = safeTenantId(tenantId);
    this.ready = this.initSchema();
  }

  scope(tenantId: string): ThreadStore {
    return new PostgresThreadStore(this.client, tenantId);
  }

  async createThread(meta: ThreadMeta): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO threads (
        tenant_id, thread_id, title, workspace_root, status, turn_count,
        created_at, updated_at, archived_at, ephemeral, tags,
        parent_thread_id, agent_nickname, agent_role
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
      ON CONFLICT (tenant_id, thread_id) DO NOTHING`,
      [
        this.tenantId,
        meta.threadId,
        meta.title,
        meta.workspaceRoot,
        meta.status,
        meta.turnCount,
        meta.createdAt,
        meta.updatedAt,
        meta.archivedAt,
        meta.ephemeral,
        JSON.stringify(meta.tags ?? {}),
        meta.parentThreadId ?? null,
        meta.agentNickname ?? null,
        meta.agentRole ?? null,
      ],
    );
  }

  async getThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    await this.ready;
    const result = await this.client.query('SELECT * FROM threads WHERE tenant_id = $1 AND thread_id = $2', [
      this.tenantId,
      threadId,
    ]);
    return result.rows[0] ? rowToMeta(result.rows[0]) : null;
  }

  async listThreads(filter?: { status?: ThreadMeta['status']; limit?: number }): Promise<ThreadMeta[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId];
    let sql = 'SELECT * FROM threads WHERE tenant_id = $1';
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY updated_at DESC';
    if (filter?.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToMeta);
  }

  async updateThreadMetadata(
    threadId: ThreadId,
    patch: Partial<Pick<ThreadMeta, 'title' | 'status' | 'turnCount' | 'updatedAt' | 'tags'>>,
  ): Promise<void> {
    await this.ready;
    const sets: string[] = [];
    const params: unknown[] = [this.tenantId, threadId];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.turnCount !== undefined) add('turn_count', patch.turnCount);
    if (patch.updatedAt !== undefined) add('updated_at', patch.updatedAt);
    if (patch.tags !== undefined) add('tags', JSON.stringify(patch.tags));
    if (sets.length === 0) return;
    add('updated_at', new Date().toISOString());
    await this.client.query(
      `UPDATE threads SET ${sets.join(', ')} WHERE tenant_id = $1 AND thread_id = $2`,
      params,
    );
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    await this.ready;
    await this.client.query('DELETE FROM thread_spawn_edges WHERE tenant_id = $1 AND (parent_thread_id = $2 OR child_thread_id = $2)', [
      this.tenantId,
      threadId,
    ]);
    await this.client.query('DELETE FROM thread_rollout_entries WHERE tenant_id = $1 AND thread_id = $2', [this.tenantId, threadId]);
    await this.client.query('DELETE FROM turns WHERE tenant_id = $1 AND thread_id = $2', [this.tenantId, threadId]);
    await this.client.query('DELETE FROM threads WHERE tenant_id = $1 AND thread_id = $2', [this.tenantId, threadId]);
  }

  async appendItems(threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    await this.ready;
    let index = await this.nextRolloutIndex(threadId);
    for (const item of items) {
      await this.client.query(
        `INSERT INTO thread_rollout_entries (tenant_id, thread_id, entry_index, kind, payload, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [this.tenantId, threadId, index++, 'item', JSON.stringify(item), new Date().toISOString()],
      );
    }
  }

  async getItems(threadId: ThreadId, since?: number): Promise<ThreadItem[]> {
    await this.ready;
    const thread = await this.getThread(threadId);
    const params: unknown[] = [this.tenantId, threadId, since ?? 0];
    const result = await this.client.query<{ payload: unknown }>(
      `SELECT payload FROM thread_rollout_entries
       WHERE tenant_id = $1 AND thread_id = $2 AND kind = 'item' AND entry_index >= $3
       ORDER BY entry_index ASC`,
      params,
    );
    const items = result.rows.map((row) => parseJson(row.payload) as ThreadItem).filter(Boolean);
    if (!thread) return items;
    const activeTurnIds = new Set((await this.getTurns(threadId)).map((turn) => turn.turnId));
    return items.filter((item) => isActiveThreadItem(item, activeTurnIds, thread.turnCount));
  }

  async getRecentItems(threadId: ThreadId, maxItems: number = 100): Promise<ThreadItem[]> {
    await this.ready;
    const thread = await this.getThread(threadId);
    const result = await this.client.query<{ payload: unknown }>(
      `SELECT payload FROM thread_rollout_entries
       WHERE tenant_id = $1 AND thread_id = $2 AND kind = 'item'
       ORDER BY entry_index DESC
       LIMIT $3`,
      [this.tenantId, threadId, maxItems],
    );
    const items = result.rows
      .map((row) => parseJson(row.payload) as ThreadItem)
      .filter(Boolean)
      .reverse();
    if (!thread) return items;
    const activeTurnIds = new Set((await this.getTurns(threadId)).map((turn) => turn.turnId));
    return items.filter((item) => isActiveThreadItem(item, activeTurnIds, thread.turnCount));
  }

  async appendCheckpoint(threadId: ThreadId, ckpt: Checkpoint): Promise<void> {
    await this.ready;
    const index = await this.nextRolloutIndex(threadId);
    await this.client.query(
      `INSERT INTO thread_rollout_entries (tenant_id, thread_id, entry_index, kind, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [this.tenantId, threadId, index, 'checkpoint', JSON.stringify(ckpt), ckpt.timestamp],
    );
  }

  async getLastCheckpoint(threadId: ThreadId): Promise<Checkpoint | null> {
    await this.ready;
    const result = await this.client.query<{ payload: unknown }>(
      `SELECT payload FROM thread_rollout_entries
       WHERE tenant_id = $1 AND thread_id = $2 AND kind = 'checkpoint'
       ORDER BY entry_index DESC
       LIMIT 1`,
      [this.tenantId, threadId],
    );
    return result.rows[0] ? parseJson(result.rows[0].payload) as Checkpoint : null;
  }

  async compactRollout(threadId: ThreadId, options: { keepLastCheckpoints?: number } = {}): Promise<{
    beforeLines: number;
    afterLines: number;
    removedItems: number;
  }> {
    await this.ready;
    const before = await this.client.query<{ count: number | string }>(
      'SELECT COUNT(*)::int AS count FROM thread_rollout_entries WHERE tenant_id = $1 AND thread_id = $2',
      [this.tenantId, threadId],
    );
    const checkpoints = await this.client.query<{ entry_index: number; payload: unknown }>(
      `SELECT entry_index, payload FROM thread_rollout_entries
       WHERE tenant_id = $1 AND thread_id = $2 AND kind = 'checkpoint'
       ORDER BY entry_index ASC`,
      [this.tenantId, threadId],
    );
    const latest = checkpoints.rows.at(-1);
    const latestPayload = latest ? parseJson(latest.payload) as Partial<Checkpoint> : null;
    if (!latestPayload || typeof latestPayload.itemIndex !== 'number') {
      const count = numberValue(before.rows[0]?.count);
      return { beforeLines: count, afterLines: count, removedItems: 0 };
    }

    const keepCheckpointCount = Math.max(1, Math.floor(options.keepLastCheckpoints ?? 1));
    const keepCheckpointIndexes = checkpoints.rows.slice(-keepCheckpointCount).map((row) => row.entry_index);
    const deleted = await this.client.query<{ count?: number | string }>(
      `WITH deleted AS (
         DELETE FROM thread_rollout_entries
         WHERE tenant_id = $1
           AND thread_id = $2
           AND (
             (kind = 'item' AND entry_index < $3)
             OR (kind = 'checkpoint' AND NOT (entry_index = ANY($4::int[])))
           )
         RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM deleted`,
      [this.tenantId, threadId, latestPayload.itemIndex, keepCheckpointIndexes],
    );
    const after = await this.client.query<{ count: number | string }>(
      'SELECT COUNT(*)::int AS count FROM thread_rollout_entries WHERE tenant_id = $1 AND thread_id = $2',
      [this.tenantId, threadId],
    );
    return {
      beforeLines: numberValue(before.rows[0]?.count),
      afterLines: numberValue(after.rows[0]?.count),
      removedItems: numberValue(deleted.rows[0]?.count),
    };
  }

  async getTurns(threadId: ThreadId): Promise<TurnMeta[]> {
    await this.ready;
    const thread = await this.getThread(threadId);
    if (!thread) return [];
    const result = await this.client.query(
      'SELECT * FROM turns WHERE tenant_id = $1 AND thread_id = $2 ORDER BY turn_index ASC LIMIT $3',
      [this.tenantId, threadId, thread.turnCount],
    );
    return result.rows.map(rowToTurn);
  }

  async saveTurn(turn: TurnMeta): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO turns (tenant_id, turn_id, thread_id, turn_index, user_input, status, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (tenant_id, turn_id)
       DO UPDATE SET thread_id = excluded.thread_id,
         turn_index = excluded.turn_index,
         user_input = excluded.user_input,
         status = excluded.status,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at`,
      [
        this.tenantId,
        turn.turnId,
        turn.threadId,
        turn.index,
        JSON.stringify(turn.userInput),
        turn.status,
        turn.startedAt,
        turn.completedAt,
      ],
    );
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    await this.ready;
    const result = await this.client.query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1', [
      this.settingKey(key),
    ]);
    return result.rows[0] ? parseJson(result.rows[0].value) as T : null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.settingKey(key), JSON.stringify(value), new Date().toISOString()],
    );
  }

  async upsertMemoryRecord(record: MemoryRecord): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO memory_records (
        tenant_id, id, type, text, status, scope, source_thread_id, source_turn_ids,
        workspace_root, tags, confidence, usage_count, last_used_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $14, $15)
      ON CONFLICT (tenant_id, id)
      DO UPDATE SET
        type = excluded.type,
        text = excluded.text,
        status = excluded.status,
        scope = excluded.scope,
        source_thread_id = excluded.source_thread_id,
        source_turn_ids = excluded.source_turn_ids,
        workspace_root = excluded.workspace_root,
        tags = excluded.tags,
        confidence = excluded.confidence,
        usage_count = excluded.usage_count,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at`,
      [
        this.tenantId,
        record.id,
        record.type,
        record.text,
        record.status,
        record.scope,
        record.sourceThreadId ?? null,
        JSON.stringify(record.sourceTurnIds),
        record.workspaceRoot ?? null,
        JSON.stringify(record.tags),
        record.confidence,
        record.usageCount,
        record.lastUsedAt,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async listMemoryRecords(filter: MemorySearchOptions = {}): Promise<MemoryRecord[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId];
    let sql = "SELECT * FROM memory_records WHERE tenant_id = $1 AND status = 'active'";
    if (filter.workspaceRoot) {
      params.push(filter.workspaceRoot);
      sql += ` AND (workspace_root IS NULL OR workspace_root = $${params.length})`;
    }
    if (filter.types?.length) {
      const placeholders = filter.types.map((type) => {
        params.push(type);
        return `$${params.length}`;
      });
      sql += ` AND type IN (${placeholders.join(', ')})`;
    }
    sql += ' ORDER BY updated_at DESC';
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToMemoryRecord);
  }

  async searchMemoryRecords(query: string, options: MemorySearchOptions = {}): Promise<MemoryRecord[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId];
    const needle = `%${query.trim()}%`;
    let sql = "SELECT * FROM memory_records WHERE tenant_id = $1 AND status = 'active'";
    if (query.trim()) {
      params.push(needle);
      sql += ` AND (text ILIKE $${params.length} OR type ILIKE $${params.length})`;
    }
    if (options.workspaceRoot) {
      params.push(options.workspaceRoot);
      sql += ` AND (workspace_root IS NULL OR workspace_root = $${params.length})`;
    }
    sql += ' ORDER BY updated_at DESC';
    if (options.limit) {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToMemoryRecord);
  }

  async deleteMemoryRecord(id: string): Promise<void> {
    await this.ready;
    await this.client.query(
      "UPDATE memory_records SET status = 'deleted', updated_at = NOW() WHERE tenant_id = $1 AND id = $2",
      [this.tenantId, id],
    );
  }

  async recordMemoryUsage(id: string, usedAt: string): Promise<void> {
    await this.ready;
    await this.client.query(
      'UPDATE memory_records SET usage_count = usage_count + 1, last_used_at = $3, updated_at = $3 WHERE tenant_id = $1 AND id = $2',
      [this.tenantId, id, usedAt],
    );
  }

  async saveThreadWorkingSet(snapshot: ThreadWorkingSetSnapshot): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO thread_working_sets (
        tenant_id, thread_id, generation, active_episode_ids, injected_episode_ids,
        frozen_prompt_block, built_from_turn_id, built_from_turn_index, task_fingerprint,
        episode_identity, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (tenant_id, thread_id)
      DO UPDATE SET
        generation = excluded.generation,
        active_episode_ids = excluded.active_episode_ids,
        injected_episode_ids = excluded.injected_episode_ids,
        frozen_prompt_block = excluded.frozen_prompt_block,
        built_from_turn_id = excluded.built_from_turn_id,
        built_from_turn_index = excluded.built_from_turn_index,
        task_fingerprint = excluded.task_fingerprint,
        episode_identity = excluded.episode_identity,
        updated_at = excluded.updated_at`,
      [
        this.tenantId,
        snapshot.threadId,
        snapshot.generation,
        JSON.stringify(snapshot.activeEpisodeIds),
        JSON.stringify(snapshot.injectedEpisodeIds),
        snapshot.frozenPromptBlock,
        snapshot.builtFromTurnId,
        snapshot.builtFromTurnIndex,
        snapshot.taskFingerprint,
        snapshot.episodeIdentity ?? '',
        snapshot.createdAt,
        snapshot.updatedAt,
      ],
    );
  }

  async getThreadWorkingSet(threadId: ThreadId): Promise<ThreadWorkingSetSnapshot | null> {
    await this.ready;
    const result = await this.client.query(
      'SELECT * FROM thread_working_sets WHERE tenant_id = $1 AND thread_id = $2',
      [this.tenantId, threadId],
    );
    return result.rows[0] ? rowToWorkingSet(result.rows[0]) : null;
  }

  async deleteThreadWorkingSet(threadId: ThreadId): Promise<void> {
    await this.ready;
    await this.client.query(
      'DELETE FROM thread_working_sets WHERE tenant_id = $1 AND thread_id = $2',
      [this.tenantId, threadId],
    );
  }

  async upsertThreadSpawnEdge(edge: ThreadSpawnEdge): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO thread_spawn_edges (tenant_id, parent_thread_id, child_thread_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, parent_thread_id, child_thread_id)
       DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      [this.tenantId, edge.parentThreadId, edge.childThreadId, edge.status, edge.createdAt, edge.updatedAt],
    );
  }

  async setThreadSpawnEdgeStatus(
    parentThreadId: ThreadId,
    childThreadId: ThreadId,
    status: ThreadSpawnEdgeStatus,
  ): Promise<void> {
    await this.ready;
    await this.client.query(
      `UPDATE thread_spawn_edges
       SET status = $4, updated_at = $5
       WHERE tenant_id = $1 AND parent_thread_id = $2 AND child_thread_id = $3`,
      [this.tenantId, parentThreadId, childThreadId, status, new Date().toISOString()],
    );
  }

  async listThreadSpawnChildren(parentThreadId: ThreadId, status?: ThreadSpawnEdgeStatus): Promise<ThreadSpawnEdge[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId, parentThreadId];
    let sql = 'SELECT * FROM thread_spawn_edges WHERE tenant_id = $1 AND parent_thread_id = $2';
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY created_at ASC';
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToSpawnEdge);
  }

  async listThreadSpawnDescendants(parentThreadId: ThreadId, status?: ThreadSpawnEdgeStatus): Promise<ThreadSpawnEdge[]> {
    const edges: ThreadSpawnEdge[] = [];
    const visit = async (threadId: ThreadId): Promise<void> => {
      const children = await this.listThreadSpawnChildren(threadId, status);
      for (const child of children) {
        edges.push(child);
        await visit(child.childThreadId);
      }
    };
    await visit(parentThreadId);
    return edges;
  }

  async createRunRecord(record: RunRecord): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO run_records (
        tenant_id, run_id, thread_id, turn_id, parent_run_id, workflow_id, workflow_node_id,
        kind, status, title, caller, active_step, model, error,
        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
        tool_call_count, model_call_count, subagent_count, middleware_event_count,
        first_human_message, last_ai_message, started_at, updated_at, completed_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb)
      ON CONFLICT (tenant_id, run_id)
      DO UPDATE SET status = excluded.status, active_step = excluded.active_step, updated_at = excluded.updated_at,
        completed_at = excluded.completed_at, error = excluded.error, metadata = excluded.metadata`,
      [
        this.tenantId,
        record.runId,
        record.threadId,
        record.turnId ?? null,
        record.parentRunId ?? null,
        record.workflowId ?? null,
        record.workflowNodeId ?? null,
        record.kind,
        record.status,
        record.title ?? null,
        record.caller,
        record.activeStep ?? null,
        record.model ?? null,
        record.error ?? null,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.reasoningOutputTokens,
        record.toolCallCount,
        record.modelCallCount,
        record.subagentCount,
        record.middlewareEventCount,
        record.firstHumanMessage ?? null,
        record.lastAiMessage ?? null,
        record.startedAt,
        record.updatedAt,
        record.completedAt ?? null,
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async updateRunRecord(runId: string, patch: Partial<RunRecord>): Promise<void> {
    await this.ready;
    const params: unknown[] = [this.tenantId, runId];
    const sets: string[] = [];
    const add = (column: string, value: unknown) => {
      params.push(column === 'metadata' ? JSON.stringify(value ?? {}) : value);
      sets.push(`${column} = $${params.length}${column === 'metadata' ? '::jsonb' : ''}`);
    };
    if (patch.threadId !== undefined) add('thread_id', patch.threadId);
    if (patch.turnId !== undefined) add('turn_id', patch.turnId);
    if (patch.parentRunId !== undefined) add('parent_run_id', patch.parentRunId);
    if (patch.workflowId !== undefined) add('workflow_id', patch.workflowId);
    if (patch.workflowNodeId !== undefined) add('workflow_node_id', patch.workflowNodeId);
    if (patch.kind !== undefined) add('kind', patch.kind);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.caller !== undefined) add('caller', patch.caller);
    if (patch.activeStep !== undefined) add('active_step', patch.activeStep);
    if (patch.model !== undefined) add('model', patch.model);
    if (patch.error !== undefined) add('error', patch.error);
    if (patch.inputTokens !== undefined) add('input_tokens', patch.inputTokens);
    if (patch.cachedInputTokens !== undefined) add('cached_input_tokens', patch.cachedInputTokens);
    if (patch.outputTokens !== undefined) add('output_tokens', patch.outputTokens);
    if (patch.reasoningOutputTokens !== undefined) add('reasoning_output_tokens', patch.reasoningOutputTokens);
    if (patch.toolCallCount !== undefined) add('tool_call_count', patch.toolCallCount);
    if (patch.modelCallCount !== undefined) add('model_call_count', patch.modelCallCount);
    if (patch.subagentCount !== undefined) add('subagent_count', patch.subagentCount);
    if (patch.middlewareEventCount !== undefined) add('middleware_event_count', patch.middlewareEventCount);
    if (patch.firstHumanMessage !== undefined) add('first_human_message', patch.firstHumanMessage);
    if (patch.lastAiMessage !== undefined) add('last_ai_message', patch.lastAiMessage);
    if (patch.startedAt !== undefined) add('started_at', patch.startedAt);
    if (patch.updatedAt !== undefined) add('updated_at', patch.updatedAt);
    if (patch.completedAt !== undefined) add('completed_at', patch.completedAt);
    if (patch.metadata !== undefined) add('metadata', patch.metadata);
    if (!sets.some((set) => set.startsWith('updated_at ='))) add('updated_at', new Date().toISOString());
    if (sets.length === 0) return;
    await this.client.query(`UPDATE run_records SET ${sets.join(', ')} WHERE tenant_id = $1 AND run_id = $2`, params);
  }

  async appendRunEvent(event: RunEvent): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO run_events (
        tenant_id, run_id, event_id, thread_id, turn_id, parent_run_id, workflow_id,
        workflow_node_id, sequence, category, type, level, message, tool_name,
        model, duration_ms, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
      ON CONFLICT (tenant_id, event_id) DO NOTHING`,
      [
        this.tenantId,
        event.runId,
        event.eventId,
        event.threadId,
        event.turnId ?? null,
        event.parentRunId ?? null,
        event.workflowId ?? null,
        event.workflowNodeId ?? null,
        event.sequence,
        event.category,
        event.type,
        event.level,
        event.message,
        event.toolName ?? null,
        event.model ?? null,
        event.durationMs ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt,
      ],
    );
  }

  async listRunRecords(filter: { threadId?: ThreadId; status?: RunStatus; limit?: number } = {}): Promise<RunRecord[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId];
    let sql = 'SELECT * FROM run_records WHERE tenant_id = $1';
    if (filter.threadId) {
      params.push(filter.threadId);
      sql += ` AND thread_id = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY updated_at DESC';
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToRunRecord);
  }

  async listRunEvents(runId: string, filter: { limit?: number; category?: string } = {}): Promise<RunEvent[]> {
    await this.ready;
    const params: unknown[] = [this.tenantId, runId];
    let sql = 'SELECT * FROM run_events WHERE tenant_id = $1 AND run_id = $2';
    if (filter.category) {
      params.push(filter.category);
      sql += ` AND category = $${params.length}`;
    }
    sql += ' ORDER BY sequence ASC';
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const result = await this.client.query(sql, params);
    return result.rows.map(rowToRunEvent);
  }

  async upsertRunFeedback(feedback: RunFeedback): Promise<void> {
    await this.ready;
    await this.client.query(
      `INSERT INTO run_feedback (tenant_id, feedback_id, run_id, thread_id, rating, comment, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, feedback_id)
       DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at`,
      [this.tenantId, feedback.feedbackId, feedback.runId, feedback.threadId, feedback.rating, feedback.comment ?? null, feedback.createdAt, feedback.updatedAt],
    );
  }

  async listRunFeedback(runId: string): Promise<RunFeedback[]> {
    await this.ready;
    const result = await this.client.query(
      'SELECT * FROM run_feedback WHERE tenant_id = $1 AND run_id = $2 ORDER BY updated_at DESC',
      [this.tenantId, runId],
    );
    return result.rows.map(rowToRunFeedback);
  }

  private async initSchema(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS threads (
        tenant_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        turn_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        ephemeral BOOLEAN NOT NULL DEFAULT FALSE,
        tags JSONB NOT NULL DEFAULT '{}'::jsonb,
        parent_thread_id TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        PRIMARY KEY (tenant_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_threads_tenant_updated ON threads(tenant_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS turns (
        tenant_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        user_input JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (tenant_id, turn_id)
      );
      CREATE INDEX IF NOT EXISTS idx_turns_tenant_thread ON turns(tenant_id, thread_id, turn_index);

      CREATE TABLE IF NOT EXISTS thread_rollout_entries (
        tenant_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        entry_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, thread_id, entry_index)
      );
      CREATE INDEX IF NOT EXISTS idx_rollout_tenant_thread_kind ON thread_rollout_entries(tenant_id, thread_id, kind, entry_index);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_spawn_edges (
        tenant_id TEXT NOT NULL,
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, parent_thread_id, child_thread_id),
        UNIQUE (tenant_id, child_thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_spawn_edges_tenant_parent ON thread_spawn_edges(tenant_id, parent_thread_id, status);

      CREATE TABLE IF NOT EXISTS run_records (
        tenant_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        parent_run_id TEXT,
        workflow_id TEXT,
        workflow_node_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        caller TEXT NOT NULL,
        active_step TEXT,
        model TEXT,
        error TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        model_call_count INTEGER NOT NULL DEFAULT 0,
        subagent_count INTEGER NOT NULL DEFAULT 0,
        middleware_event_count INTEGER NOT NULL DEFAULT 0,
        first_human_message TEXT,
        last_ai_message TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (tenant_id, run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_records_tenant_thread ON run_records(tenant_id, thread_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_records_tenant_status ON run_records(tenant_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS run_events (
        tenant_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        parent_run_id TEXT,
        workflow_id TEXT,
        workflow_node_id TEXT,
        sequence INTEGER NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        tool_name TEXT,
        model TEXT,
        duration_ms INTEGER,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_tenant_run ON run_events(tenant_id, run_id, sequence);

      CREATE TABLE IF NOT EXISTS run_feedback (
        tenant_id TEXT NOT NULL,
        feedback_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 0,
        comment TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, feedback_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_feedback_tenant_run ON run_feedback(tenant_id, run_id);

      CREATE TABLE IF NOT EXISTS memory_records (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        scope TEXT NOT NULL DEFAULT 'global',
        source_thread_id TEXT,
        source_turn_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        workspace_root TEXT,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        confidence REAL NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_status ON memory_records(tenant_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_workspace ON memory_records(tenant_id, workspace_root, status);

      CREATE TABLE IF NOT EXISTS thread_working_sets (
        tenant_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 0,
        active_episode_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        injected_episode_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        frozen_prompt_block TEXT NOT NULL DEFAULT '',
        built_from_turn_id TEXT NOT NULL DEFAULT '',
        built_from_turn_index INTEGER NOT NULL DEFAULT -1,
        task_fingerprint TEXT NOT NULL DEFAULT '',
        episode_identity TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_thread_working_sets_tenant
        ON thread_working_sets(tenant_id, thread_id);
    `);
    await this.client.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ['storage.schemaVersion', JSON.stringify({ version: 5, backend: 'postgres' }), new Date().toISOString()],
    );
  }

  private async nextRolloutIndex(threadId: ThreadId): Promise<number> {
    const result = await this.client.query<{ count: number | string }>(
      'SELECT COUNT(*)::int AS count FROM thread_rollout_entries WHERE tenant_id = $1 AND thread_id = $2',
      [this.tenantId, threadId],
    );
    return numberValue(result.rows[0]?.count);
  }

  private settingKey(key: string): string {
    if (key === 'storage.schemaVersion' || key === 'auth.tokens.v1') return key;
    return `tenant:${this.tenantId}:${key}`;
  }
}

function rowToMeta(row: Record<string, unknown>): ThreadMeta {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    threadId: String(row.thread_id),
    title: String(row.title ?? ''),
    workspaceRoot: String(row.workspace_root ?? ''),
    status: row.status as ThreadMeta['status'],
    turnCount: Number(row.turn_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    ephemeral: Boolean(row.ephemeral),
    tags: parseJson(row.tags) as Record<string, string>,
    parentThreadId: row.parent_thread_id == null ? null : String(row.parent_thread_id),
    agentNickname: row.agent_nickname == null ? null : String(row.agent_nickname),
    agentRole: row.agent_role == null ? null : String(row.agent_role),
  };
}

function rowToTurn(row: Record<string, unknown>): TurnMeta {
  return {
    turnId: String(row.turn_id),
    threadId: String(row.thread_id),
    index: Number(row.turn_index ?? 0),
    userInput: parseJson(row.user_input) as TurnMeta['userInput'],
    status: row.status as TurnMeta['status'],
    startedAt: String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

function rowToSpawnEdge(row: Record<string, unknown>): ThreadSpawnEdge {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    parentThreadId: String(row.parent_thread_id),
    childThreadId: String(row.child_thread_id),
    status: row.status as ThreadSpawnEdgeStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    runId: String(row.run_id),
    threadId: String(row.thread_id),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    parentRunId: row.parent_run_id == null ? null : String(row.parent_run_id),
    workflowId: row.workflow_id == null ? null : String(row.workflow_id),
    workflowNodeId: row.workflow_node_id == null ? null : String(row.workflow_node_id),
    kind: row.kind as RunRecord['kind'],
    status: row.status as RunRecord['status'],
    title: row.title == null ? null : String(row.title),
    caller: row.caller as RunRecord['caller'],
    activeStep: row.active_step == null ? null : String(row.active_step),
    model: row.model == null ? null : String(row.model),
    error: row.error == null ? null : String(row.error),
    inputTokens: numberValue(row.input_tokens as number | string | undefined),
    cachedInputTokens: numberValue(row.cached_input_tokens as number | string | undefined),
    outputTokens: numberValue(row.output_tokens as number | string | undefined),
    reasoningOutputTokens: numberValue(row.reasoning_output_tokens as number | string | undefined),
    toolCallCount: numberValue(row.tool_call_count as number | string | undefined),
    modelCallCount: numberValue(row.model_call_count as number | string | undefined),
    subagentCount: numberValue(row.subagent_count as number | string | undefined),
    middlewareEventCount: numberValue(row.middleware_event_count as number | string | undefined),
    firstHumanMessage: row.first_human_message == null ? null : String(row.first_human_message),
    lastAiMessage: row.last_ai_message == null ? null : String(row.last_ai_message),
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    metadata: parseJson(row.metadata) as Record<string, unknown>,
  };
}

function rowToRunEvent(row: Record<string, unknown>): RunEvent {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    runId: String(row.run_id),
    eventId: String(row.event_id),
    threadId: String(row.thread_id),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    parentRunId: row.parent_run_id == null ? null : String(row.parent_run_id),
    workflowId: row.workflow_id == null ? null : String(row.workflow_id),
    workflowNodeId: row.workflow_node_id == null ? null : String(row.workflow_node_id),
    sequence: numberValue(row.sequence as number | string | undefined),
    category: row.category as RunEvent['category'],
    type: String(row.type),
    level: row.level as RunEvent['level'],
    message: String(row.message),
    toolName: row.tool_name == null ? null : String(row.tool_name),
    model: row.model == null ? null : String(row.model),
    durationMs: row.duration_ms == null ? null : numberValue(row.duration_ms as number | string | undefined),
    metadata: parseJson(row.metadata) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

function rowToRunFeedback(row: Record<string, unknown>): RunFeedback {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    feedbackId: String(row.feedback_id),
    runId: String(row.run_id),
    threadId: String(row.thread_id),
    rating: numberValue(row.rating as number | string | undefined) as RunFeedback['rating'],
    comment: row.comment == null ? null : String(row.comment),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToMemoryRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    id: String(row.id),
    type: row.type as MemoryRecord['type'],
    text: String(row.text ?? ''),
    status: row.status as MemoryRecord['status'],
    scope: row.scope as MemoryRecord['scope'],
    sourceThreadId: row.source_thread_id == null ? undefined : String(row.source_thread_id),
    sourceTurnIds: parseJsonArray(row.source_turn_ids),
    workspaceRoot: row.workspace_root == null ? undefined : String(row.workspace_root),
    tags: parseJsonArray(row.tags),
    confidence: numberValue(row.confidence as number | string | undefined),
    usageCount: numberValue(row.usage_count as number | string | undefined),
    lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToWorkingSet(row: Record<string, unknown>): ThreadWorkingSetSnapshot {
  return {
    threadId: String(row.thread_id),
    generation: Number(row.generation ?? 0),
    activeEpisodeIds: parseJsonArray(row.active_episode_ids),
    injectedEpisodeIds: parseJsonArray(row.injected_episode_ids),
    frozenPromptBlock: String(row.frozen_prompt_block ?? ''),
    builtFromTurnId: String(row.built_from_turn_id ?? ''),
    builtFromTurnIndex: Number(row.built_from_turn_index ?? -1),
    taskFingerprint: String(row.task_fingerprint ?? ''),
    episodeIdentity: row.episode_identity == null ? undefined : String(row.episode_identity),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function numberValue(value: number | string | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function isActiveThreadItem(item: ThreadItem, activeTurnIds: Set<string>, activeTurnCount: number): boolean {
  const checkpoint = item as ThreadItem & { turnCount?: unknown };
  if (
    (item.type === 'workflow_checkpoint' || item.type === 'project_checkpoint' || item.type === 'rollback_conflict')
    && typeof checkpoint.turnCount === 'number'
  ) {
    return checkpoint.turnCount <= activeTurnCount;
  }
  return activeTurnIds.has(item.turnId);
}
