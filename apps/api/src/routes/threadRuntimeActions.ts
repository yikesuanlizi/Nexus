import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentLoop } from '@nexus/runtime';
import type { ThreadId } from '@nexus/protocol';
import { readJson, sendJson } from '../shared/http.js';
import type { RunControlAction } from './runMonitorRoute.js';

// 处理线程回滚 — Chinese: handle thread rollback
export async function handleRollbackThreadRuntimeAction(options: {
  req: IncomingMessage;
  res: ServerResponse;
  threadId: ThreadId;
  createAgent: () => Promise<AgentLoop>;
}): Promise<void> {
  const body = await readJson<{ count?: number }>(options.req);
  const agent = await options.createAgent();
  const result = await agent.rollbackThread(options.threadId, body.count ?? 1);
  sendJson(options.res, 200, result);
}

// 处理运行控制动作（interrupt/resume/rollback）并与 AgentLoop 对接
// — Chinese: handle run control actions (interrupt/resume/rollback) with AgentLoop
export async function handleRunControlAction(
  action: RunControlAction,
  request: {
    threadId?: string;
    payload: Record<string, unknown>;
  },
  createAgent: () => Promise<AgentLoop>,
): Promise<unknown> {
  if (!request.threadId) return { ok: false, error: 'threadId is required for run control' };
  const agent = await createAgent();
  if (action === 'interrupt') return { interrupted: agent.interrupt(request.threadId) };
  if (action === 'resume') return await agent.resumeRunning(request.threadId);
  if (action === 'rollback') {
    const count = typeof request.payload.count === 'number' ? request.payload.count : 1;
    return await agent.rollbackThread(request.threadId, count);
  }
  return { ok: false, unsupported: action };
}
