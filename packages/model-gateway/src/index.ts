// model-gateway 包统一入口：聚合 types / providers / gateway 三个模块
// 英文说明：Central entry, re-exporting all public symbols
export * from './types.js';
export { estimateChatTokens, ModelGateway, normalizeUsage, resolveCacheStrategy } from './gateway.js';
export {
  getProvider,
  listProviders,
  listRemoteProviders,
  listLocalProviders,
  listAllProviders,
  resolveApiKey,
  detectAvailableProviders,
  loadConfig,
  saveConfig,
  saveApiKey,
  removeApiKey,
  addCustomProvider,
  apiKeySummary,
} from './providers.js';
export type { ProviderEntry } from './providers.js';

// model-gateway 包协议版本；英文说明：Package protocol version
export const MODEL_GATEWAY_VERSION = '0.1.0';
