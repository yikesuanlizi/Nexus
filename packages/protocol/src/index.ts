// 协议层统一入口：聚合 types 和 schemas 两个模块
// 英文说明：Central entry re-exporting types + schemas
export * from './types.js';
export * from './schemas.js';

// 协议版本号：用于跨端兼容性与版本协商；英文说明：Protocol version for cross-runtime compatibility
export const PROTOCOL_VERSION = '0.1.0';
