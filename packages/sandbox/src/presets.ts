// 引入沙箱等级类型
import type { SandboxLevel } from './sandbox.js';

// ─── Approval Policy ────────────────────────────────────────────────────────
/**
 * Permission presets combine approval behavior with sandbox scope.
 *
 * - on_request: 每次工具调用都需要用户批准
 * - never:      全程自动批准（危险模式）
 * - on_failure: 仅在命令失败时请求批准重试
 */
// 审批策略：on_request（每次询问）/ never（从不问）/ on_failure（失败时询问）
export type ApprovalPolicy = 'on_request' | 'never' | 'on_failure';

// ─── Permission Preset ──────────────────────────────────────────────────────
/**
 * ApprovalPreset — 将审批策略 + 权限配置打包为一个预设。
 *
 * Three built-in presets:
 *   read_only / workspace / danger_full_access
 */
// 权限预设：把审批策略、沙箱等级、网络权限打包成一个开箱即用的配置
export interface PermissionPreset {
  /** Stable identifier. */
  // 预设稳定标识
  id: 'read_only' | 'workspace' | 'danger_full_access';
  /** Display label (Chinese). */
  // 显示名（中文）
  labelZh: string;
  /** Display label (English). */
  // 显示名（英文）
  labelEn: string;
  /** Short description (Chinese). */
  // 简短描述（中文）
  descriptionZh: string;
  /** Short description (English). */
  // 简短描述（英文）
  descriptionEn: string;
  /** Approval policy. */
  // 审批策略
  approval: ApprovalPolicy;
  /** Sandbox level. */
  // 沙箱等级
  sandboxLevel: SandboxLevel;
  /** Whether network access is granted. */
  // 是否允许访问网络
  networkAllowed: boolean;
  /** Whether tool execution requires approval (derived from approval). */
  // 工具执行是否需要审批（由 approval 派生）
  requiresApproval: boolean;
}

// ─── Built-in Presets ───────────────────────────────────────────────────────
// 内置的三档预设
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
// 根据预设 id 查找内置预设，找不到返回 undefined
export function getPreset(id: string): PermissionPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}

/** Default preset. */
// 默认预设：workspace（写工作区模式）
export const DEFAULT_PRESET = BUILTIN_PRESETS[1]; // workspace
