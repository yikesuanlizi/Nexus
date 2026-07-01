import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadId, ThreadMeta } from '@nexus/protocol';
import type { ThreadStore } from '@nexus/storage';
import { readJson, sendError, sendJson } from '../shared/http.js';

// 规范化线程标题（空字符串、非字符串或空内容返回 null）
// — Chinese: normalize thread title patch (null if not a valid string)
export function normalizeThreadTitlePatch(body: { title?: unknown }): string | null {
  if (typeof body.title !== 'string') return null;
  const title = body.title.trim();
  return title.length > 0 ? title : null;
}

// 规范化线程标签（必须是 Record<string, string>，否则返回 null）
// — Chinese: normalize thread tags patch (must be Record<string, string> or null)
function normalizeThreadTagsPatch(body: { tags?: unknown }): Record<string, string> | null {
  if (!body.tags || typeof body.tags !== 'object' || Array.isArray(body.tags)) return null;
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.tags)) {
    if (typeof value === 'string') {
      tags[key] = value;
    }
  }
  return tags;
}

// 更新线程标题，返回更新后的线程元信息（若线程不存在则返回 null）
// — Chinese: update thread title and return updated thread meta (null if missing)
export async function updateThreadTitle(store: ThreadStore, threadId: ThreadId, title: string): Promise<ThreadMeta | null> {
  const thread = await store.getThread(threadId);
  if (!thread) return null;
  await store.updateThreadMetadata(threadId, { title });
  return store.getThread(threadId);
}

// 处理 PATCH /api/threads/:id — 更新线程标题和/或标签
// — Chinese: handle PATCH /api/threads/:id — update thread title and/or tags
export async function handlePatchThread(req: IncomingMessage, res: ServerResponse, store: ThreadStore, threadId: ThreadId): Promise<void> {
  const body = await readJson<{ title?: unknown; tags?: unknown }>(req);
  const title = normalizeThreadTitlePatch(body);
  const tags = normalizeThreadTagsPatch(body);
  if (!title && !tags) {
    sendError(res, 400, 'Thread title or tags are required');
    return;
  }
  const current = await store.getThread(threadId);
  if (!current) {
    sendError(res, 404, 'Thread not found');
    return;
  }
  await store.updateThreadMetadata(threadId, {
    ...(title ? { title } : {}),
    ...(tags ? { tags: { ...(current.tags ?? {}), ...tags } } : {}),
  });
  const thread = await store.getThread(threadId);
  if (!thread) {
    sendError(res, 404, 'Thread not found');
    return;
  }
  sendJson(res, 200, { ok: true, thread });
}
