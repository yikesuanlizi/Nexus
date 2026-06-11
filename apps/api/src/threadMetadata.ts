import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadId, ThreadMeta } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { readJson, sendError, sendJson } from './http.js';

export function normalizeThreadTitlePatch(body: { title?: unknown }): string | null {
  if (typeof body.title !== 'string') return null;
  const title = body.title.trim();
  return title.length > 0 ? title : null;
}

export async function updateThreadTitle(store: ThreadStore, threadId: ThreadId, title: string): Promise<ThreadMeta | null> {
  const thread = await store.getThread(threadId);
  if (!thread) return null;
  await store.updateThreadMetadata(threadId, { title });
  return store.getThread(threadId);
}

export async function handlePatchThread(req: IncomingMessage, res: ServerResponse, store: ThreadStore, threadId: ThreadId): Promise<void> {
  const title = normalizeThreadTitlePatch(await readJson<{ title?: unknown }>(req));
  if (!title) {
    sendError(res, 400, 'Thread title is required');
    return;
  }
  const thread = await updateThreadTitle(store, threadId, title);
  if (!thread) {
    sendError(res, 404, 'Thread not found');
    return;
  }
  sendJson(res, 200, { ok: true, thread });
}
