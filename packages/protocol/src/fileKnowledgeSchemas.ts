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
