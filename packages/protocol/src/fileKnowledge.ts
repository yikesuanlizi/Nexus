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
