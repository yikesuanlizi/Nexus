// 沙箱包统一入口：聚合 sandbox / approval / presets 三个模块
export { Sandbox, resolveSandboxEffective } from './sandbox.js';
export type { SandboxLevel, SandboxConfig, ExecPolicyRule, ExecPolicyResult } from './sandbox.js';
// 审批处理器：默认拒绝 / 自动通过
export { DenyAllApprovalHandler, AutoApproveHandler } from './approval.js';
export type { ApprovalHandler } from './approval.js';
// 权限预设：内置三档预设 + 查询函数
export { BUILTIN_PRESETS, DEFAULT_PRESET, getPreset } from './presets.js';
export type { ApprovalPolicy, PermissionPreset } from './presets.js';

// 沙箱包协议版本
export const SANDBOX_VERSION = '0.1.0';
