import { createHash } from 'node:crypto';
import type { ChatMessage, ToolDefinition } from '@nexus/model-gateway';

export interface PromptCacheShape {
  systemHash: string;
  toolsHash: string;
  prefixHash: string;
}

export function buildPromptCacheShape(
  messages: Pick<ChatMessage, 'role' | 'content'>[],
  tools: ToolDefinition[],
): PromptCacheShape {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content);
  const systemHash = sha256(stableStringify(systemMessages));
  const toolsHash = sha256(stableStringify(tools));
  return {
    systemHash,
    toolsHash,
    prefixHash: sha256(`${systemHash}:${toolsHash}`),
  };
}

export function comparePromptCacheShape(
  previous: PromptCacheShape | undefined,
  next: PromptCacheShape,
): { stable: boolean; reasons: Array<'system' | 'tools'> } {
  if (!previous) return { stable: true, reasons: [] };
  const reasons: Array<'system' | 'tools'> = [];
  if (previous.systemHash !== next.systemHash) reasons.push('system');
  if (previous.toolsHash !== next.toolsHash) reasons.push('tools');
  return { stable: reasons.length === 0, reasons };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
