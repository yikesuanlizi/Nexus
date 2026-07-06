// 协议层统一入口：聚合 types、schemas 和 a2a 三个模块
// 英文说明：Central entry re-exporting types + schemas + a2a adapters
export * from './types.js';
export * from './schemas.js';
export * from './a2a/index.js';

// 协议版本号：用于跨端兼容性与版本协商；英文说明：Protocol version for cross-runtime compatibility
export const PROTOCOL_VERSION = '0.1.0';
