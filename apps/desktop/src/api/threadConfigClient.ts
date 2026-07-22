export interface ThreadConfigOverrides {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export interface ThreadConfigResponse {
  overrides: ThreadConfigOverrides;
}

export async function fetchThreadConfigOverrides(threadId: string): Promise<ThreadConfigOverrides> {
  const response = await fetch(`/api/threads/${threadId}/config`);
  if (!response.ok) {
    return {};
  }
  const data = (await response.json()) as ThreadConfigResponse;
  return data.overrides ?? {};
}

export async function patchThreadConfigOverrides(
  threadId: string,
  overrides: ThreadConfigOverrides,
): Promise<ThreadConfigOverrides> {
  const response = await fetch(`/api/threads/${threadId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides }),
  });
  if (!response.ok) {
    throw new Error('Failed to patch thread config overrides');
  }
  const data = (await response.json()) as ThreadConfigResponse;
  return data.overrides ?? {};
}
