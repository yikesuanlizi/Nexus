import { z } from 'zod';

/** SSH credential metadata. Secret values are intentionally not represented. */
export const sshAuthMetadataSchema = z.object({
  method: z.enum(['agent', 'password', 'private_key', 'credential_store']),
  credentialRef: z.string().trim().min(1).max(300).optional(),
  keyFingerprint: z.string().trim().max(300).optional(),
}).strict();

export const sshProfileSchema = z.object({
  profileId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().trim().min(1).max(120),
  auth: sshAuthMetadataSchema,
  hostFingerprint: z.string().trim().max(300).optional(),
  osCredentialRef: z.string().trim().max(300).optional(),
  environmentId: z.string().trim().max(160).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export type SshAuthMetadata = z.infer<typeof sshAuthMetadataSchema>;
export type SshProfile = z.infer<typeof sshProfileSchema>;

export interface SshSessionConnection extends Omit<SshProfile, 'profileId' | 'createdAt' | 'updatedAt'> {
  sessionOnly: true;
}

// Ops 任务交互集成点：task-control 可在内存中携带 sessionOnly；保存接口只接受 SshProfile 元数据。

export interface SshTestDiagnostics {
  ok: boolean;
  status: 'ready' | 'not_configured' | 'failed';
  host: string;
  port: number;
  user: string;
  authMethod: SshAuthMetadata['method'];
  hostFingerprint?: string;
  credentialRef?: string;
  message: string;
}

/** Drop secret-shaped fields before a profile can be persisted or returned. */
export function sanitizeSshProfileInput(input: unknown): SshProfile {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth as Record<string, unknown> : {};
  const hasSecretKey = (record: Record<string, unknown>): boolean => Object.keys(record)
    .some((key) => /password|passphrase|private[_-]?key|secret|token|keyvalue|credentialvalue/i.test(key));
  if (hasSecretKey(raw) || hasSecretKey(auth)) {
    throw new Error('SSH secret values must remain in the OS credential store and cannot be persisted.');
  }
  const parsed = sshProfileSchema.parse({
    profileId: raw.profileId,
    name: raw.name,
    host: raw.host,
    user: raw.user,
    auth: {
      method: auth.method,
      credentialRef: auth.credentialRef,
      keyFingerprint: auth.keyFingerprint,
    },
    hostFingerprint: raw.hostFingerprint,
    osCredentialRef: raw.osCredentialRef,
    environmentId: raw.environmentId,
    port: Number(raw.port ?? 22),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  });
  return parsed;
}

export function sanitizeSshSessionConnection(input: unknown): SshSessionConnection {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const profile = sanitizeSshProfileInput({ ...raw, profileId: 'session-only' });
  const { profileId: _profileId, createdAt: _createdAt, updatedAt: _updatedAt, ...connection } = profile;
  return { ...connection, sessionOnly: true };
}

export function redactSshDiagnostics(input: SshTestDiagnostics): SshTestDiagnostics {
  return {
    ok: input.ok,
    status: input.status,
    host: input.host,
    port: input.port,
    user: input.user,
    authMethod: input.authMethod,
    ...(input.hostFingerprint ? { hostFingerprint: input.hostFingerprint } : {}),
    ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
    message: input.message.replace(/(password|private[_ -]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]'),
  };
}
