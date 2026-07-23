# File Knowledge Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Nexus 增加文件/文档知识生命周期能力，避免 Agent 静默复用过期 docx/pdf/xlsx/pptx 提取物，并让活动栏、运行监控、涉及文件摘要都能显示真实源文件和刷新状态。

**Architecture:** 协议层定义文件指纹、文档 artifact 和 freshness 结果；工具层负责计算指纹、维护 `.nexus/artifacts/index.json`、提供 `read_document` 和 `read_file` 保护；runtime 在每次模型迭代前做轻量 freshness preflight，并把文件生命周期事件写入 trace；web/desktop 只消费结构化 metadata，不再靠命令文本猜主路径。

**Tech Stack:** TypeScript, Node.js `fs/path/crypto`, Vitest, Zod, `mammoth`, `xlsx`, `jszip`, `pdf-parse`, React web + desktop shared UI.

---

## 现状地图

- `packages/tools/src/builtin.ts`：已有 `read_file`，返回 `data.path/startLine/endLine/artifactRefs`，但没有完整文件指纹，也没有 `read_document`。
- `packages/tools/src/registry.ts`：工具执行统一走 `ToolRegistry.execute()`，结果超过长度会截断并把 truncation metadata 合并到 `data`。
- `packages/runtime/src/agent.ts`：
  - `agentLoop()` 每次模型迭代前可以插入 freshness preflight。
  - `executeToolCall()` 创建 tool item、执行工具、持久化 item、写 run monitor event。
  - `createProjectCheckpointItem()` 创建工程 checkpoint，可以追加紧凑 `knowledge` 字段。
- `packages/protocol/src/runTrace.ts` / `runTraceSchemas.ts`：`file` trace 目前只有 `read/write/patch/delete/checkpoint`。
- `packages/runtime/src/runTraceProjector.ts`：`RunTraceSummary.files` 现在只统计 changed/addedLines/removedLines。
- `apps/web/src/features/chat/turnFileSummary.ts` 和 `apps/desktop/src/features/chat/turnFileSummary.ts`：涉及文件摘要优先识别 `read_file`，然后从 shell command 字符串兜底猜路径；这正是 `open(E:\...)`、`p.text.strip` 假路径的来源之一。
- `apps/web/src/features/monitor/traceFormatters.ts` 和 desktop 同名文件：file trace 摘要只显示 action/path。
- `apps/web/src/components/workbench/LiveActivityHud.tsx` 和 desktop 同名文件：最近事件已经能显示 resource，但还没有 document lifecycle 专用文案。

## 范围决策

- 托管 artifact stale：fail closed。`read_file` 读取 `.nexus/artifacts/documents/*` 且账本判断 stale 时，返回失败，不给旧内容。
- 非托管旧 helper 文件：允许读取，但返回 `data.freshness.status = "unmanaged_warning"`，并建议用 `read_document` 读取源文档。
- 第一版使用 workspace 内 `.nexus/artifacts/index.json` 作为账本；不接数据库迁移。
- `.nexus/artifacts` 不进入普通工程 checkpoint 文件快照。
- `read_document` 支持 `.docx/.pdf/.xlsx/.pptx`；`.txt/.md/.json/.ts` 等文本仍走 `read_file`。
- web 和 desktop 保持文件同步；每个 UI/summary 修改必须改两份同名文件和测试。

---

### Task 1: 协议类型、Zod schema 和 trace 文件动作

**Files:**
- Create: `packages/protocol/src/fileKnowledge.ts`
- Create: `packages/protocol/src/fileKnowledgeSchemas.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/types.ts`
- Modify: `packages/protocol/src/schemas.ts`
- Modify: `packages/protocol/src/runTrace.ts`
- Modify: `packages/protocol/src/runTraceSchemas.ts`
- Modify: `packages/protocol/src/runTraceSchemas.test.ts`
- Test: `packages/protocol/src/fileKnowledgeSchemas.test.ts`

- [ ] **Step 1: 写 failing schema 测试**

Add `packages/protocol/src/fileKnowledgeSchemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  documentArtifactRecordSchema,
  fileFingerprintSchema,
  fileFreshnessSchema,
} from './fileKnowledgeSchemas.js';

describe('file knowledge schemas', () => {
  it('validates a complete file fingerprint', () => {
    const parsed = fileFingerprintSchema.parse({
      path: 'E:\\langchain\\Nexus\\docs\\a.docx',
      relativePath: 'docs/a.docx',
      workspaceRoot: 'E:\\langchain\\Nexus',
      sizeBytes: 128,
      mtimeMs: 123456,
      sha256: 'a'.repeat(64),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      observedAt: '2026-07-23T08:00:00.000Z',
    });

    expect(parsed.relativePath).toBe('docs/a.docx');
  });

  it('validates a document artifact record with source lineage', () => {
    const parsed = documentArtifactRecordSchema.parse({
      artifactPath: 'E:\\langchain\\Nexus\\.nexus\\artifacts\\documents\\abc.md',
      artifactRelativePath: '.nexus/artifacts/documents/abc.md',
      artifactHash: 'b'.repeat(64),
      artifactKind: 'document_text',
      sourcePath: 'E:\\langchain\\Nexus\\a.docx',
      sourceRelativePath: 'a.docx',
      sourceHash: 'c'.repeat(64),
      sourceSizeBytes: 2048,
      sourceMtimeMs: 123456,
      extractor: 'docx-text',
      extractorVersion: '1',
      createdAt: '2026-07-23T08:00:00.000Z',
    });

    expect(parsed.artifactKind).toBe('document_text');
  });

  it('validates stale freshness decisions', () => {
    const parsed = fileFreshnessSchema.parse({
      status: 'stale',
      sourcePath: 'E:\\langchain\\Nexus\\a.docx',
      artifactPath: 'E:\\langchain\\Nexus\\.nexus\\artifacts\\documents\\abc.md',
      reason: 'source_hash_changed',
      recommendedTool: 'read_document',
    });

    expect(parsed.reason).toBe('source_hash_changed');
  });
});
```

Modify `packages/protocol/src/runTraceSchemas.test.ts` with this test:

```ts
it('accepts document lifecycle file trace payloads', () => {
  const parsed = runTraceEnvelopeSchema.parse({
    version: 2,
    eventId: 'event-1',
    sequence: 1,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: 'span-1',
    category: 'file',
    name: 'document refreshed',
    lifecycle: 'completed',
    level: 'info',
    occurredAt: '2026-07-23T08:00:00.000Z',
    payload: {
      action: 'refresh',
      path: 'docs/a.docx',
      sourcePath: 'docs/a.docx',
      artifactPath: '.nexus/artifacts/documents/abc.md',
      sha256: 'a'.repeat(64),
      artifactSha256: 'b'.repeat(64),
      staleReason: 'source_hash_changed',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractor: 'docx-text',
    },
  });

  expect(parsed.payload.action).toBe('refresh');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run packages/protocol/src/fileKnowledgeSchemas.test.ts packages/protocol/src/runTraceSchemas.test.ts
```

Expected: FAIL，原因是 `fileKnowledgeSchemas.ts` 不存在，`file` trace action 不接受 `extract/stale/refresh/reuse`。

- [ ] **Step 3: 增加协议类型**

Create `packages/protocol/src/fileKnowledge.ts`:

```ts
export type DocumentArtifactKind = 'document_text';

export type DocumentExtractor =
  | 'docx-text'
  | 'pdf-text'
  | 'xlsx-text'
  | 'pptx-text';

export type FileFreshnessReason =
  | 'source_hash_changed'
  | 'source_missing'
  | 'artifact_missing'
  | 'extractor_version_changed'
  | 'unmanaged_artifact';

export interface FileFingerprint {
  path: string;
  relativePath?: string;
  workspaceRoot?: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  contentType: string;
  observedAt: string;
}

export interface DocumentArtifactRecord {
  artifactPath: string;
  artifactRelativePath?: string;
  artifactHash: string;
  artifactKind: DocumentArtifactKind;
  sourcePath: string;
  sourceRelativePath?: string;
  sourceHash: string;
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  extractor: DocumentExtractor;
  extractorVersion: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface DocumentArtifactResult {
  source: FileFingerprint;
  artifact: {
    path: string;
    relativePath?: string;
    kind: DocumentArtifactKind;
    sha256: string;
    createdAt: string;
    extractor: DocumentExtractor;
    extractorVersion: string;
  };
  stale: boolean;
  reused: boolean;
  textPreview: string;
}

export interface FileFreshness {
  status: 'fresh' | 'stale' | 'missing' | 'unmanaged_warning';
  sourcePath?: string;
  artifactPath?: string;
  reason?: FileFreshnessReason;
  recommendedTool?: 'read_document';
}

export interface KnowledgeCheckpointSummary {
  observedFiles: Array<Pick<FileFingerprint, 'path' | 'sha256' | 'mtimeMs' | 'sizeBytes'>>;
  documentArtifacts: Array<Pick<DocumentArtifactRecord, 'artifactPath' | 'sourcePath' | 'sourceHash' | 'artifactHash'>>;
}
```

Create `packages/protocol/src/fileKnowledgeSchemas.ts`:

```ts
import { z } from 'zod';

export const documentExtractorSchema = z.enum(['docx-text', 'pdf-text', 'xlsx-text', 'pptx-text']);
export const documentArtifactKindSchema = z.enum(['document_text']);
export const fileFreshnessReasonSchema = z.enum([
  'source_hash_changed',
  'source_missing',
  'artifact_missing',
  'extractor_version_changed',
  'unmanaged_artifact',
]);

export const fileFingerprintSchema = z.object({
  path: z.string().min(1),
  relativePath: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  sizeBytes: z.number().int().min(0),
  mtimeMs: z.number().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().min(1),
  observedAt: z.string().min(1),
}).strict();

export const documentArtifactRecordSchema = z.object({
  artifactPath: z.string().min(1),
  artifactRelativePath: z.string().min(1).optional(),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactKind: documentArtifactKindSchema,
  sourcePath: z.string().min(1),
  sourceRelativePath: z.string().min(1).optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSizeBytes: z.number().int().min(0),
  sourceMtimeMs: z.number().min(0),
  extractor: documentExtractorSchema,
  extractorVersion: z.string().min(1),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().min(1).optional(),
}).strict();

export const documentArtifactResultSchema = z.object({
  source: fileFingerprintSchema,
  artifact: z.object({
    path: z.string().min(1),
    relativePath: z.string().min(1).optional(),
    kind: documentArtifactKindSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().min(1),
    extractor: documentExtractorSchema,
    extractorVersion: z.string().min(1),
  }).strict(),
  stale: z.boolean(),
  reused: z.boolean(),
  textPreview: z.string(),
}).strict();

export const fileFreshnessSchema = z.object({
  status: z.enum(['fresh', 'stale', 'missing', 'unmanaged_warning']),
  sourcePath: z.string().min(1).optional(),
  artifactPath: z.string().min(1).optional(),
  reason: fileFreshnessReasonSchema.optional(),
  recommendedTool: z.literal('read_document').optional(),
}).strict();

export const knowledgeCheckpointSummarySchema = z.object({
  observedFiles: z.array(fileFingerprintSchema.pick({
    path: true,
    sha256: true,
    mtimeMs: true,
    sizeBytes: true,
  })),
  documentArtifacts: z.array(documentArtifactRecordSchema.pick({
    artifactPath: true,
    sourcePath: true,
    sourceHash: true,
    artifactHash: true,
  })),
}).strict();
```

Modify `packages/protocol/src/index.ts`:

```ts
export * from './fileKnowledge.js';
export * from './fileKnowledgeSchemas.js';
```

Add the exports next to the existing `runTrace` exports.

- [ ] **Step 4: 扩展 checkpoint 和 trace 类型**

Modify `packages/protocol/src/types.ts`:

```ts
import type { KnowledgeCheckpointSummary } from './fileKnowledge.js';
```

Add to `ProjectCheckpointItem`:

```ts
knowledge?: KnowledgeCheckpointSummary;
```

Modify `packages/protocol/src/schemas.ts`:

```ts
import { knowledgeCheckpointSummarySchema } from './fileKnowledgeSchemas.js';
```

Add to `projectCheckpointItemSchema`:

```ts
knowledge: knowledgeCheckpointSummarySchema.optional(),
```

Modify `packages/protocol/src/runTrace.ts` `RunTracePayloadMap.file`:

```ts
file: {
  action: 'read' | 'write' | 'patch' | 'delete' | 'checkpoint' | 'extract' | 'stale' | 'refresh' | 'reuse';
  path: string;
  sourcePath?: string;
  artifactPath?: string;
  sha256?: string;
  artifactSha256?: string;
  staleReason?: string;
  contentType?: string;
  extractor?: string;
  addedLines?: number;
  removedLines?: number;
};
```

Modify `packages/protocol/src/runTraceSchemas.ts` `filePayloadSchema`:

```ts
const filePayloadSchema = z.object({
  action: z.enum(['read', 'write', 'patch', 'delete', 'checkpoint', 'extract', 'stale', 'refresh', 'reuse']),
  path: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  artifactPath: z.string().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  staleReason: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  extractor: z.string().min(1).optional(),
  addedLines: z.number().int().min(0).optional(),
  removedLines: z.number().int().min(0).optional(),
}).strict();
```

- [ ] **Step 5: 运行协议测试并提交**

Run:

```bash
npx vitest run packages/protocol/src/fileKnowledgeSchemas.test.ts packages/protocol/src/runTraceSchemas.test.ts
npx tsc -b
```

Expected: PASS，`tsc` 0 errors。

Commit:

```bash
git add packages/protocol/src/fileKnowledge.ts packages/protocol/src/fileKnowledgeSchemas.ts packages/protocol/src/fileKnowledgeSchemas.test.ts packages/protocol/src/index.ts packages/protocol/src/types.ts packages/protocol/src/schemas.ts packages/protocol/src/runTrace.ts packages/protocol/src/runTraceSchemas.ts packages/protocol/src/runTraceSchemas.test.ts
git commit -m "feat(protocol): add file knowledge lifecycle types"
```

---

### Task 2: 工具包依赖和文件指纹工具

**Files:**
- Modify: `packages/tools/package.json`
- Create: `packages/tools/src/fileKnowledge.ts`
- Create: `packages/tools/src/fileKnowledge.test.ts`

- [ ] **Step 1: 声明文档提取依赖**

Run:

```bash
npm install --workspace @nexus/tools mammoth xlsx jszip pdf-parse
```

Expected: `packages/tools/package.json` 出现这些 dependencies，`package-lock.json` 更新。

If `pdf-parse` lacks TypeScript declarations during `tsc`, create `packages/tools/src/pdf-parse.d.ts`:

```ts
declare module 'pdf-parse' {
  export interface PdfParseResult {
    text: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }

  export default function pdfParse(data: Buffer): Promise<PdfParseResult>;
}
```

- [ ] **Step 2: 写 failing 指纹测试**

Create `packages/tools/src/fileKnowledge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { computeFileFingerprint, detectContentType, isDocumentFile } from './fileKnowledge.js';

describe('file knowledge fingerprinting', () => {
  it('computes full-file sha256, relative path, size and mtime', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-fingerprint-'));
    const filePath = path.join(root, 'docs', 'a.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '中文内容\nsecond line\n', 'utf-8');

    const fp = await computeFileFingerprint(root, 'docs/a.md');

    expect(fp.path).toBe(filePath);
    expect(fp.relativePath).toBe('docs/a.md');
    expect(fp.workspaceRoot).toBe(root);
    expect(fp.sizeBytes).toBe(Buffer.byteLength('中文内容\nsecond line\n'));
    expect(fp.sha256).toBe(createHash('sha256').update('中文内容\nsecond line\n').digest('hex'));
    expect(fp.contentType).toBe('text/markdown');
    expect(Date.parse(fp.observedAt)).toBeGreaterThan(0);
  });

  it('detects document content types from extension', () => {
    expect(detectContentType('a.docx')).toContain('wordprocessingml');
    expect(detectContentType('b.pdf')).toBe('application/pdf');
    expect(detectContentType('c.xlsx')).toContain('spreadsheetml');
    expect(detectContentType('d.pptx')).toContain('presentationml');
    expect(isDocumentFile('a.docx')).toBe(true);
    expect(isDocumentFile('a.md')).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npx vitest run packages/tools/src/fileKnowledge.test.ts
```

Expected: FAIL，原因是 `computeFileFingerprint` 不存在。

- [ ] **Step 4: 实现指纹工具**

Create `packages/tools/src/fileKnowledge.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { FileFingerprint } from '@nexus/protocol';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export async function computeFileFingerprint(workspaceRoot: string, inputPath: string): Promise<FileFingerprint> {
  const absolutePath = resolveWorkspacePath(workspaceRoot, inputPath);
  const buffer = await fs.readFile(absolutePath);
  const stat = await fs.stat(absolutePath);
  const relativePath = path.relative(path.resolve(workspaceRoot), absolutePath).replace(/\\/g, '/');
  return {
    path: absolutePath,
    relativePath: relativePath && !relativePath.startsWith('..') ? relativePath : undefined,
    workspaceRoot: workspaceRoot ? path.resolve(workspaceRoot) : undefined,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    contentType: detectContentType(absolutePath),
    observedAt: new Date().toISOString(),
  };
}

export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) return path.resolve(inputPath);
  return path.resolve(workspaceRoot, inputPath);
}

export function detectContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.docx': return DOCX_TYPE;
    case '.pdf': return 'application/pdf';
    case '.xlsx': return XLSX_TYPE;
    case '.pptx': return PPTX_TYPE;
    case '.md':
    case '.markdown': return 'text/markdown';
    case '.json': return 'application/json';
    case '.html':
    case '.htm': return 'text/html';
    case '.csv': return 'text/csv';
    case '.txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

export function isDocumentFile(filePath: string): boolean {
  return ['.docx', '.pdf', '.xlsx', '.pptx'].includes(path.extname(filePath).toLowerCase());
}

export function artifactDocumentsDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), '.nexus', 'artifacts', 'documents');
}

export function artifactIndexPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), '.nexus', 'artifacts', 'index.json');
}

export function relativeToWorkspace(workspaceRoot: string, absolutePath: string): string | undefined {
  const root = path.resolve(workspaceRoot);
  const relativePath = path.relative(root, path.resolve(absolutePath)).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  return relativePath;
}
```

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
npx vitest run packages/tools/src/fileKnowledge.test.ts
npx tsc -b
```

Expected: PASS，`tsc` 0 errors。

Commit:

```bash
git add packages/tools/package.json package-lock.json packages/tools/src/fileKnowledge.ts packages/tools/src/fileKnowledge.test.ts packages/tools/src/pdf-parse.d.ts
git commit -m "feat(tools): add file fingerprint utilities"
```

If `packages/tools/src/pdf-parse.d.ts` was not needed, omit it from `git add`.

---

### Task 3: 文档 artifact 账本

**Files:**
- Create: `packages/tools/src/documentArtifacts.ts`
- Create: `packages/tools/src/documentArtifacts.test.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: 写 failing 账本测试**

Create `packages/tools/src/documentArtifacts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { computeFileFingerprint } from './fileKnowledge.js';
import {
  documentArtifactPathForSource,
  findArtifactByPath,
  loadDocumentArtifactLedger,
  saveDocumentArtifactRecord,
  assessArtifactFreshness,
} from './documentArtifacts.js';

describe('document artifact ledger', () => {
  it('persists a source to artifact lineage record', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-artifacts-'));
    const sourcePath = path.join(root, 'a.docx');
    await fs.writeFile(sourcePath, 'source bytes');
    const source = await computeFileFingerprint(root, sourcePath);
    const artifactPath = await documentArtifactPathForSource(root, source, 'docx-text', '1');
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, 'artifact text', 'utf-8');
    const artifactHash = createHash('sha256').update('artifact text').digest('hex');

    await saveDocumentArtifactRecord(root, {
      artifactPath,
      artifactRelativePath: '.nexus/artifacts/documents/' + path.basename(artifactPath),
      artifactHash,
      artifactKind: 'document_text',
      sourcePath,
      sourceRelativePath: 'a.docx',
      sourceHash: source.sha256,
      sourceSizeBytes: source.sizeBytes,
      sourceMtimeMs: source.mtimeMs,
      extractor: 'docx-text',
      extractorVersion: '1',
      createdAt: '2026-07-23T08:00:00.000Z',
    });

    const ledger = await loadDocumentArtifactLedger(root);
    expect(ledger.records).toHaveLength(1);
    expect(findArtifactByPath(ledger, artifactPath)?.sourcePath).toBe(sourcePath);
  });

  it('reports stale when source hash changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-artifacts-stale-'));
    const sourcePath = path.join(root, 'a.docx');
    await fs.writeFile(sourcePath, 'v1');
    const source = await computeFileFingerprint(root, sourcePath);
    const artifactPath = await documentArtifactPathForSource(root, source, 'docx-text', '1');
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, 'artifact v1', 'utf-8');
    await saveDocumentArtifactRecord(root, {
      artifactPath,
      artifactRelativePath: '.nexus/artifacts/documents/' + path.basename(artifactPath),
      artifactHash: createHash('sha256').update('artifact v1').digest('hex'),
      artifactKind: 'document_text',
      sourcePath,
      sourceRelativePath: 'a.docx',
      sourceHash: source.sha256,
      sourceSizeBytes: source.sizeBytes,
      sourceMtimeMs: source.mtimeMs,
      extractor: 'docx-text',
      extractorVersion: '1',
      createdAt: '2026-07-23T08:00:00.000Z',
    });

    await fs.writeFile(sourcePath, 'v2', 'utf-8');
    const record = findArtifactByPath(await loadDocumentArtifactLedger(root), artifactPath);
    const freshness = await assessArtifactFreshness(root, record!);

    expect(freshness).toMatchObject({
      status: 'stale',
      sourcePath,
      artifactPath,
      reason: 'source_hash_changed',
      recommendedTool: 'read_document',
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run packages/tools/src/documentArtifacts.test.ts
```

Expected: FAIL，原因是账本模块不存在。

- [ ] **Step 3: 实现账本模块**

Create `packages/tools/src/documentArtifacts.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  DocumentArtifactRecord,
  DocumentExtractor,
  FileFingerprint,
  FileFreshness,
} from '@nexus/protocol';
import { artifactDocumentsDir, artifactIndexPath, computeFileFingerprint, relativeToWorkspace } from './fileKnowledge.js';

export interface DocumentArtifactLedger {
  version: 1;
  records: DocumentArtifactRecord[];
}

export async function loadDocumentArtifactLedger(workspaceRoot: string): Promise<DocumentArtifactLedger> {
  try {
    const raw = await fs.readFile(artifactIndexPath(workspaceRoot), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DocumentArtifactLedger>;
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, records: [] };
    throw error;
  }
}

export async function saveDocumentArtifactRecord(workspaceRoot: string, record: DocumentArtifactRecord): Promise<void> {
  const indexPath = artifactIndexPath(workspaceRoot);
  const ledger = await loadDocumentArtifactLedger(workspaceRoot);
  const normalizedArtifact = path.resolve(record.artifactPath);
  const withoutPrevious = ledger.records.filter((entry) => path.resolve(entry.artifactPath) !== normalizedArtifact);
  const next: DocumentArtifactLedger = { version: 1, records: [...withoutPrevious, record] };
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(next, null, 2), 'utf-8');
}

export function findArtifactByPath(ledger: DocumentArtifactLedger, artifactPath: string): DocumentArtifactRecord | undefined {
  const normalized = path.resolve(artifactPath);
  return ledger.records.find((entry) => path.resolve(entry.artifactPath) === normalized);
}

export function findArtifactBySource(
  ledger: DocumentArtifactLedger,
  sourcePath: string,
  extractor: DocumentExtractor,
  extractorVersion: string,
): DocumentArtifactRecord | undefined {
  const normalized = path.resolve(sourcePath);
  return ledger.records.find((entry) => (
    path.resolve(entry.sourcePath) === normalized
    && entry.extractor === extractor
    && entry.extractorVersion === extractorVersion
  ));
}

export async function documentArtifactPathForSource(
  workspaceRoot: string,
  source: FileFingerprint,
  extractor: DocumentExtractor,
  extractorVersion: string,
): Promise<string> {
  const key = `${source.path}\n${source.sha256}\n${extractor}\n${extractorVersion}`;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  const basename = path.basename(source.path, path.extname(source.path)).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return path.join(artifactDocumentsDir(workspaceRoot), `${basename}.${hash}.md`);
}

export async function assessArtifactFreshness(
  workspaceRoot: string,
  record: DocumentArtifactRecord,
): Promise<FileFreshness> {
  try {
    await fs.stat(record.artifactPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return stale(record, 'artifact_missing');
    }
    throw error;
  }

  let source: FileFingerprint;
  try {
    source = await computeFileFingerprint(workspaceRoot, record.sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return stale(record, 'source_missing');
    }
    throw error;
  }

  if (
    source.sha256 !== record.sourceHash
    || source.sizeBytes !== record.sourceSizeBytes
    || source.mtimeMs !== record.sourceMtimeMs
  ) {
    return stale(record, 'source_hash_changed');
  }

  return {
    status: 'fresh',
    sourcePath: record.sourcePath,
    artifactPath: record.artifactPath,
    recommendedTool: 'read_document',
  };
}

export async function updateArtifactLastUsed(workspaceRoot: string, artifactPath: string, usedAt = new Date().toISOString()): Promise<void> {
  const ledger = await loadDocumentArtifactLedger(workspaceRoot);
  const normalized = path.resolve(artifactPath);
  const records = ledger.records.map((entry) => path.resolve(entry.artifactPath) === normalized ? { ...entry, lastUsedAt: usedAt } : entry);
  await fs.mkdir(path.dirname(artifactIndexPath(workspaceRoot)), { recursive: true });
  await fs.writeFile(artifactIndexPath(workspaceRoot), JSON.stringify({ version: 1, records }, null, 2), 'utf-8');
}

export function artifactRecordForResult(input: {
  workspaceRoot: string;
  source: FileFingerprint;
  artifactPath: string;
  artifactHash: string;
  extractor: DocumentExtractor;
  extractorVersion: string;
  createdAt: string;
}): DocumentArtifactRecord {
  return {
    artifactPath: input.artifactPath,
    artifactRelativePath: relativeToWorkspace(input.workspaceRoot, input.artifactPath),
    artifactHash: input.artifactHash,
    artifactKind: 'document_text',
    sourcePath: input.source.path,
    sourceRelativePath: input.source.relativePath,
    sourceHash: input.source.sha256,
    sourceSizeBytes: input.source.sizeBytes,
    sourceMtimeMs: input.source.mtimeMs,
    extractor: input.extractor,
    extractorVersion: input.extractorVersion,
    createdAt: input.createdAt,
  };
}

function stale(record: DocumentArtifactRecord, reason: NonNullable<FileFreshness['reason']>): FileFreshness {
  return {
    status: reason === 'source_missing' ? 'missing' : 'stale',
    sourcePath: record.sourcePath,
    artifactPath: record.artifactPath,
    reason,
    recommendedTool: 'read_document',
  };
}
```

- [ ] **Step 4: 从 tools 正式入口导出账本函数**

Modify `packages/tools/src/index.ts`:

```ts
export {
  artifactRecordForResult,
  assessArtifactFreshness,
  documentArtifactPathForSource,
  findArtifactByPath,
  findArtifactBySource,
  loadDocumentArtifactLedger,
  saveDocumentArtifactRecord,
  updateArtifactLastUsed,
} from './documentArtifacts.js';
export type { DocumentArtifactLedger } from './documentArtifacts.js';
```

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
npx vitest run packages/tools/src/documentArtifacts.test.ts packages/tools/src/fileKnowledge.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/tools/src/documentArtifacts.ts packages/tools/src/documentArtifacts.test.ts packages/tools/src/index.ts
git commit -m "feat(tools): add document artifact ledger"
```

---

### Task 4: `read_document` 提取工具

**Files:**
- Create: `packages/tools/src/documentExtractors.ts`
- Create: `packages/tools/src/documentExtractors.test.ts`
- Modify: `packages/tools/src/builtin.ts`
- Modify: `packages/tools/src/builtin.test.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: 写 failing extractor 测试**

Create `packages/tools/src/documentExtractors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractDocumentText, extractorForDocumentPath } from './documentExtractors.js';

describe('document extractors', () => {
  it('extracts text from a minimal docx', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-docx-'));
    const filePath = path.join(root, 'sample.docx');
    await writeMinimalDocx(filePath, '第一章 生命周期检测');

    const result = await extractDocumentText(filePath);

    expect(result.extractor).toBe('docx-text');
    expect(result.text).toContain('第一章 生命周期检测');
  });

  it('extracts rows from an xlsx workbook', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-xlsx-'));
    const filePath = path.join(root, 'table.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名称', '状态'], ['方案B', '通过']]), 'Sheet1');
    XLSX.writeFile(workbook, filePath);

    const result = await extractDocumentText(filePath);

    expect(result.extractor).toBe('xlsx-text');
    expect(result.text).toContain('名称');
    expect(result.text).toContain('方案B');
  });

  it('selects expected extractors by extension', () => {
    expect(extractorForDocumentPath('a.docx')).toBe('docx-text');
    expect(extractorForDocumentPath('a.pdf')).toBe('pdf-text');
    expect(extractorForDocumentPath('a.xlsx')).toBe('xlsx-text');
    expect(extractorForDocumentPath('a.pptx')).toBe('pptx-text');
  });
});

async function writeMinimalDocx(filePath: string, text: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join(''));
  zip.folder('_rels')!.file('.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''));
  zip.folder('word')!.file('document.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body><w:p><w:r><w:t>',
    escapeXml(text),
    '</w:t></w:r></w:p></w:body></w:document>',
  ].join(''));
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: 写 failing `read_document` 测试**

Add to `packages/tools/src/builtin.test.ts`:

```ts
describe('readDocumentTool', () => {
  it('extracts docx to a managed artifact and reuses it while fresh', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-read-document-'));
    const docxPath = path.join(root, 'brief.docx');
    await writeMinimalDocx(docxPath, '版本一 内容');

    const first = await readDocumentTool.execute(
      { filePath: 'brief.docx' },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
    );
    const second = await readDocumentTool.execute(
      { filePath: 'brief.docx' },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(first.status).toBe('completed');
    expect(first.output).toContain('版本一 内容');
    expect(first.data).toMatchObject({
      stale: false,
      reused: false,
      source: expect.objectContaining({ path: docxPath, sha256: expect.any(String) }),
      artifact: expect.objectContaining({ kind: 'document_text', extractor: 'docx-text' }),
    });
    expect(second.data).toMatchObject({ reused: true, stale: false });
  });

  it('refreshes the artifact after the source document changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-read-document-refresh-'));
    const docxPath = path.join(root, 'brief.docx');
    await writeMinimalDocx(docxPath, '版本一 内容');
    await readDocumentTool.execute({ filePath: 'brief.docx' }, { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeMinimalDocx(docxPath, '版本二 新内容');
    const refreshed = await readDocumentTool.execute(
      { filePath: 'brief.docx' },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(refreshed.status).toBe('completed');
    expect(refreshed.output).toContain('版本二 新内容');
    expect(refreshed.data).toMatchObject({ reused: false, stale: true });
  });
});
```

Use the same `writeMinimalDocx()` helper from `documentExtractors.test.ts`; place a local copy at the bottom of `builtin.test.ts` because tests should be readable independently.

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npx vitest run packages/tools/src/documentExtractors.test.ts packages/tools/src/builtin.test.ts
```

Expected: FAIL，原因是 `documentExtractors.ts` 和 `readDocumentTool` 不存在。

- [ ] **Step 4: 实现 extractors**

Create `packages/tools/src/documentExtractors.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import type { DocumentExtractor } from '@nexus/protocol';

export const DOCUMENT_EXTRACTOR_VERSION = '1';

export interface ExtractedDocumentText {
  extractor: DocumentExtractor;
  text: string;
}

export function extractorForDocumentPath(filePath: string): DocumentExtractor {
  switch (path.extname(filePath).toLowerCase()) {
    case '.docx': return 'docx-text';
    case '.pdf': return 'pdf-text';
    case '.xlsx': return 'xlsx-text';
    case '.pptx': return 'pptx-text';
    default: throw Object.assign(new Error(`Unsupported document type: ${path.extname(filePath)}`), { code: 'UNSUPPORTED_DOCUMENT_TYPE' });
  }
}

export async function extractDocumentText(filePath: string): Promise<ExtractedDocumentText> {
  const extractor = extractorForDocumentPath(filePath);
  if (extractor === 'docx-text') {
    const result = await mammoth.extractRawText({ path: filePath });
    return { extractor, text: result.value.trim() };
  }
  if (extractor === 'pdf-text') {
    const parsed = await pdfParse(await fs.readFile(filePath));
    return { extractor, text: parsed.text.trim() };
  }
  if (extractor === 'xlsx-text') {
    const workbook = XLSX.readFile(filePath);
    const text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return `## ${sheetName}\n${csv.trim()}`;
    }).join('\n\n').trim();
    return { extractor, text };
  }
  return { extractor, text: await extractPptxText(filePath) };
}

async function extractPptxText(filePath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async('string');
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1] ?? ''))
      .filter(Boolean)
      .join('\n');
    if (text.trim()) slides.push(`## ${path.basename(name, '.xml')}\n${text.trim()}`);
  }
  return slides.join('\n\n').trim();
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
```

- [ ] **Step 5: 实现 `read_document`**

Modify `packages/tools/src/builtin.ts` imports:

```ts
import { createHash } from 'node:crypto';
import { computeFileFingerprint, isDocumentFile, relativeToWorkspace, resolveWorkspacePath } from './fileKnowledge.js';
import {
  artifactRecordForResult,
  assessArtifactFreshness,
  documentArtifactPathForSource,
  findArtifactBySource,
  loadDocumentArtifactLedger,
  saveDocumentArtifactRecord,
  updateArtifactLastUsed,
} from './documentArtifacts.js';
import { DOCUMENT_EXTRACTOR_VERSION, extractDocumentText, extractorForDocumentPath } from './documentExtractors.js';
```

Add before `listFilesTool`:

```ts
export const readDocumentTool: ToolDefinition = {
  name: 'read_document',
  description: 'Extract readable text from docx, pdf, xlsx, or pptx files. Use this instead of read_file for office/PDF documents so Nexus can detect stale extracted artifacts.',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Document path relative to workspace root, or absolute.' },
    },
    required: ['filePath'],
  },
  requiredPolicy: 'readonly',
  supportsParallelToolCalls: true,
  timeoutMs: 120_000,
  maxOutputLength: 50_000,
  async execute(args, ctx): Promise<ToolResult> {
    const rawPath = firstString(args.filePath, args.path, args.filename);
    if (!rawPath) {
      return failedToolResult('filePath is required', 'INVALID_ARGUMENTS');
    }
    const filePath = resolveWorkspacePath(ctx.workspaceRoot, rawPath);
    if (!isDocumentFile(filePath)) {
      return failedToolResult(`Unsupported document type: ${path.extname(filePath)}`, 'UNSUPPORTED_DOCUMENT_TYPE');
    }

    const extractor = extractorForDocumentPath(filePath);
    const source = await computeFileFingerprint(ctx.workspaceRoot, filePath);
    const ledger = await loadDocumentArtifactLedger(ctx.workspaceRoot);
    const existing = findArtifactBySource(ledger, filePath, extractor, DOCUMENT_EXTRACTOR_VERSION);
    if (existing) {
      const freshness = await assessArtifactFreshness(ctx.workspaceRoot, existing);
      if (freshness.status === 'fresh') {
        await updateArtifactLastUsed(ctx.workspaceRoot, existing.artifactPath);
        const text = await fs.readFile(existing.artifactPath, 'utf-8');
        return completedDocumentResult(source, existing.artifactPath, existing.artifactHash, extractor, existing.createdAt, true, false, text, ctx.workspaceRoot);
      }
    }

    const extracted = await extractDocumentText(filePath);
    const artifactPath = await documentArtifactPathForSource(ctx.workspaceRoot, source, extractor, DOCUMENT_EXTRACTOR_VERSION);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, extracted.text, 'utf-8');
    const artifactHash = createHash('sha256').update(extracted.text).digest('hex');
    const createdAt = new Date().toISOString();
    const record = artifactRecordForResult({
      workspaceRoot: ctx.workspaceRoot,
      source,
      artifactPath,
      artifactHash,
      extractor: extracted.extractor,
      extractorVersion: DOCUMENT_EXTRACTOR_VERSION,
      createdAt,
    });
    await saveDocumentArtifactRecord(ctx.workspaceRoot, record);
    return completedDocumentResult(source, artifactPath, artifactHash, extracted.extractor, createdAt, false, Boolean(existing), extracted.text, ctx.workspaceRoot);
  },
};

function completedDocumentResult(
  source: Awaited<ReturnType<typeof computeFileFingerprint>>,
  artifactPath: string,
  artifactHash: string,
  extractor: ReturnType<typeof extractorForDocumentPath>,
  createdAt: string,
  reused: boolean,
  stale: boolean,
  text: string,
  workspaceRoot: string,
): ToolResult {
  const preview = text.slice(0, 48_000);
  const sourceDisplay = source.relativePath ?? source.path;
  return {
    output: [
      `Document extracted: ${sourceDisplay}`,
      `Artifact: ${relativeToWorkspace(workspaceRoot, artifactPath) ?? artifactPath}`,
      '',
      preview,
    ].join('\n'),
    status: 'completed',
    data: {
      source,
      artifact: {
        path: artifactPath,
        relativePath: relativeToWorkspace(workspaceRoot, artifactPath),
        kind: 'document_text',
        sha256: artifactHash,
        createdAt,
        extractor,
        extractorVersion: DOCUMENT_EXTRACTOR_VERSION,
      },
      stale,
      reused,
      textPreview: preview,
    },
  };
}

function failedToolResult(message: string, code: string): ToolResult {
  return { output: message, status: 'failed', error: { message, code } };
}
```

Add `readDocumentTool` to `BUILTIN_TOOLS` right after `readFileTool`.

Modify `packages/tools/src/index.ts` export list:

```ts
readDocumentTool,
```

- [ ] **Step 6: 运行测试并提交**

Run:

```bash
npx vitest run packages/tools/src/documentExtractors.test.ts packages/tools/src/builtin.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/tools/src/documentExtractors.ts packages/tools/src/documentExtractors.test.ts packages/tools/src/builtin.ts packages/tools/src/builtin.test.ts packages/tools/src/index.ts
git commit -m "feat(tools): add managed document extraction tool"
```

---

### Task 5: `read_file` 完整指纹和 stale artifact 硬保护

**Files:**
- Modify: `packages/tools/src/builtin.ts`
- Modify: `packages/tools/src/builtin.test.ts`

- [ ] **Step 1: 写 failing 测试**

Add to `packages/tools/src/builtin.test.ts` `describe('readFileTool', ...)`:

```ts
it('returns a full file fingerprint with read_file results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-read-file-fingerprint-'));
  await fs.writeFile(path.join(root, 'note.txt'), 'hello\n', 'utf-8');

  const result = await readFileTool.execute(
    { filePath: 'note.txt' },
    { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
  );

  expect(result.status).toBe('completed');
  expect(result.data).toMatchObject({
    file: {
      path: path.join(root, 'note.txt'),
      relativePath: 'note.txt',
      sha256: expect.any(String),
      contentType: 'text/plain',
      sizeBytes: 6,
    },
    freshness: { status: 'fresh' },
  });
});

it('fails closed when reading a stale managed document artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-stale-artifact-'));
  const sourcePath = path.join(root, 'source.docx');
  await writeMinimalDocx(sourcePath, '源文件版本一');
  const extracted = await readDocumentTool.execute(
    { filePath: 'source.docx' },
    { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
  );
  const artifactPath = (extracted.data as { artifact: { path: string } }).artifact.path;

  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeMinimalDocx(sourcePath, '源文件版本二');
  const staleRead = await readFileTool.execute(
    { filePath: artifactPath },
    { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
  );

  expect(staleRead.status).toBe('failed');
  expect(staleRead.error?.code).toBe('STALE_DOCUMENT_ARTIFACT');
  expect(staleRead.data).toMatchObject({
    freshness: {
      status: 'stale',
      sourcePath,
      artifactPath,
      reason: 'source_hash_changed',
      recommendedTool: 'read_document',
    },
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run packages/tools/src/builtin.test.ts
```

Expected: FAIL，原因是 `read_file` 没有 `data.file/freshness`，且会读出 stale artifact 内容。

- [ ] **Step 3: 实现 `read_file` 保护**

Modify `readFileTool.execute()` before reading text content:

```ts
const filePath = resolvePath(ctx.workspaceRoot, rawPath);
const ledger = await loadDocumentArtifactLedger(ctx.workspaceRoot);
const managedArtifact = findArtifactByPath(ledger, filePath);
if (managedArtifact) {
  const freshness = await assessArtifactFreshness(ctx.workspaceRoot, managedArtifact);
  if (freshness.status !== 'fresh') {
    return {
      output: `Stale document artifact: ${managedArtifact.artifactPath}. Use read_document on ${managedArtifact.sourcePath}.`,
      status: 'failed',
      error: {
        message: 'Managed document artifact is stale; use read_document to refresh it.',
        code: 'STALE_DOCUMENT_ARTIFACT',
      },
      data: { freshness },
    };
  }
}
const file = await computeFileFingerprint(ctx.workspaceRoot, filePath);
```

Modify returned `data`:

```ts
data: {
  path: filePath,
  file,
  freshness: managedArtifact
    ? { status: 'fresh', sourcePath: managedArtifact.sourcePath, artifactPath: managedArtifact.artifactPath, recommendedTool: 'read_document' }
    : unmanagedHelperFreshness(ctx.workspaceRoot, filePath),
  startLine,
  endLine,
  totalLines: allLines.length,
  encoding: decoded.encoding,
  artifactRefs: [ref],
},
```

Add helper near other helpers:

```ts
function unmanagedHelperFreshness(workspaceRoot: string, filePath: string) {
  const basename = path.basename(filePath).toLowerCase();
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
  const directChild = relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep);
  if (directChild && /^_.*(?:decoded|extract|dump|scratch|temp|tmp).*\.(txt|md|json|xml)$/i.test(basename)) {
    return {
      status: 'unmanaged_warning',
      artifactPath: filePath,
      reason: 'unmanaged_artifact',
      recommendedTool: 'read_document',
    };
  }
  return { status: 'fresh' };
}
```

- [ ] **Step 4: 运行测试并提交**

Run:

```bash
npx vitest run packages/tools/src/builtin.test.ts packages/tools/src/documentArtifacts.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/tools/src/builtin.ts packages/tools/src/builtin.test.ts
git commit -m "feat(tools): protect stale document artifacts"
```

---

### Task 6: runtime trace 写入文件生命周期事件

**Files:**
- Modify: `packages/runtime/src/agent.ts`
- Modify: `packages/runtime/src/agent.test.ts`
- Modify: `packages/runtime/src/runTraceProjector.ts`
- Modify: `packages/runtime/src/runTraceProjector.test.ts`

- [ ] **Step 1: 写 failing runtime trace 测试**

Add to `packages/runtime/src/agent.test.ts`:

```ts
it('records file lifecycle trace events from read_document results', async () => {
  const threadId = 'thread-document-trace';
  const store = new FakeStore(threadId, 'previous-turn');
  const model = new SequenceToolModel([{ name: 'read_document', arguments: { filePath: 'brief.docx' } }], '完成');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-runtime-document-trace-'));
  await writeMinimalDocx(path.join(root, 'brief.docx'), 'trace 内容');
  const agent = new AgentLoop({
    workspaceRoot: root,
    sandbox: { level: 'workspace_write', workspaceRoot: root },
    model: model as never,
    store,
  });

  await agent.runTurn(threadId, { type: 'text', text: '分析 brief.docx' });

  const fileEvents = store.traceEvents.filter((event) => event.category === 'file');
  expect(fileEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: 'document extracted',
      payload: expect.objectContaining({
        action: 'extract',
        path: expect.stringContaining('brief.docx'),
        artifactPath: expect.stringContaining('.nexus'),
      }),
    }),
  ]));
});
```

Add to `packages/runtime/src/runTraceProjector.test.ts`:

```ts
it('counts document file lifecycle events separately from changed files', () => {
  const summary = projectRunTrace([
    makeTrace({ sequence: 1, category: 'file', name: 'document extracted', payload: { action: 'extract', path: 'a.docx' } }),
    makeTrace({ sequence: 2, category: 'file', name: 'artifact stale', payload: { action: 'stale', path: '.nexus/artifacts/documents/a.md', sourcePath: 'a.docx' } }),
    makeTrace({ sequence: 3, category: 'file', name: 'document refreshed', payload: { action: 'refresh', path: 'a.docx' } }),
  ]);

  expect(summary.files).toMatchObject({
    reads: 0,
    changed: 0,
    extracted: 1,
    stale: 1,
    refreshed: 1,
  });
});
```

If `makeTrace` does not exist in `runTraceProjector.test.ts`, add this helper:

```ts
function makeTrace(overrides: Partial<RunTraceEnvelope> & { category: 'file'; payload: RunTraceEnvelope['payload'] }): RunTraceEnvelope {
  return {
    version: 2,
    eventId: `event-${overrides.sequence ?? 1}`,
    sequence: overrides.sequence ?? 1,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: `span-${overrides.sequence ?? 1}`,
    name: overrides.name ?? 'file',
    lifecycle: 'completed',
    level: 'info',
    occurredAt: '2026-07-23T08:00:00.000Z',
    ...overrides,
  } as RunTraceEnvelope;
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run packages/runtime/src/agent.test.ts packages/runtime/src/runTraceProjector.test.ts
```

Expected: FAIL，原因是 runtime 不写 file lifecycle trace，summary 没有 extracted/stale/refreshed 字段。

- [ ] **Step 3: 扩展 `RunTraceSummary.files`**

Modify `packages/protocol/src/runTrace.ts`:

```ts
files: {
  reads: number;
  changed: number;
  addedLines: number;
  removedLines: number;
  extracted: number;
  reused: number;
  stale: number;
  refreshed: number;
};
```

Modify `packages/runtime/src/runTraceProjector.ts` initial summary:

```ts
files: { reads: 0, changed: 0, addedLines: 0, removedLines: 0, extracted: 0, reused: 0, stale: 0, refreshed: 0 },
```

Modify `case 'file'`:

```ts
case 'file':
  if (event.lifecycle === 'completed' || event.lifecycle === 'instant') {
    if (event.payload.action === 'read') summary.files.reads += 1;
    if (event.payload.action === 'extract') summary.files.extracted += 1;
    if (event.payload.action === 'reuse') summary.files.reused += 1;
    if (event.payload.action === 'stale') summary.files.stale += 1;
    if (event.payload.action === 'refresh') summary.files.refreshed += 1;
    if (['write', 'patch', 'delete', 'checkpoint'].includes(event.payload.action)) {
      summary.files.changed += 1;
      summary.files.addedLines += event.payload.addedLines ?? 0;
      summary.files.removedLines += event.payload.removedLines ?? 0;
    }
  }
  break;
```

- [ ] **Step 4: 从工具结果写 file trace**

Modify `packages/runtime/src/agent.ts` after `appendRunMonitorEvent(... tool.completed ...)` inside `executeToolCall()`:

```ts
await this.appendFileLifecycleRunMonitorEvents(turnId, itemId, toolName, result.data);
```

Add private method near `appendRunTraceFromMonitorEvent()`:

```ts
private async appendFileLifecycleRunMonitorEvents(
  turnId: TurnId,
  itemId: ItemId,
  toolName: string,
  data: unknown,
): Promise<void> {
  const object = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  if (toolName === 'read_file') {
    const file = object.file && typeof object.file === 'object' ? object.file as Record<string, unknown> : null;
    const freshness = object.freshness && typeof object.freshness === 'object' ? object.freshness as Record<string, unknown> : null;
    if (file?.path) {
      await this.appendRunMonitorEvent(turnId, {
        category: 'file',
        type: 'file.read',
        message: `Read file ${String(file.path)}`,
        metadata: {
          itemId,
          action: 'read',
          path: String(file.path),
          sha256: stringMetadata(file.sha256),
          contentType: stringMetadata(file.contentType),
        },
      });
    }
    if (freshness?.status === 'unmanaged_warning') {
      await this.appendRunMonitorEvent(turnId, {
        category: 'file',
        type: 'file.stale',
        level: 'warning',
        message: `Unmanaged derived artifact read: ${String(freshness.artifactPath ?? file?.path ?? '')}`,
        metadata: {
          itemId,
          action: 'stale',
          path: String(freshness.artifactPath ?? file?.path ?? ''),
          staleReason: 'unmanaged_artifact',
        },
      });
    }
    return;
  }

  if (toolName !== 'read_document') return;
  const source = object.source && typeof object.source === 'object' ? object.source as Record<string, unknown> : null;
  const artifact = object.artifact && typeof object.artifact === 'object' ? object.artifact as Record<string, unknown> : null;
  if (!source?.path || !artifact?.path) return;
  const stale = object.stale === true;
  const reused = object.reused === true;
  await this.appendRunMonitorEvent(turnId, {
    category: 'file',
    type: reused ? 'file.reuse' : stale ? 'file.refresh' : 'file.extract',
    level: stale ? 'warning' : 'info',
    message: reused ? `Reused document artifact for ${String(source.path)}` : stale ? `Refreshed document artifact for ${String(source.path)}` : `Extracted document ${String(source.path)}`,
    metadata: {
      itemId,
      action: reused ? 'reuse' : stale ? 'refresh' : 'extract',
      path: String(source.path),
      sourcePath: String(source.path),
      artifactPath: String(artifact.path),
      sha256: stringMetadata(source.sha256),
      artifactSha256: stringMetadata(artifact.sha256),
      contentType: stringMetadata(source.contentType),
      extractor: stringMetadata(artifact.extractor),
    },
  });
}
```

Modify `runTraceObservationFromMonitorEvent()` before checkpoint branch:

```ts
if (event.category === 'file') {
  return {
    ...base,
    category: 'file',
    itemId: metadata.itemId == null ? undefined : String(metadata.itemId),
    payload: {
      action: traceFileAction(metadata.action ?? event.type.split('.')[1]),
      path: String(metadata.path ?? ''),
      sourcePath: stringMetadata(metadata.sourcePath),
      artifactPath: stringMetadata(metadata.artifactPath),
      sha256: stringMetadata(metadata.sha256),
      artifactSha256: stringMetadata(metadata.artifactSha256),
      staleReason: stringMetadata(metadata.staleReason),
      contentType: stringMetadata(metadata.contentType),
      extractor: stringMetadata(metadata.extractor),
      addedLines: numberMetadata(metadata.addedLines),
      removedLines: numberMetadata(metadata.removedLines),
    },
  } as RunTraceObservation;
}
```

Add helper near other trace helpers:

```ts
function traceFileAction(value: unknown): 'read' | 'write' | 'patch' | 'delete' | 'checkpoint' | 'extract' | 'stale' | 'refresh' | 'reuse' {
  const action = typeof value === 'string' ? value : '';
  if (['read', 'write', 'patch', 'delete', 'checkpoint', 'extract', 'stale', 'refresh', 'reuse'].includes(action)) {
    return action as ReturnType<typeof traceFileAction>;
  }
  return 'read';
}
```

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
npx vitest run packages/runtime/src/agent.test.ts packages/runtime/src/runTraceProjector.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/protocol/src/runTrace.ts packages/runtime/src/agent.ts packages/runtime/src/agent.test.ts packages/runtime/src/runTraceProjector.ts packages/runtime/src/runTraceProjector.test.ts
git commit -m "feat(runtime): trace document lifecycle events"
```

---

### Task 7: 模型迭代前 freshness preflight

**Files:**
- Create: `packages/runtime/src/fileFreshnessPreflight.ts`
- Create: `packages/runtime/src/fileFreshnessPreflight.test.ts`
- Modify: `packages/runtime/src/agent.ts`
- Modify: `packages/runtime/src/agent.test.ts`

- [ ] **Step 1: 写 failing preflight 单测**

Create `packages/runtime/src/fileFreshnessPreflight.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildFreshnessPreflightNotice, collectMentionedDocumentPaths } from './fileFreshnessPreflight.js';

describe('file freshness preflight', () => {
  it('extracts explicitly mentioned document paths from Chinese user input', () => {
    expect(collectMentionedDocumentPaths('重新分析 E:\\langchain\\dexin-agent\\_v1.0.docx 和 ./方案.pdf')).toEqual([
      'E:\\langchain\\dexin-agent\\_v1.0.docx',
      './方案.pdf',
    ]);
  });

  it('warns when a managed artifact source changed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-preflight-'));
    const notice = await buildFreshnessPreflightNotice({
      workspaceRoot: root,
      locale: 'zh',
      userText: '继续分析 a.docx',
      recentItems: [],
      staleArtifacts: [{
        artifactPath: path.join(root, '.nexus', 'artifacts', 'documents', 'a.md'),
        sourcePath: path.join(root, 'a.docx'),
        reason: 'source_hash_changed',
      }],
    });

    expect(notice?.content).toContain('旧提取内容已经过期');
    expect(notice?.content).toContain('read_document');
  });
});
```

- [ ] **Step 2: 写 failing agent 集成测试**

Add to `packages/runtime/src/agent.test.ts`:

```ts
it('injects a freshness warning before the next model call when a document artifact is stale', async () => {
  const threadId = 'thread-preflight-stale';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-agent-preflight-'));
  await writeMinimalDocx(path.join(root, 'brief.docx'), '版本一');

  const store = new FakeStore(threadId, 'previous-turn');
  const setupModel = new SequenceToolModel([{ name: 'read_document', arguments: { filePath: 'brief.docx' } }], '已读取');
  const setupAgent = new AgentLoop({
    workspaceRoot: root,
    sandbox: { level: 'workspace_write', workspaceRoot: root },
    model: setupModel as never,
    store,
  });
  await setupAgent.runTurn(threadId, { type: 'text', text: '读取 brief.docx' });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeMinimalDocx(path.join(root, 'brief.docx'), '版本二');
  const model = new MessageCapturingModel();
  const agent = new AgentLoop({
    workspaceRoot: root,
    sandbox: { level: 'workspace_write', workspaceRoot: root },
    model: model as never,
    store,
  });

  await agent.runTurn(threadId, { type: 'text', text: '继续分析 brief.docx' });

  const serialized = JSON.stringify(model.messages[0]);
  expect(serialized).toContain('旧提取内容已经过期');
  expect(serialized).toContain('read_document');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npx vitest run packages/runtime/src/fileFreshnessPreflight.test.ts packages/runtime/src/agent.test.ts
```

Expected: FAIL，原因是 preflight 模块不存在，agent 不注入 warning。

- [ ] **Step 4: 实现 preflight**

Create `packages/runtime/src/fileFreshnessPreflight.ts`:

```ts
import * as path from 'node:path';
import type { DocumentArtifactRecord, FileFreshnessReason, ThreadItem } from '@nexus/protocol';
import { assessArtifactFreshness, loadDocumentArtifactLedger } from '@nexus/tools';

export interface StaleArtifactNotice {
  artifactPath: string;
  sourcePath: string;
  reason: FileFreshnessReason;
}

export interface FreshnessPreflightInput {
  workspaceRoot: string;
  locale: 'zh' | 'en';
  userText: string;
  recentItems: ThreadItem[];
  staleArtifacts?: StaleArtifactNotice[];
}

export interface FreshnessPreflightNotice {
  role: 'user';
  content: string;
  staleArtifacts: StaleArtifactNotice[];
}

export function collectMentionedDocumentPaths(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\s"'<>|]+|\.{1,2}[\\/][^\s"'<>|]+|[^\s"'<>|]+?\.(?:docx|pdf|xlsx|pptx))/gi) ?? [];
  return [...new Set(matches.map((entry) => entry.replace(/[，。；、,.!?）)]+$/u, '')))];
}

export async function buildFreshnessPreflightNotice(input: FreshnessPreflightInput): Promise<FreshnessPreflightNotice | null> {
  const staleArtifacts = input.staleArtifacts ?? await findStaleArtifacts(input.workspaceRoot, input.userText, input.recentItems);
  if (staleArtifacts.length === 0) return null;
  const lines = input.locale === 'zh'
    ? [
        '文件知识新鲜度提醒：以下旧提取内容已经过期，依赖它前必须重新调用 read_document。',
        ...staleArtifacts.map((entry) => `- 源文件：${entry.sourcePath}；旧提取物：${entry.artifactPath}；原因：${entry.reason}`),
      ]
    : [
        'File freshness warning: the following extracted artifacts are stale. Call read_document before relying on them.',
        ...staleArtifacts.map((entry) => `- source: ${entry.sourcePath}; artifact: ${entry.artifactPath}; reason: ${entry.reason}`),
      ];
  return { role: 'user', content: lines.join('\n'), staleArtifacts };
}

async function findStaleArtifacts(workspaceRoot: string, userText: string, recentItems: ThreadItem[]): Promise<StaleArtifactNotice[]> {
  const ledger = await loadDocumentArtifactLedger(workspaceRoot);
  const mentioned = new Set(collectMentionedDocumentPaths(userText).map((entry) => normalizePath(workspaceRoot, entry)));
  const recentSources = new Set(recentItems.flatMap(readDocumentSourcePathsFromItem).map((entry) => normalizePath(workspaceRoot, entry)));
  const selected = ledger.records.filter((record) => mentioned.has(normalizePath(workspaceRoot, record.sourcePath)) || recentSources.has(normalizePath(workspaceRoot, record.sourcePath)));
  const stale: StaleArtifactNotice[] = [];
  for (const record of selected) {
    const freshness = await assessArtifactFreshness(workspaceRoot, record);
    if (freshness.status !== 'fresh' && freshness.reason && freshness.sourcePath && freshness.artifactPath) {
      stale.push({ sourcePath: freshness.sourcePath, artifactPath: freshness.artifactPath, reason: freshness.reason });
    }
  }
  return stale;
}

function readDocumentSourcePathsFromItem(item: ThreadItem): string[] {
  if (item.type !== 'tool_call' || item.toolName !== 'read_document' || item.status === 'failed') return [];
  const result = item.result && typeof item.result === 'object' ? item.result as { source?: { path?: unknown } } : {};
  return typeof result.source?.path === 'string' ? [result.source.path] : [];
}

function normalizePath(workspaceRoot: string, value: string): string {
  return path.resolve(path.isAbsolute(value) ? value : path.join(workspaceRoot, value)).toLowerCase();
}
```

- [ ] **Step 5: 接入 `agentLoop()`**

Modify `packages/runtime/src/agent.ts` imports:

```ts
import { buildFreshnessPreflightNotice } from './fileFreshnessPreflight.js';
```

Inside `agentLoop()` while loop, after system monitor notice and before `iteration++`:

```ts
const freshnessNotice = await buildFreshnessPreflightNotice({
  workspaceRoot: this.config.workspaceRoot,
  locale: this.config.locale,
  userText: userInputText(runtimeContext.userInput),
  recentItems: collectedItems.slice(-30),
});
if (freshnessNotice) {
  messages.push({ role: 'user', content: freshnessNotice.content });
  await this.appendRunMonitorEvent(turnId, {
    category: 'file',
    type: 'file.stale',
    level: 'warning',
    message: 'Stale document artifacts detected before model call',
    metadata: {
      action: 'stale',
      path: freshnessNotice.staleArtifacts[0]?.artifactPath ?? '',
      staleReason: freshnessNotice.staleArtifacts[0]?.reason,
      staleArtifacts: freshnessNotice.staleArtifacts,
    },
  });
}
```

Add helper near runtime helpers:

```ts
function userInputText(input: UserInput): string {
  if (input.type === 'text') return input.text;
  if (input.type === 'multimodal') {
    return input.parts.map((part) => part.type === 'text' ? part.text : '').join('\n');
  }
  return '';
}
```

- [ ] **Step 6: 运行测试并提交**

Run:

```bash
npx vitest run packages/runtime/src/fileFreshnessPreflight.test.ts packages/runtime/src/agent.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/runtime/src/fileFreshnessPreflight.ts packages/runtime/src/fileFreshnessPreflight.test.ts packages/runtime/src/agent.ts packages/runtime/src/agent.test.ts packages/tools/package.json
git commit -m "feat(runtime): warn on stale document knowledge before model calls"
```

---

### Task 8: checkpoint knowledge 紧凑摘要

**Files:**
- Modify: `packages/runtime/src/agent.ts`
- Modify: `packages/runtime/src/agent.test.ts`
- Modify: `packages/protocol/src/schemas.ts`
- Modify: `packages/protocol/src/types.ts`

- [ ] **Step 1: 写 failing checkpoint 测试**

Add to `packages/runtime/src/agent.test.ts`:

```ts
it('adds compact file knowledge to project checkpoints', async () => {
  const threadId = 'thread-checkpoint-knowledge';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-checkpoint-knowledge-'));
  await writeMinimalDocx(path.join(root, 'brief.docx'), 'checkpoint 内容');
  const store = new FakeStore(threadId, 'previous-turn');
  const model = new SequenceToolModel([
    { name: 'read_document', arguments: { filePath: 'brief.docx' } },
    { name: 'write_file', arguments: { filePath: 'result.txt', content: 'done' } },
  ], '完成');
  const agent = new AgentLoop({
    workspaceRoot: root,
    sandbox: { level: 'workspace_write', workspaceRoot: root },
    model: model as never,
    store,
  });

  await agent.runTurn(threadId, { type: 'text', text: '读取文档并写结果' });

  const checkpoint = store.items.find((item) => item.type === 'project_checkpoint');
  expect(checkpoint).toMatchObject({
    knowledge: {
      observedFiles: [expect.objectContaining({ path: path.join(root, 'brief.docx'), sha256: expect.any(String) })],
      documentArtifacts: [expect.objectContaining({ sourcePath: path.join(root, 'brief.docx'), artifactHash: expect.any(String) })],
    },
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run packages/runtime/src/agent.test.ts
```

Expected: FAIL，checkpoint 没有 `knowledge`。

- [ ] **Step 3: 实现 checkpoint knowledge 收集**

Modify `createProjectCheckpointItem()` signature:

```ts
collectedItems,
```

Add argument type:

```ts
collectedItems: ThreadItem[];
```

When calling `createProjectCheckpointItem()`, pass:

```ts
collectedItems,
```

Inside returned object:

```ts
knowledge: buildKnowledgeCheckpointSummary(collectedItems),
```

Add helper near checkpoint helpers:

```ts
function buildKnowledgeCheckpointSummary(items: ThreadItem[]): KnowledgeCheckpointSummary | undefined {
  const observedFiles = new Map<string, KnowledgeCheckpointSummary['observedFiles'][number]>();
  const documentArtifacts = new Map<string, KnowledgeCheckpointSummary['documentArtifacts'][number]>();

  for (const item of items) {
    if (item.type !== 'tool_call' || item.status === 'failed') continue;
    const result = item.result && typeof item.result === 'object' ? item.result as Record<string, unknown> : {};
    const file = result.file && typeof result.file === 'object' ? result.file as Record<string, unknown> : null;
    if (file?.path && file.sha256 && typeof file.mtimeMs === 'number' && typeof file.sizeBytes === 'number') {
      observedFiles.set(String(file.path), {
        path: String(file.path),
        sha256: String(file.sha256),
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      });
    }
    const source = result.source && typeof result.source === 'object' ? result.source as Record<string, unknown> : null;
    const artifact = result.artifact && typeof result.artifact === 'object' ? result.artifact as Record<string, unknown> : null;
    if (source?.path && source.sha256 && typeof source.mtimeMs === 'number' && typeof source.sizeBytes === 'number') {
      observedFiles.set(String(source.path), {
        path: String(source.path),
        sha256: String(source.sha256),
        mtimeMs: source.mtimeMs,
        sizeBytes: source.sizeBytes,
      });
    }
    if (source?.path && source.sha256 && artifact?.path && artifact.sha256) {
      documentArtifacts.set(String(artifact.path), {
        artifactPath: String(artifact.path),
        sourcePath: String(source.path),
        sourceHash: String(source.sha256),
        artifactHash: String(artifact.sha256),
      });
    }
  }

  if (observedFiles.size === 0 && documentArtifacts.size === 0) return undefined;
  return { observedFiles: [...observedFiles.values()], documentArtifacts: [...documentArtifacts.values()] };
}
```

Add `KnowledgeCheckpointSummary` import from `@nexus/protocol`.

- [ ] **Step 4: 运行测试并提交**

Run:

```bash
npx vitest run packages/runtime/src/agent.test.ts packages/protocol/src/fileKnowledgeSchemas.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add packages/runtime/src/agent.ts packages/runtime/src/agent.test.ts packages/protocol/src/types.ts packages/protocol/src/schemas.ts
git commit -m "feat(runtime): include file knowledge in checkpoints"
```

---

### Task 9: 涉及文件摘要优先源文件，降低 shell regex 权重

**Files:**
- Modify: `apps/web/src/features/chat/turnFileSummary.ts`
- Modify: `apps/web/src/features/chat/turnFileSummary.test.ts`
- Modify: `apps/desktop/src/features/chat/turnFileSummary.ts`
- Modify: `apps/desktop/src/features/chat/turnFileSummary.test.ts`

- [ ] **Step 1: 写 failing web/desktop 测试**

Add the same tests to web and desktop `turnFileSummary.test.ts`:

```ts
it('shows read_document source files instead of only generated artifacts', () => {
  const summary = buildTurnFileSummary([
    {
      type: 'tool_call',
      toolName: 'read_document',
      status: 'completed',
      result: {
        source: { path: 'E:\\langchain\\dexin-agent\\_v1.0.docx', relativePath: '_v1.0.docx' },
        artifact: { path: 'E:\\langchain\\dexin-agent\\.nexus\\artifacts\\documents\\v1.md' },
      },
    },
  ], 'E:\\langchain\\dexin-agent');

  expect(summary.readFiles).toEqual([{ path: 'E:\\langchain\\dexin-agent\\_v1.0.docx' }]);
});

it('ignores malformed command pseudo paths when structured file metadata exists', () => {
  const summary = buildTurnFileSummary([
    {
      type: 'tool_call',
      toolName: 'read_document',
      status: 'completed',
      result: {
        source: { path: 'E:\\langchain\\dexin-agent\\_v1.0.docx' },
        artifact: { path: 'E:\\langchain\\dexin-agent\\.nexus\\artifacts\\documents\\v1.md' },
      },
    },
    {
      type: 'command_execution',
      status: 'completed',
      command: "python -c \"open(E:\\langchain\\dexin-agent\\_v1_decoded.txt).read(); p.text.strip\"",
      aggregatedOutput: "ENOENT: no such file or directory, stat 'E:\\langchain\\open(E:\\langchain\\dexin-agent\\_v1_decoded.txt'",
    },
  ], 'E:\\langchain\\dexin-agent');

  expect(summary.readFiles.map((entry) => entry.path)).toEqual(['E:\\langchain\\dexin-agent\\_v1.0.docx']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run apps/web/src/features/chat/turnFileSummary.test.ts apps/desktop/src/features/chat/turnFileSummary.test.ts
```

Expected: FAIL，`read_document` 没被识别，shell pseudo path 可能污染。

- [ ] **Step 3: 实现结构化元数据优先**

Modify both `turnFileSummary.ts` loops:

```ts
if (item.type === 'tool_call' && item.status !== 'failed') {
  for (const path of readStructuredFilePaths(item)) {
    const normalized = normalizeDisplayPath(path, workspaceRoot);
    if (normalized && !isInternalPath(normalized, workspaceRoot)) readFiles.set(normalized, { path: normalized });
  }
  if (item.toolName === 'read_file') {
    const path = normalizeDisplayPath(readReadFilePath(item), workspaceRoot);
    if (path && !isInternalPath(path, workspaceRoot)) readFiles.set(path, { path });
  }
  continue;
}
```

Add helper:

```ts
function readStructuredFilePaths(item: Record<string, unknown>): string[] {
  const result = readObject(item.result);
  const paths: string[] = [];
  const file = readObject(result.file);
  const source = readObject(result.source);
  if (readString(file.path)) paths.push(readString(file.path));
  if (readString(source.path)) paths.push(readString(source.path));
  return paths;
}
```

Tighten `cleanCommandPathToken()`:

```ts
if (/[()]/.test(cleaned) || /\.[A-Za-z_$][\w$]*(?:\(|$)/.test(cleaned)) return '';
```

Place that check before `return extractEmbeddedWindowsPath(cleaned) || cleaned;`.

- [ ] **Step 4: 运行测试并提交**

Run:

```bash
npx vitest run apps/web/src/features/chat/turnFileSummary.test.ts apps/desktop/src/features/chat/turnFileSummary.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add apps/web/src/features/chat/turnFileSummary.ts apps/web/src/features/chat/turnFileSummary.test.ts apps/desktop/src/features/chat/turnFileSummary.ts apps/desktop/src/features/chat/turnFileSummary.test.ts
git commit -m "feat(ui): summarize document source files"
```

---

### Task 10: Monitor 和 Activity 展示文件生命周期

**Files:**
- Modify: `apps/web/src/features/monitor/traceFormatters.ts`
- Modify: `apps/web/src/features/monitor/traceFormatters.test.ts`
- Modify: `apps/web/src/components/monitor/TraceInspector.tsx`
- Modify: `apps/web/src/components/workbench/LiveActivityHud.tsx`
- Modify: `apps/web/src/features/agents/agentWorkbenchModel.ts`
- Modify: same five desktop files under `apps/desktop/src/...`

- [ ] **Step 1: 写 failing formatter 测试**

Add to web and desktop `traceFormatters.test.ts`:

```ts
it('formats document lifecycle file traces', () => {
  const summary = traceSummary({
    version: 2,
    eventId: 'event-1',
    sequence: 1,
    runId: 'run-1',
    runKind: 'turn',
    threadId: 'thread-1',
    turnId: 'turn-1',
    spanId: 'span-1',
    category: 'file',
    name: 'document refreshed',
    lifecycle: 'completed',
    level: 'warning',
    occurredAt: '2026-07-23T08:00:00.000Z',
    payload: {
      action: 'refresh',
      path: 'E:\\langchain\\dexin-agent\\_v1.0.docx',
      artifactPath: 'E:\\langchain\\dexin-agent\\.nexus\\artifacts\\documents\\v1.md',
      staleReason: 'source_hash_changed',
      extractor: 'docx-text',
    },
  }, true);

  expect(summary).toContain('刷新');
  expect(summary).toContain('_v1.0.docx');
  expect(summary).toContain('source_hash_changed');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run apps/web/src/features/monitor/traceFormatters.test.ts apps/desktop/src/features/monitor/traceFormatters.test.ts
```

Expected: FAIL，摘要仍然是英文 action/path。

- [ ] **Step 3: 实现 lifecycle 摘要**

Modify both `traceFormatters.ts` `case 'file'`:

```ts
case 'file': {
  const action = p.action as string | undefined;
  const path = p.sourcePath as string | undefined || p.path as string | undefined;
  const artifactPath = p.artifactPath as string | undefined;
  const reason = p.staleReason as string | undefined;
  const extractor = p.extractor as string | undefined;
  const actionLabel = fileActionLabel(action, zh);
  const parts: string[] = [];
  if (actionLabel) parts.push(actionLabel);
  if (path) parts.push(truncate(path.split(/[/\\]/).pop() ?? path, 30));
  if (artifactPath && (action === 'extract' || action === 'refresh' || action === 'reuse')) parts.push(truncate(artifactPath.split(/[/\\]/).pop() ?? artifactPath, 24));
  if (reason) parts.push(reason);
  if (extractor) parts.push(extractor);
  if (p.addedLines || p.removedLines) parts.push(`+${p.addedLines ?? 0}/-${p.removedLines ?? 0}`);
  return parts.join(' · ') || trace.name;
}
```

Add helper:

```ts
function fileActionLabel(action: string | undefined, zh: boolean): string {
  const labels: Record<string, { zh: string; en: string }> = {
    read: { zh: '读取', en: 'read' },
    write: { zh: '写入', en: 'write' },
    patch: { zh: '修改', en: 'patch' },
    delete: { zh: '删除', en: 'delete' },
    checkpoint: { zh: '检查点', en: 'checkpoint' },
    extract: { zh: '提取', en: 'extract' },
    stale: { zh: '过期', en: 'stale' },
    refresh: { zh: '刷新', en: 'refresh' },
    reuse: { zh: '复用', en: 'reuse' },
  };
  const label = action ? labels[action] : undefined;
  return label ? (zh ? label.zh : label.en) : '';
}
```

- [ ] **Step 4: Inspector 显示源文件和 artifact**

Modify both `TraceInspector.tsx` typed payload rendering for `file`:

```tsx
{trace.category === 'file' ? (
  <div className="traceInspectorGrid">
    <KeyValue label={zh ? '动作' : 'Action'} value={String(payload.action ?? '')} />
    <KeyValue label={zh ? '源文件' : 'Source'} value={String(payload.sourcePath ?? payload.path ?? '')} />
    <KeyValue label="Artifact" value={String(payload.artifactPath ?? '')} />
    <KeyValue label="SHA-256" value={String(payload.sha256 ?? '')} />
    <KeyValue label={zh ? 'Artifact SHA' : 'Artifact SHA'} value={String(payload.artifactSha256 ?? '')} />
    <KeyValue label={zh ? '原因' : 'Reason'} value={String(payload.staleReason ?? '')} />
    <KeyValue label={zh ? '提取器' : 'Extractor'} value={String(payload.extractor ?? '')} />
  </div>
) : null}
```

Use the existing `KeyValue` component/function name in the file. If it is named differently, place the same labels in the existing inspector metadata grid.

- [ ] **Step 5: Activity 最近事件直接显示资源，不再拆“资源使用”**

Modify both `agentWorkbenchModel.ts` recent event mapping so `file` category returns a resource:

```ts
if (trace.category === 'file') {
  const payload = trace.payload as Record<string, unknown>;
  const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : typeof payload.path === 'string' ? payload.path : '';
  return {
    kind: 'file',
    label: `${fileEventActionLabel(String(payload.action ?? ''), locale)} · ${baseName(sourcePath)}`,
  };
}
```

Add helpers:

```ts
function fileEventActionLabel(action: string, locale: Locale): string {
  const zh = locale === 'zh';
  const labels: Record<string, [string, string]> = {
    read: ['读取', 'read'],
    extract: ['提取', 'extract'],
    reuse: ['复用', 'reuse'],
    stale: ['过期', 'stale'],
    refresh: ['刷新', 'refresh'],
    write: ['写入', 'write'],
    patch: ['修改', 'patch'],
    delete: ['删除', 'delete'],
    checkpoint: ['检查点', 'checkpoint'],
  };
  const label = labels[action] ?? [action, action];
  return zh ? label[0] : label[1];
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || value;
}
```

Keep `LiveActivityHud.tsx` as a visual consumer; only verify it still renders the event resource inline and does not reintroduce a separate resource list.

- [ ] **Step 6: 运行 UI 测试并提交**

Run:

```bash
npx vitest run apps/web/src/features/monitor/traceFormatters.test.ts apps/desktop/src/features/monitor/traceFormatters.test.ts apps/web/src/components/RunMonitorDrawer.test.ts apps/desktop/src/components/RunMonitorDrawer.test.ts apps/web/src/components/RightPane.test.ts apps/desktop/src/components/RightPane.test.ts
npx tsc -b
```

Expected: PASS。

Commit:

```bash
git add apps/web/src/features/monitor/traceFormatters.ts apps/web/src/features/monitor/traceFormatters.test.ts apps/web/src/components/monitor/TraceInspector.tsx apps/web/src/components/workbench/LiveActivityHud.tsx apps/web/src/features/agents/agentWorkbenchModel.ts apps/desktop/src/features/monitor/traceFormatters.ts apps/desktop/src/features/monitor/traceFormatters.test.ts apps/desktop/src/components/monitor/TraceInspector.tsx apps/desktop/src/components/workbench/LiveActivityHud.tsx apps/desktop/src/features/agents/agentWorkbenchModel.ts
git commit -m "feat(ui): show file knowledge lifecycle events"
```

---

### Task 11: 端到端正确性验收

**Files:**
- Modify only if prior tests reveal real defects in touched files.

- [ ] **Step 1: 跑核心工具/runtime 测试**

Run:

```bash
npx vitest run packages/protocol/src/fileKnowledgeSchemas.test.ts packages/protocol/src/runTraceSchemas.test.ts packages/tools/src/fileKnowledge.test.ts packages/tools/src/documentArtifacts.test.ts packages/tools/src/documentExtractors.test.ts packages/tools/src/builtin.test.ts packages/runtime/src/fileFreshnessPreflight.test.ts packages/runtime/src/agent.test.ts
```

Expected: PASS。

- [ ] **Step 2: 跑 UI 摘要和 monitor 测试**

Run:

```bash
npx vitest run apps/web/src/features/chat/turnFileSummary.test.ts apps/desktop/src/features/chat/turnFileSummary.test.ts apps/web/src/features/monitor/traceFormatters.test.ts apps/desktop/src/features/monitor/traceFormatters.test.ts apps/web/src/components/ItemView.test.ts apps/desktop/src/components/ItemView.test.ts
```

Expected: PASS。

- [ ] **Step 3: 全量质量门**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected:

- `npm run lint`: 0 error, 0 warning。
- `npm test`: 全量通过。
- `npm run build`: TypeScript build 0 error。

- [ ] **Step 4: 内置浏览器手工验收**

Start services if they are not running:

```bash
npm run dev
```

Open `http://127.0.0.1:5177/` in the in-app browser and verify:

- 用户请求分析 `A.docx` 后，涉及文件显示 `A.docx`，不是 `.nexus/artifacts/documents/*.md`。
- 修改 `A.docx` 后再次请求分析，活动栏最近事件出现“过期/刷新”文件事件。
- 运行监控 timeline 出现 `file.stale` 和 `file.refresh` 或新的 `file.extract`。
- 点击 trace inspector 能看到 source path、artifact path、source hash、artifact hash、extractor。
- 读取旧的 `.nexus/artifacts/documents/*.md` 不会返回旧内容；应提示使用 `read_document`。

- [ ] **Step 5: 最终提交**

If all gates pass and there are no unrelated dirty files staged:

```bash
git status --short
git add <only files changed by these tasks>
git commit -m "feat: add file knowledge lifecycle"
```

Expected: final commit includes only lifecycle work. Existing unrelated dirty files remain unstaged.

---

## 自检

- Spec coverage:
  - 文件指纹：Task 1, 2, 5。
  - 文档提取：Task 2, 3, 4。
  - 血缘账本：Task 3, 4, 5, 7。
  - Freshness preflight：Task 7。
  - 工具层硬保护：Task 5。
  - Checkpoint knowledge：Task 8。
  - Trace/监控/活动栏：Task 1, 6, 10。
  - 涉及文件摘要：Task 9。
  - MVP 验收：Task 11。
- Placeholder scan:
  - 未发现禁用占位词。
  - 每个测试都有具体断言；每个实现步骤都有明确文件和代码片段。
- Type consistency:
  - `FileFingerprint`、`DocumentArtifactRecord`、`FileFreshness` 名称从 Task 1 到 Task 11 一致。
  - trace file action 使用同一组值：`read/write/patch/delete/checkpoint/extract/stale/refresh/reuse`。
  - `read_document` tool result 使用 `source/artifact/stale/reused/textPreview`，UI 和 checkpoint 都读取同一结构。
