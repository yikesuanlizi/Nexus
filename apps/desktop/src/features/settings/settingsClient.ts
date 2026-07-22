import type { ThreadConfigUpdate } from '@nexus/protocol';
import type { RunConfig } from '../../config/config.js';
import { globalRuntimePayload } from './configState.js';

type Fetcher = typeof fetch;

async function patchConfig(
  fetcher: Fetcher,
  url: string,
  config: Partial<RunConfig>,
): Promise<void> {
  const payload = globalRuntimePayload(config);
  const response = await fetcher(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: payload }),
  });
  if (!response.ok) {
    throw new Error(`Failed to patch config: ${response.status} ${response.statusText}`);
  }
}

export const saveGlobalDefaults = (
  config: Partial<RunConfig>,
  fetcher: Fetcher = fetch,
): Promise<void> => patchConfig(fetcher, '/api/settings', config);

export async function saveActiveThreadConfig(
  threadId: string,
  update: ThreadConfigUpdate,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await fetcher(`/api/threads/${threadId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    throw new Error(`Failed to patch thread config: ${response.status} ${response.statusText}`);
  }
}
