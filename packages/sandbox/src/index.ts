export { Sandbox, resolveSandboxEffective } from './sandbox.js';
export type { SandboxLevel, SandboxConfig, ExecPolicyRule, ExecPolicyResult } from './sandbox.js';
export { DenyAllApprovalHandler, AutoApproveHandler } from './approval.js';
export type { ApprovalHandler } from './approval.js';
export { BUILTIN_PRESETS, DEFAULT_PRESET, getPreset } from './presets.js';
export type { ApprovalPolicy, PermissionPreset } from './presets.js';

export const SANDBOX_VERSION = '0.1.0';
