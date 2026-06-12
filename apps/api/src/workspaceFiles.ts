import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError, sendJson } from './http.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.cache']);
const MAX_ENTRIES = 400;
const MAX_PREVIEW_BYTES = 96 * 1024;

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
  updatedAt: string;
  extension?: string;
}

function resolveWorkspacePath(root: string | null, relativePath: string | null): { root: string; target: string; relativePath: string } {
  const resolvedRoot = path.resolve(root?.trim() || '');
  if (!resolvedRoot || resolvedRoot === path.resolve('.')) throw new Error('Workspace root is required');
  const cleanRelative = (relativePath ?? '').replace(/^[\\/]+/, '');
  const target = path.resolve(resolvedRoot, cleanRelative);
  const boundary = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(boundary)) throw new Error('Path escapes workspace root');
  return { root: resolvedRoot, target, relativePath: path.relative(resolvedRoot, target).replace(/\\/g, '/') };
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
  return sample.replace(/[\t\n\r -~\u00a0-\uffff]/g, '').length < 8;
}

export async function handleWorkspaceFilesRoute(options: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}): Promise<boolean> {
  if (options.req.method !== 'GET') return false;
  if (options.url.pathname !== '/api/workspaces/files' && options.url.pathname !== '/api/workspaces/preview') return false;

  try {
    const { root, target, relativePath } = resolveWorkspacePath(options.url.searchParams.get('root'), options.url.searchParams.get('path'));
    if (options.url.pathname === '/api/workspaces/files') {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        sendError(options.res, 400, 'Path is not a directory');
        return true;
      }
      const dirents = await fs.readdir(target, { withFileTypes: true });
      const entries = await Promise.all(dirents
        .filter((entry) => !(entry.isDirectory() && IGNORED_DIRS.has(entry.name)))
        .slice(0, MAX_ENTRIES)
        .map(async (entry): Promise<WorkspaceFileEntry> => {
          const absolute = path.join(target, entry.name);
          const entryStat = await fs.stat(absolute);
          const relative = path.relative(root, absolute).replace(/\\/g, '/');
          const kind = entry.isDirectory() ? 'directory' : 'file';
          return {
            name: entry.name,
            path: relative,
            kind,
            size: entryStat.size,
            updatedAt: entryStat.mtime.toISOString(),
            extension: kind === 'file' ? path.extname(entry.name).slice(1).toLowerCase() : undefined,
          };
        }));
      entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
      sendJson(options.res, 200, { root, path: relativePath, entries });
      return true;
    }

    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      sendError(options.res, 400, 'Path is not a file');
      return true;
    }
    const handle = await fs.open(target, 'r');
    try {
      const length = Math.min(stat.size, MAX_PREVIEW_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      const text = isProbablyText(buffer) ? buffer.toString('utf8') : '';
      sendJson(options.res, 200, {
        root,
        path: relativePath,
        name: path.basename(target),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        truncated: stat.size > MAX_PREVIEW_BYTES,
        text,
        binary: !text && stat.size > 0,
      });
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    sendError(options.res, 400, error instanceof Error ? error.message : String(error));
    return true;
  }
}
