export interface KnowledgeBaseSummary {
  knowledgeBaseId: string;
  source?: { kind: 'directory'; grantId?: string; canonicalPath: string; authorizedAt: string };
  name: string;
  status: 'active' | 'syncing' | 'blocked' | 'deleted';
  currentSnapshotId?: string;
  updatedAt: string;
  version: number;
}

export interface KnowledgeSnapshotSummary {
  snapshotId: string;
  knowledgeBaseId: string;
  status: 'building' | 'ready' | 'failed';
  immutable: boolean;
  indexVersion: string;
  redactionVersion?: string;
  createdAt: string;
  completedAt?: string;
  sources?: unknown[];
  pages?: unknown[];
  chunks?: unknown[];
  graph?: KnowledgeWikiGraph;
  indexStats?: {
    indexedFiles: number;
    indexedBytes: number;
    skippedFiles: number;
    skippedBytes: number;
    truncated: boolean;
    skippedReasons?: Array<{ path: string; reason: string; bytes?: number }>;
    redactionFailed?: number;
  };
}

export type KnowledgeCompileJobStatus = 'queued' | 'scanning' | 'extracting' | 'indexing' | 'finalizing' | 'completed' | 'paused' | 'cancelled' | 'failed';

export interface KnowledgeCompileJob {
  jobId: string;
  knowledgeBaseId: string;
  kind: 'create' | 'sync';
  status: KnowledgeCompileJobStatus;
  stage: KnowledgeCompileJobStatus;
  sourceGrantId: string;
  canonicalRoot: string;
  persistPending: boolean;
  currentFile?: string;
  totalFiles: number;
  processedFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  indexedBytes: number;
  skippedBytes: number;
  truncated: boolean;
  errors: Array<{ at: string; stage: KnowledgeCompileJobStatus; relativePath?: string; code: string; message: string }>;
  pendingFiles?: Array<{ relativePath: string; sizeBytes: number; contentHash?: string; stage: string; failure?: string }>;
  requestedAction?: 'pause' | 'cancel';
  snapshotId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface KnowledgeWikiGraphNode {
  pageId: string;
  slug: string;
  title: string;
  relativePath: string;
  pageDirectory: string;
}

export interface KnowledgeWikiGraphEdge {
  sourcePageId: string;
  targetSlug: string;
  targetPageId?: string;
  targetDisplay?: string;
  resolved: boolean;
}

export interface KnowledgeWikiGraph {
  nodes: KnowledgeWikiGraphNode[];
  edges: KnowledgeWikiGraphEdge[];
}

export interface KnowledgeBaseDetail {
  knowledgeBase: KnowledgeBaseSummary;
  snapshot: KnowledgeSnapshotSummary | null;
  job?: KnowledgeCompileJob | null;
}

export interface KnowledgePageSummary {
  pageId: string;
  title: string;
  relativePath: string;
  summary?: string;
  tags?: string[];
}

export interface KnowledgeReceiptReplay {
  receipt: {
    receiptId: string;
    knowledgeBaseIds: string[];
    snapshotIds: string[];
    normalizedQueryHash: string;
    queryVersion: string;
    truncated: boolean;
    truncationReasons: string[];
    createdAt: string;
  };
  hits: Array<{ chunkId: string; relativePath: string; text: string; heading?: string; snapshotId?: string }>;
}

export interface KnowledgeScopeSelection {
  knowledgeBaseIds: string[];
  snapshotIds: string[];
  indexVersion?: string;
}

export interface KnowledgeDirectoryGrant {
  grantId: string;
  kind: 'directory';
  canonicalPath: string;
  authorizedAt: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data as { error?: { message?: string } };
    throw new Error(error.error?.message ?? `Knowledge request failed (${response.status})`);
  }
  return data as T;
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
  const response = await fetch('/api/knowledge-bases');
  const data = await readJson<{ knowledgeBases?: KnowledgeBaseSummary[] }>(response);
  return data.knowledgeBases ?? [];
}

export async function getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseDetail> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`);
  return readJson<KnowledgeBaseDetail>(response);
}

export async function authorizeKnowledgeDirectory(): Promise<KnowledgeDirectoryGrant | null> {
  const response = await fetch('/api/knowledge/authorize-directory', { method: 'POST' });
  const data = await readJson<{ cancelled?: boolean; sourceGrant?: KnowledgeDirectoryGrant }>(response);
  return data.cancelled || !data.sourceGrant ? null : data.sourceGrant;
}

export async function createKnowledgeBase(name: string, sourceGrantId: string, persistPending = false): Promise<KnowledgeBaseDetail> {
  const response = await fetch('/api/knowledge-bases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sourceGrantId, persistPending }),
  });
  return normalizeDetail(await readJson<{ knowledgeBase?: KnowledgeBaseSummary; base?: KnowledgeBaseSummary; snapshot?: KnowledgeSnapshotSummary | null; job?: KnowledgeCompileJob | null }>(response));
}

export async function syncKnowledgeBase(knowledgeBaseId: string, persistPending = false): Promise<KnowledgeBaseDetail> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persistPending }) });
  return normalizeDetail(await readJson<{ knowledgeBase?: KnowledgeBaseSummary; base?: KnowledgeBaseSummary; snapshot?: KnowledgeSnapshotSummary | null; job?: KnowledgeCompileJob | null }>(response));
}

export async function getKnowledgeJob(jobId: string): Promise<KnowledgeCompileJob> {
  const response = await fetch(`/api/knowledge-jobs/${encodeURIComponent(jobId)}`);
  const data = await readJson<{ job?: KnowledgeCompileJob }>(response);
  if (!data.job) throw new Error('Knowledge compile job response is missing its job');
  return data.job;
}

export async function actOnKnowledgeJob(jobId: string, action: 'pause' | 'resume' | 'cancel'): Promise<KnowledgeCompileJob> {
  const response = await fetch(`/api/knowledge-jobs/${encodeURIComponent(jobId)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await readJson<{ job?: KnowledgeCompileJob }>(response);
  if (!data.job) throw new Error('Knowledge compile job response is missing its job');
  return data.job;
}

export async function renameKnowledgeBase(knowledgeBaseId: string, name: string): Promise<KnowledgeBaseSummary> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await readJson<{ knowledgeBase?: KnowledgeBaseSummary }>(response);
  if (!data.knowledgeBase) throw new Error('Knowledge base response is missing its catalog entry');
  return data.knowledgeBase;
}

export async function deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, { method: 'DELETE' });
  await readJson<Record<string, never>>(response);
}

export async function listKnowledgePages(knowledgeBaseId: string): Promise<KnowledgePageSummary[]> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/pages`);
  const data = await readJson<{ pages?: KnowledgePageSummary[] }>(response);
  return data.pages ?? [];
}

export async function getKnowledgePage(knowledgeBaseId: string, pageId: string): Promise<KnowledgePageSummary & { body: string }> {
  const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/pages/${encodeURIComponent(pageId)}`);
  const data = await readJson<{ page: KnowledgePageSummary & { body: string } }>(response);
  return data.page;
}

export async function queryKnowledgeBases(input: { knowledgeBaseIds: string[]; snapshotIds: string[]; query: string; maxHits?: number }): Promise<{ receipt: { receiptId: string }; hits: Array<{ chunkId: string; relativePath: string; text: string; heading?: string }> }> {
  const response = await fetch('/api/knowledge/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function replayKnowledgeReceipt(receiptId: string): Promise<KnowledgeReceiptReplay> {
  const response = await fetch(`/api/knowledge/receipts/${encodeURIComponent(receiptId)}`);
  return readJson<KnowledgeReceiptReplay>(response);
}

function normalizeDetail(data: { knowledgeBase?: KnowledgeBaseSummary; base?: KnowledgeBaseSummary; snapshot?: KnowledgeSnapshotSummary | null; job?: KnowledgeCompileJob | null }): KnowledgeBaseDetail {
  const knowledgeBase = data.knowledgeBase ?? data.base;
  if (!knowledgeBase) throw new Error('Knowledge base response is missing its catalog entry');
  return { knowledgeBase, snapshot: data.snapshot ?? null, job: data.job ?? null };
}
