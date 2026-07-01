// Nexus runtime 包总入口：对外导出 AgentLoop、状态管理、中间件、工具治理、MCP、工作流等核心类型与函数。
// 本文件仅做 re-export，不新增逻辑。

// ─── Agent 主循环 ─────────────────────────────────────────────────────
export { AgentLoop } from './agent.js';
export type {
  AgentConfig,
  AgentRoleProfile,
  AgentRoleProfiles,
  ResolvedAgentRoleProfile,
  ToolBindingMode,
} from './agent.js';

// ─── 工具治理 ──────────────────────────────────────────────────────────
export type { ToolGovernanceConfig } from './toolGovernance.js';

// ─── MCP 客户端与运行时管理 ────────────────────────────────────────────
export {
  McpRuntimeManager,
  McpStdioClient,
  mcpNamespacedToolName,
  mcpToolDisplayName,
  normalizeMcpServerId,
  parseMcpNamespacedToolName,
} from './mcpClient.js';
export type {
  McpCallToolResult,
  McpServerConfig,
  McpServerRuntimeStatus,
  McpServerStatusView,
  McpToolInfo,
} from './mcpClient.js';

// ─── 线程状态管理 ──────────────────────────────────────────────────────
export { ThreadStateManager, createThreadState, createTurnSummary } from './state.js';
export type { ThreadState, ThreadStatus, TurnSummary, TurnError, Checkpoint, CheckpointLine } from './state.js';

// ─── 运行时中间件 ──────────────────────────────────────────────────────
export { composeRuntimeMiddleware } from './middleware.js';

// ─── 模型输出合法性校验 ────────────────────────────────────────────────
export { leaksToolProtocol, validateModelOutputItems, validateThreadItemsForPersistence } from './modelOutput.js';

// ─── 错误类型与诊断 ────────────────────────────────────────────────────
export { NexusRuntimeError, affectsTurnStatus, isRecoverableStreamError, toNexusErrorInfo } from './runtimeError.js';

// ─── Guardian 安全审查 ────────────────────────────────────────────────
export { createGuardianMiddleware } from './guardian.js';
export type { ModelOutputItem, ValidatedModelOutput } from './modelOutput.js';
export type {
  GuardianAssessment,
  GuardianAuthorization,
  GuardianConfig,
  GuardianReviewMode,
  GuardianReviewRequest,
  GuardianReviewer,
  GuardianRiskLevel,
  GuardianTranscriptEntry,
} from './guardian.js';

// ─── 工作流（Workflow）蓝图定义与执行 ───────────────────────────────────
export {
  assertValidWorkflowDefinition,
  blockWorkflowNode,
  blockWorkflowStep,
  completeWorkflowNode,
  completeWorkflowStep,
  compileWorkflowBlueprint,
  createDefaultWorkflowComponentRegistry,
  createBuiltinWorkflowComponentRegistry,
  createToolWorkflowComponent,
  createWorkflowDefinitionFromGoal,
  createWorkflowComponentRegistryFromTools,
  createWorkflowRegistryWithUserComponents,
  createWorkflowRunFromDefinition,
  createWorkflowRun,
  executeWorkflowNode,
  failWorkflowNode,
  failWorkflowStep,
  renderWorkflowTemplate,
  normalizeWorkflowSnapshot,
  normalizeUserWorkflowComponent,
  planWorkflowDefinitionFromGoal,
  publishWorkflowSnapshot,
  replanWorkflow,
  resumeWorkflowRun,
  retryWorkflowNode,
  runNextWorkflowNodes,
  runWorkflowNode,
  runnableWorkflowNodes,
  runnableWorkflowSteps,
  startWorkflowNode,
  startWorkflowStep,
  updateWorkflowNodeContract,
  WorkflowComponentRegistry,
} from './workflow.js';
export type {
  RuntimeMiddleware,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeToolRequest,
  RuntimeToolResponse,
  RuntimeTurnContext,
} from './middleware.js';
export type {
  WorkflowApprovalMode,
  WorkflowBlueprintCompileResult,
  WorkflowBlueprintDiagnostic,
  WorkflowComponentDefinition,
  WorkflowComponentField,
  WorkflowComponentFieldKind,
  WorkflowComponentSource,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowEvent,
  WorkflowExecutionRun,
  WorkflowExecutorKind,
  WorkflowGraphDefinition,
  WorkflowLayoutDefinition,
  WorkflowNode,
  WorkflowNodeExecutor,
  WorkflowNodeExecutorContext,
  WorkflowNodeExecutorResult,
  WorkflowNodeExecutors,
  WorkflowNodeRun,
  WorkflowPlannerModel,
  WorkflowRun,
  WorkflowRuntimeAction,
  WorkflowRuntimeContext,
  WorkflowRuntimeOptions,
  WorkflowRuntimeResult,
  WorkflowRunStatus,
  WorkflowSnapshot,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowVariableDefinition,
  WorkflowVariableNamespace,
  WorkflowVariablePool,
  WorkflowVersionSummary,
} from './workflow.js';

// Runtime 包的版本号，供外部诊断与日志输出使用。
export const RUNTIME_VERSION = '0.1.0';
