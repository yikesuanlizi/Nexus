import type { RunTraceEnvelope, RunTraceSummary } from '@nexus/protocol';

export function projectRunTrace(input: RunTraceEnvelope[]): RunTraceSummary {
  const seen = new Set<string>();
  const events = [...input]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((event) => {
      if (seen.has(event.eventId)) return false;
      seen.add(event.eventId);
      return true;
    });

  const summary: RunTraceSummary = {
    status: 'pending',
    model: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    tools: { calls: 0, failed: 0, denied: 0 },
    items: { started: 0, completed: 0, failed: 0, byType: {} },
    agents: { spawned: 0, running: 0, failed: 0 },
    files: { changed: 0, addedLines: 0, removedLines: 0 },
  };

  for (const event of events) {
    if (event.lifecycle === 'started') {
      summary.currentSpan = { spanId: event.spanId, category: event.category, name: event.name };
    }
    if (event.category === 'turn') {
      if (event.lifecycle === 'started') {
        summary.status = 'running';
        summary.startedAt ??= event.occurredAt;
      } else if (event.lifecycle === 'completed') {
        summary.status = event.payload.status === 'interrupted' ? 'interrupted' : 'completed';
        summary.completedAt = event.occurredAt;
        summary.durationMs = event.durationMs;
      } else if (event.lifecycle === 'failed') {
        summary.status = 'failed';
        summary.completedAt = event.occurredAt;
        summary.durationMs = event.durationMs;
      }
      continue;
    }

    switch (event.category) {
      case 'model':
        if (event.lifecycle === 'completed') {
          summary.model.calls += 1;
          summary.model.inputTokens += event.payload.inputTokens ?? 0;
          summary.model.outputTokens += event.payload.outputTokens ?? 0;
          summary.model.cacheReadTokens += event.payload.cacheReadTokens ?? 0;
          summary.model.cacheWriteTokens += event.payload.cacheWriteTokens ?? 0;
          if (event.payload.ttftMs !== undefined) {
            summary.model.maxTtftMs = Math.max(summary.model.maxTtftMs ?? 0, event.payload.ttftMs);
          }
        }
        break;
      case 'tool':
        summary.tools.calls += 1;
        if (event.lifecycle === 'failed') summary.tools.failed += 1;
        if (event.payload.decision === 'deny') summary.tools.denied += 1;
        break;
      case 'item':
        if (event.lifecycle === 'started') summary.items.started += 1;
        if (event.lifecycle === 'completed') summary.items.completed += 1;
        if (event.lifecycle === 'failed' || event.payload.status === 'failed') summary.items.failed += 1;
        summary.items.byType[event.payload.itemType] = (summary.items.byType[event.payload.itemType] ?? 0) + 1;
        break;
      case 'agent':
        if (event.payload.action === 'spawn') summary.agents.spawned += 1;
        if (event.payload.action === 'started') summary.agents.running += 1;
        if (event.payload.action === 'failed') summary.agents.failed += 1;
        break;
      case 'file':
        if (event.lifecycle === 'completed' || event.lifecycle === 'instant') {
          summary.files.changed += 1;
          summary.files.addedLines += event.payload.addedLines ?? 0;
          summary.files.removedLines += event.payload.removedLines ?? 0;
        }
        break;
      case 'checkpoint':
        summary.lastCheckpointId = event.payload.checkpointId;
        break;
      case 'error':
        summary.lastError = { code: event.payload.code, message: event.payload.message };
        if (summary.status !== 'completed') summary.status = 'failed';
        break;
      default:
        break;
    }
  }

  return summary;
}
