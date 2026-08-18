import type { AccessPolicyConfig, ThreadRunConfigOverrides } from '@nexus/protocol';

export type ThreadConfigOverrides = Pick<
  ThreadRunConfigOverrides,
  'provider' | 'model' | 'baseUrl' | 'permissions' | 'reasoningEffort' | 'runProfile'
>;

export interface ThreadConfigResponse {
  overrides: ThreadConfigOverrides;
  accessPolicy?: AccessPolicyConfig | null;
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

export async function fetchThreadAccessPolicy(threadId: string): Promise<AccessPolicyConfig | null> {
  const response = await fetch(`/api/threads/${threadId}/config`);
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as ThreadConfigResponse;
  return data.accessPolicy ?? null;
}

export async function patchThreadAccessPolicy(
  threadId: string,
  accessPolicy: AccessPolicyConfig,
): Promise<AccessPolicyConfig | null> {
  const response = await fetch(`/api/threads/${threadId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessPolicy }),
  });
  if (!response.ok) {
    throw new Error('Failed to patch thread access policy');
  }
  const data = (await response.json()) as ThreadConfigResponse;
  return data.accessPolicy ?? null;
}
