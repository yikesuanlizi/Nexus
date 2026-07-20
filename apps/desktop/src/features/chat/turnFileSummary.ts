export interface TurnFileSummaryEntry {
  path: string;
}

export interface TurnChangedFileSummaryEntry extends TurnFileSummaryEntry {
  addedLines: number;
  removedLines: number;
}

export interface TurnFileSummary {
  readFiles: TurnFileSummaryEntry[];
  changedFiles: TurnChangedFileSummaryEntry[];
}

export function buildTurnFileSummary(items: Array<Record<string, unknown>>, workspaceRoot = ''): TurnFileSummary {
  const readFiles = new Map<string, TurnFileSummaryEntry>();
  const changedFiles = new Map<string, TurnChangedFileSummaryEntry>();

  for (const item of items) {
    if (item.type === 'tool_call' && item.toolName === 'read_file' && item.status !== 'failed') {
      const path = normalizeDisplayPath(readReadFilePath(item), workspaceRoot);
      if (path && !isInternalPath(path, workspaceRoot)) readFiles.set(path, { path });
      continue;
    }
    if (item.type === 'command_execution' && item.status !== 'failed') {
      for (const candidate of extractCommandFilePaths(readString(item.command), workspaceRoot)) {
        const path = normalizeDisplayPath(candidate, workspaceRoot);
        if (path && !isInternalPath(path, workspaceRoot)) readFiles.set(path, { path });
      }
      continue;
    }
    if (item.type === 'file_change' && item.status !== 'failed') {
      for (const change of readArray(item.changes)) {
        const path = normalizeDisplayPath(readString(change.path), workspaceRoot);
        if (!path || isInternalPath(path, workspaceRoot)) continue;
        const previous = changedFiles.get(path) ?? { path, addedLines: 0, removedLines: 0 };
        previous.addedLines += readNumber(change.addedLines) ?? sumHunksForPath(item, change.path, 'addedLines');
        previous.removedLines += readNumber(change.removedLines) ?? sumHunksForPath(item, change.path, 'removedLines');
        changedFiles.set(path, previous);
      }
    }
  }

  return {
    readFiles: [...readFiles.values()],
    changedFiles: [...changedFiles.values()],
  };
}

function readReadFilePath(item: Record<string, unknown>): string {
  const result = readObject(item.result);
  const args = readObject(item.arguments);
  return readString(result.path)
    || readArtifactRefPath(result)
    || readString(args.filePath)
    || readString(args.path);
}

function readArtifactRefPath(value: Record<string, unknown>): string {
  const refs = readArray(value.artifactRefs);
  const ref = refs.find((entry) => readString(entry.path));
  return ref ? readString(ref.path) : '';
}

function sumHunksForPath(item: Record<string, unknown>, pathValue: unknown, key: 'addedLines' | 'removedLines'): number {
  const path = readString(pathValue);
  return readArray(item.hunks)
    .filter((hunk) => !path || readString(hunk.path) === path)
    .reduce((sum, hunk) => sum + (readNumber(hunk[key]) ?? 0), 0);
}

function normalizeDisplayPath(path: string, workspaceRoot: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (isAbsolutePath(trimmed) || !workspaceRoot.trim()) return trimmed;
  const separator = workspaceRoot.includes('/') && !workspaceRoot.includes('\\') ? '/' : '\\';
  return `${workspaceRoot.replace(/[\\/]+$/, '')}${separator}${trimmed.replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`;
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

function isInternalPath(path: string, workspaceRoot: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/.codex/')
    || normalized.endsWith('/.codex')
    || normalized.includes('/node_modules/')
    || normalized.includes('/dist/')
    || normalized.includes('/build/')
    || normalized.includes('/coverage/')
    || normalized.includes('/.vite/')
    || normalized.includes('/appdata/local/temp/')
    || normalized.includes('/windows/temp/')
    || normalized.startsWith('/tmp/')
    || isRootHelperArtifact(path, workspaceRoot);
}

function isRootHelperArtifact(path: string, workspaceRoot: string): boolean {
  const basename = baseName(path).toLowerCase();
  if (!basename.startsWith('_')) return false;
  if (/^_read_[^.]+\.(py|js|ts|mjs|cjs)$/i.test(basename)) return true;
  if (/^_.*(?:dump|scratch|temp|tmp).*\.[^.]+$/i.test(basename)) return true;
  if (!isDirectWorkspaceChild(path, workspaceRoot)) return false;
  return /^_.*\.(py|js|ts|mjs|cjs|txt|json|log|tmp|xml)$/i.test(basename)
    && /(read|extract|dump|scratch|temp|tmp|docx|pdf|pptx|xlsx)/i.test(basename);
}

function isDirectWorkspaceChild(path: string, workspaceRoot: string): boolean {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!root) return false;
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (!normalized.startsWith(`${root}/`)) return false;
  return !normalized.slice(root.length + 1).includes('/');
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function extractCommandFilePaths(command: string, workspaceRoot: string): string[] {
  if (!command.trim()) return [];
  return shellTokens(command)
    .map(cleanCommandPathToken)
    .filter((token) => token && looksLikeFilePath(token, workspaceRoot));
}

function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  for (const char of command) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = '';
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function cleanCommandPathToken(token: string): string {
  return token
    .replace(/^[<>(){}[\],;]+/, '')
    .replace(/[<>(){}[\],;]+$/, '')
    .trim();
}

function looksLikeFilePath(token: string, workspaceRoot: string): boolean {
  if (!token || token.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  if (!/\.[A-Za-z0-9]{1,8}$/.test(token)) return false;
  return isAbsolutePath(token) || token.includes('/') || token.includes('\\') || Boolean(workspaceRoot.trim());
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) : [];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
