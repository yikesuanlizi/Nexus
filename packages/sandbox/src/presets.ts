import type { SandboxLevel } from './sandbox.js';

// ─── Approval Policy ────────────────────────────────────────────────────────
/**
 * Permission presets combine approval behavior with sandbox scope.
 *
 * - on_request: 每次工具调用都需要用户批准
 * - never:      全程自动批准（危险模式）
 * - on_failure: 仅在命令失败时请求批准重试
 */
export type ApprovalPolicy = 'on_request' | 'never' | 'on_failure';

// ─── Permission Preset ──────────────────────────────────────────────────────
/**
 * ApprovalPreset — 将审批策略 + 权限配置打包为一个预设。
 *
 * Three built-in presets:
 *   read_only / workspace / danger_full_access
 */
export interface PermissionPreset {
  /** Stable identifier. */
  id: 'read_only' | 'workspace' | 'danger_full_access';
  /** Display label (Chinese). */
  labelZh: string;
  /** Display label (English). */
  labelEn: string;
  /** Short description (Chinese). */
  descriptionZh: string;
  /** Short description (English). */
  descriptionEn: string;
  /** Approval policy. */
  approval: ApprovalPolicy;
  /** Sandbox level. */
  sandboxLevel: SandboxLevel;
  /** Whether network access is granted. */
  networkAllowed: boolean;
  /** Whether tool execution requires approval (derived from approval). */
  requiresApproval: boolean;
}

// ─── Built-in Presets ───────────────────────────────────────────────────────
export const BUILTIN_PRESETS: PermissionPreset[] = [
  {
    id: 'read_only',
    labelZh: '只读',
    labelEn: 'Read Only',
    descriptionZh: '只能读取工作区文件。编辑文件或执行命令需要批准。',
    descriptionEn:
      'Can read files in the workspace. Approval required to edit files or run commands.',
    approval: 'on_request',
    sandboxLevel: 'readonly',
    networkAllowed: false,
    requiresApproval: true,
  },
  {
    id: 'workspace',
    labelZh: '默认',
    labelEn: 'Default',
    descriptionZh:
      '可以读写工作区文件、执行命令。访问网络或外部文件需要批准。',
    descriptionEn:
      'Can read and edit workspace files, run commands. Approval required for network or external files.',
    approval: 'on_request',
    sandboxLevel: 'workspace_write',
    networkAllowed: false,
    requiresApproval: true,
  },
  {
    id: 'danger_full_access',
    labelZh: '完全访问',
    labelEn: 'Full Access',
    descriptionZh:
      '可编辑任意文件、访问网络，无需批准。请谨慎使用。',
    descriptionEn:
      'Can edit any file and access the network without approval. Use with caution.',
    approval: 'never',
    sandboxLevel: 'full',
    networkAllowed: true,
    requiresApproval: false,
  },
];

/** Look up a built-in preset by id. */
export function getPreset(id: string): PermissionPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}

/** Default preset. */
export const DEFAULT_PRESET = BUILTIN_PRESETS[1]; // workspace
