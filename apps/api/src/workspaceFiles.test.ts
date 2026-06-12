import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { handleWorkspaceFilesRoute } from './workspaceFiles.js';

function req(method: string, url: string): IncomingMessage {
  return Object.assign(Readable.from([]), { method, url }) as IncomingMessage;
}

function res(): ServerResponse & { status?: number; body?: unknown } {
  const output = {
    writeHead(status: number) {
      output.status = status;
      return output;
    },
    end(raw: string) {
      output.body = raw ? JSON.parse(raw) : undefined;
    },
  } as unknown as ServerResponse & { status?: number; body?: unknown };
  return output;
}

async function route(url: string) {
  const response = res();
  const parsed = new URL(url, 'http://localhost');
  const handled = await handleWorkspaceFilesRoute({ req: req('GET', url), res: response, url: parsed });
  return { handled, response };
}

describe('workspace files route', () => {
  it('lists workspace entries and previews text files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-files-'));
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'README.md'), '# Nexus\n');
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const ok = true;\n');

    const listed = await route(`/api/workspaces/files?root=${encodeURIComponent(root)}`);
    expect(listed.handled).toBe(true);
    expect(listed.response.status).toBe(200);
    expect(listed.response.body).toMatchObject({
      entries: [
        { name: 'src', kind: 'directory' },
        { name: 'README.md', kind: 'file' },
      ],
    });

    const preview = await route(`/api/workspaces/preview?root=${encodeURIComponent(root)}&path=${encodeURIComponent('src/index.ts')}`);
    expect(preview.response.status).toBe(200);
    expect(preview.response.body).toMatchObject({ name: 'index.ts', text: 'export const ok = true;\n', binary: false });
  });

  it('rejects paths outside the workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-files-'));
    const result = await route(`/api/workspaces/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent('../')}`);
    expect(result.response.status).toBe(400);
    expect(result.response.body).toMatchObject({ error: 'Path escapes workspace root' });
  });
});
