// A2A 适配层统一出口：导出 TaskStore、AgentExecutor、AgentCard 构建器
// 英文说明：A2A adapter layer entry — exports TaskStore, AgentExecutor, AgentCard builder

export { NexusTaskStore } from './nexusTaskStore.js';
export type { TaskStoreBackend } from './nexusTaskStore.js';
export { NexusAgentExecutor } from './nexusAgentExecutor.js';
export type { AgentRuntimePort, NexusAgentExecutorOptions } from './nexusAgentExecutor.js';
export { buildAgentCard } from './agentCardBuilder.js';
export type { NexusAgentCardConfig } from './agentCardBuilder.js';
