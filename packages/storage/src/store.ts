import type {
  Checkpoint,
  ThreadId,
  ThreadItem,
  ThreadMeta,
  ThreadSpawnEdge,
  ThreadSpawnEdgeStatus,
  TurnMeta,
  TurnId,
} from '@nexus/protocol';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Abstract SQLite DB handle — callers inject the real better-sqlite3 instance. */
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteStatement {
  run(...params: unknown[]): void;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

// ─── ThreadStore Interface ──────────────────────────────────────────────────
/**
 * The canonical storage boundary for thread metadata and rollout history.
 * - append_items: raw history append — does NOT infer metadata.
 * - update_thread_metadata: the only metadata write path.
 */
export interface ThreadStore {
  appendItems(threadId: ThreadId, items: ThreadItem[]): Promise<void>;

  updateThreadMetadata(
    threadId: ThreadId,
    patch: Partial<Pick<ThreadMeta, 'title' | 'status' | 'turnCount' | 'updatedAt' | 'tags'>>,
  ): Promise<void>;

  createThread(meta: ThreadMeta): Promise<void>;

  getThread(threadId: ThreadId): Promise<ThreadMeta | null>;

  listThreads(filter?: { status?: ThreadMeta['status']; limit?: number }): Promise<ThreadMeta[]>;

  /** Delete thread metadata, turns, and rollout history. */
  deleteThread(threadId: ThreadId): Promise<void>;

  getItems(threadId: ThreadId, since?: number): Promise<ThreadItem[]>;

  /** Get all turns for a thread. */
  getTurns(threadId: ThreadId): Promise<TurnMeta[]>;

  /** Persist a turn. */
  saveTurn(turn: TurnMeta): Promise<void>;

  /** Get recent items for constructing model context. */
  getRecentItems(threadId: ThreadId, maxItems?: number): Promise<ThreadItem[]>;

  /** Get the last checkpoint written for a thread. */
  getLastCheckpoint(threadId: ThreadId): Promise<Checkpoint | null>;

  /** Write a checkpoint line directly to JSONL (not via item append). */
  appendCheckpoint(threadId: ThreadId, ckpt: Checkpoint): Promise<void>;

  /** Read a JSON setting from SQLite. */
  getSetting<T = unknown>(key: string): Promise<T | null>;

  /** Persist a JSON setting to SQLite. */
  setSetting(key: string, value: unknown): Promise<void>;

  /** Compact rollout JSONL by removing items before the latest checkpoint item index. */
  compactRollout?(threadId: ThreadId, options?: { keepLastCheckpoints?: number }): Promise<{
    beforeLines: number;
    afterLines: number;
    removedItems: number;
  }>;

  /** Persist or reopen a parent -> child spawned-agent edge. */
  upsertThreadSpawnEdge(edge: ThreadSpawnEdge): Promise<void>;

  /** Mark a spawned-agent edge open/closed. */
  setThreadSpawnEdgeStatus(
    parentThreadId: ThreadId,
    childThreadId: ThreadId,
    status: ThreadSpawnEdgeStatus,
  ): Promise<void>;

  /** List direct spawned children for a parent thread. */
  listThreadSpawnChildren(
    parentThreadId: ThreadId,
    status?: ThreadSpawnEdgeStatus,
  ): Promise<ThreadSpawnEdge[]>;

  /** Walk the spawned-agent tree beneath a parent thread. */
  listThreadSpawnDescendants(
    parentThreadId: ThreadId,
    status?: ThreadSpawnEdgeStatus,
  ): Promise<ThreadSpawnEdge[]>;
}

// ─── LocalThreadStore (SQLite + JSONL) ──────────────────────────────────────
export class LocalThreadStore implements ThreadStore {
  private db: SqliteDb;
  private rolloutDir: string;
  private sqlitePath: string;

  constructor(db: SqliteDb, dataDir: string) {
    this.db = db;
    this.sqlitePath = path.join(dataDir, 'threads.db');
    this.rolloutDir = path.join(dataDir, 'rollouts');
    this.initSchema();
  }

  private initSchema(): void {
    const now = new Date().toISOString();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        turn_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        ephemeral INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '{}',
        parent_thread_id TEXT,
        agent_nickname TEXT,
        agent_role TEXT
      );

      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id),
        turn_index INTEGER NOT NULL,
        user_input TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(thread_id, turn_index);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (parent_thread_id, child_thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_spawn_edges_parent
        ON thread_spawn_edges(parent_thread_id, status);
    `);
    this.addColumnIfMissing('threads', 'parent_thread_id', 'TEXT');
    this.addColumnIfMissing('threads', 'agent_nickname', 'TEXT');
    this.addColumnIfMissing('threads', 'agent_role', 'TEXT');
    this.db
      .prepare('INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(1, 'initial_thread_store_schema', now);
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('storage.schemaVersion', JSON.stringify({ version: 1 }), now);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  async createThread(meta: ThreadMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, title, workspace_root, status, turn_count, created_at, updated_at, archived_at, ephemeral, tags, parent_thread_id, agent_nickname, agent_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.threadId,
        meta.title,
        meta.workspaceRoot,
        meta.status,
        meta.turnCount,
        meta.createdAt,
        meta.updatedAt,
        meta.archivedAt,
        meta.ephemeral ? 1 : 0,
        JSON.stringify(meta.tags),
        meta.parentThreadId ?? null,
        meta.agentNickname ?? null,
        meta.agentRole ?? null,
      );
  }

  async getThread(threadId: ThreadId): Promise<ThreadMeta | null> {
    const row = this.db
      .prepare('SELECT * FROM threads WHERE thread_id = ?')
      .get(threadId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToMeta(row);
  }

  async listThreads(filter?: {
    status?: ThreadMeta['status'];
    limit?: number;
  }): Promise<ThreadMeta[]> {
    let sql = 'SELECT * FROM threads';
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ' WHERE status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY updated_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToMeta);
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    this.db.prepare('DELETE FROM thread_spawn_edges WHERE parent_thread_id = ? OR child_thread_id = ?').run(threadId, threadId);
    this.db.prepare('DELETE FROM turns WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM threads WHERE thread_id = ?').run(threadId);
    await fs.rm(path.join(this.rolloutDir, `${threadId}.jsonl`), { force: true });
  }

  async updateThreadMetadata(
    threadId: ThreadId,
    patch: Partial<
      Pick<ThreadMeta, 'title' | 'status' | 'turnCount' | 'updatedAt' | 'tags'>
    >,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.turnCount !== undefined) {
      sets.push('turn_count = ?');
      params.push(patch.turnCount);
    }
    if (patch.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      params.push(patch.updatedAt);
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(patch.tags));
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(threadId);
    this.db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE thread_id = ?`).run(...params);
  }

  async appendItems(threadId: ThreadId, items: ThreadItem[]): Promise<void> {
    // Append to JSONL rollout
    const rolloutPath = path.join(this.rolloutDir, `${threadId}.jsonl`);
    await fs.mkdir(this.rolloutDir, { recursive: true });
    const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
    await fs.appendFile(rolloutPath, lines, 'utf-8');
  }

  async getItems(threadId: ThreadId, since?: number): Promise<ThreadItem[]> {
    const rolloutPath = path.join(this.rolloutDir, `${threadId}.jsonl`);
    let content: string;
    try {
      content = await fs.readFile(rolloutPath, 'utf-8');
    } catch {
      return [];
    }
    const lines = content.split('\n').filter((l) => l.trim());
    const items: ThreadItem[] = [];
    for (let i = since ?? 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        // Skip checkpoint lines — they are not ThreadItems
        if (parsed.type === '__checkpoint__') continue;
        items.push(parsed as ThreadItem);
      } catch {
        // skip malformed lines
      }
    }
    return items;
  }

  async getRecentItems(threadId: ThreadId, maxItems: number = 100): Promise<ThreadItem[]> {
    const all = await this.getItems(threadId);
    return all.slice(-maxItems);
  }

  async getTurns(threadId: ThreadId): Promise<TurnMeta[]> {
    const rows = this.db
      .prepare('SELECT * FROM turns WHERE thread_id = ? ORDER BY turn_index')
      .all(threadId) as Record<string, unknown>[];
    return rows.map((r) => ({
      turnId: r.turn_id as string,
      threadId: r.thread_id as string,
      index: r.turn_index as number,
      userInput: JSON.parse(r.user_input as string),
      status: r.status as TurnMeta['status'],
      startedAt: r.started_at as string,
      completedAt: r.completed_at as string | null,
    }));
  }

  async appendCheckpoint(threadId: ThreadId, ckpt: Checkpoint): Promise<void> {
    const rolloutPath = path.join(this.rolloutDir, `${threadId}.jsonl`);
    await fs.mkdir(this.rolloutDir, { recursive: true });
    const line = JSON.stringify({
      type: '__checkpoint__',
      threadId: ckpt.threadId,
      turnId: ckpt.turnId,
      itemIndex: ckpt.itemIndex,
      timestamp: ckpt.timestamp,
      generation: ckpt.generation,
      status: ckpt.status,
      expiresAt: ckpt.expiresAt,
    }) + '\n';
    await fs.appendFile(rolloutPath, line, 'utf-8');
  }

  async getLastCheckpoint(threadId: ThreadId): Promise<Checkpoint | null> {
    const rolloutPath = path.join(this.rolloutDir, `${threadId}.jsonl`);
    let content: string;
    try {
      content = await fs.readFile(rolloutPath, 'utf-8');
    } catch {
      return null;
    }
    const lines = content.split('\n');
    // Scan backwards for the last checkpoint line (independent of items)
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === '__checkpoint__') {
          return {
            threadId: parsed.threadId,
            turnId: parsed.turnId,
            itemIndex: parsed.itemIndex,
            timestamp: parsed.timestamp,
            generation: parsed.generation,
            status: parsed.status,
            expiresAt: parsed.expiresAt,
          };
        }
      } catch { /* skip */ }
    }
    return null;
  }

  async saveTurn(turn: TurnMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO turns (turn_id, thread_id, turn_index, user_input, status, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.turnId,
        turn.threadId,
        turn.index,
        JSON.stringify(turn.userInput),
        turn.status,
        turn.startedAt,
        turn.completedAt,
      );
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  async compactRollout(threadId: ThreadId, options: { keepLastCheckpoints?: number } = {}): Promise<{
    beforeLines: number;
    afterLines: number;
    removedItems: number;
  }> {
    const rolloutPath = path.join(this.rolloutDir, `${threadId}.jsonl`);
    let content: string;
    try {
      content = await fs.readFile(rolloutPath, 'utf-8');
    } catch {
      return { beforeLines: 0, afterLines: 0, removedItems: 0 };
    }

    const rawLines = content.split('\n').filter((line) => line.trim());
    const checkpoints: Array<{ line: string; itemIndex: number; lineIndex: number }> = [];
    const parsedLines = rawLines.map((line, lineIndex) => {
      try {
        const parsed = JSON.parse(line) as { type?: string; itemIndex?: number };
        if (parsed.type === '__checkpoint__' && typeof parsed.itemIndex === 'number') {
          checkpoints.push({ line, itemIndex: parsed.itemIndex, lineIndex });
        }
        return parsed;
      } catch {
        return null;
      }
    });

    const latest = checkpoints.at(-1);
    if (!latest) {
      return { beforeLines: rawLines.length, afterLines: rawLines.length, removedItems: 0 };
    }

    const keepCheckpointCount = Math.max(1, Math.floor(options.keepLastCheckpoints ?? 1));
    const checkpointLines = new Set(checkpoints.slice(-keepCheckpointCount).map((checkpoint) => checkpoint.lineIndex));
    const nextLines: string[] = [];
    let itemIndex = 0;
    let removedItems = 0;

    for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
      const parsed = parsedLines[lineIndex];
      if (parsed && parsed.type === '__checkpoint__') {
        if (checkpointLines.has(lineIndex)) nextLines.push(rawLines[lineIndex]);
        continue;
      }

      const currentItemIndex = itemIndex;
      itemIndex += 1;
      if (currentItemIndex >= latest.itemIndex) {
        nextLines.push(rawLines[lineIndex]);
      } else {
        removedItems += 1;
      }
    }

    await fs.mkdir(this.rolloutDir, { recursive: true });
    await fs.writeFile(rolloutPath, nextLines.join('\n') + (nextLines.length ? '\n' : ''), 'utf-8');
    return { beforeLines: rawLines.length, afterLines: nextLines.length, removedItems };
  }

  async upsertThreadSpawnEdge(edge: ThreadSpawnEdge): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(parent_thread_id, child_thread_id)
         DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(edge.parentThreadId, edge.childThreadId, edge.status, edge.createdAt, edge.updatedAt);
  }

  async setThreadSpawnEdgeStatus(
    parentThreadId: ThreadId,
    childThreadId: ThreadId,
    status: ThreadSpawnEdgeStatus,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE thread_spawn_edges
         SET status = ?, updated_at = ?
         WHERE parent_thread_id = ? AND child_thread_id = ?`,
      )
      .run(status, new Date().toISOString(), parentThreadId, childThreadId);
  }

  async listThreadSpawnChildren(
    parentThreadId: ThreadId,
    status?: ThreadSpawnEdgeStatus,
  ): Promise<ThreadSpawnEdge[]> {
    let sql = 'SELECT * FROM thread_spawn_edges WHERE parent_thread_id = ?';
    const params: unknown[] = [parentThreadId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at ASC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToSpawnEdge);
  }

  async listThreadSpawnDescendants(
    parentThreadId: ThreadId,
    status?: ThreadSpawnEdgeStatus,
  ): Promise<ThreadSpawnEdge[]> {
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
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function rowToMeta(row: Record<string, unknown>): ThreadMeta {
  return {
    threadId: row.thread_id as string,
    title: row.title as string,
    workspaceRoot: row.workspace_root as string,
    status: row.status as ThreadMeta['status'],
    turnCount: row.turn_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archivedAt: row.archived_at as string | null,
    ephemeral: !!(row.ephemeral as number),
    tags: JSON.parse(row.tags as string),
    parentThreadId: (row.parent_thread_id as string | null | undefined) ?? null,
    agentNickname: (row.agent_nickname as string | null | undefined) ?? null,
    agentRole: (row.agent_role as string | null | undefined) ?? null,
  };
}

function rowToSpawnEdge(row: Record<string, unknown>): ThreadSpawnEdge {
  return {
    parentThreadId: row.parent_thread_id as string,
    childThreadId: row.child_thread_id as string,
    status: row.status as ThreadSpawnEdgeStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
