import type { StorageMode, ThreadStore } from '@nexus/storage';
import { resolveAuthConfig, type AuthConfig, type AuthMode } from '../auth/auth.js';

// 部署模式设置存储键 — Chinese: deployment mode storage key
export const DEPLOYMENT_MODE_KEY = 'deployment.mode.v1';

// 部署模式：单用户 | 多租户 — Chinese: deployment mode
export type DeploymentMode = 'single' | 'multi';
// 来源：初始设置 | 环境变量 | 默认值 — Chinese: source of deployment mode
export type DeploymentSource = 'init' | 'env' | 'default';

export interface DeploymentModeSetting {
  mode: DeploymentMode;
  initializedAt: string;
  jwtSecret?: string;
}

export interface DeploymentConfig {
  initialized: boolean;
  deploymentMode: DeploymentMode;
  source: DeploymentSource;
  authMode: AuthMode;
  authConfig: AuthConfig;
}

// 根据持久化设置与环境变量解析部署配置 — Chinese: resolve deployment config
export async function resolveDeploymentConfig(
  store: ThreadStore,
  _storageMode: StorageMode,
  env: Record<string, string | undefined> = process.env,
): Promise<DeploymentConfig> {
  const initialized = await readDeploymentModeSetting(store);
  if (initialized) {
    // 已初始化：使用存储的部署模式，并回填 JWT 密钥
    // — Chinese: already initialized; reuse stored mode and JWT secret
    return buildDeploymentConfig(initialized.mode, 'init', withInitializedSecret(env, initialized), false);
  }

  const envMode = parseEnvDeploymentMode(env);
  if (envMode) return buildDeploymentConfig(envMode, 'env', env, true);
  return buildDeploymentConfig('single', 'default', env, false);
}

// 读取持久化的部署模式设置 — Chinese: read persisted deployment mode setting
export async function readDeploymentModeSetting(store: ThreadStore): Promise<DeploymentModeSetting | null> {
  const stored = await store.getSetting<unknown>(DEPLOYMENT_MODE_KEY);
  if (!stored || typeof stored !== 'object') return null;
  const mode = (stored as { mode?: unknown }).mode;
  const initializedAt = (stored as { initializedAt?: unknown }).initializedAt;
  if ((mode !== 'single' && mode !== 'multi') || typeof initializedAt !== 'string') return null;
  const jwtSecret = (stored as { jwtSecret?: unknown }).jwtSecret;
  return { mode, initializedAt, ...(typeof jwtSecret === 'string' && jwtSecret.trim() ? { jwtSecret: jwtSecret.trim() } : {}) };
}

// 写入部署模式设置；可选持久化 JWT 密钥 — Chinese: write deployment mode setting (optionally with JWT secret)
export async function writeDeploymentModeSetting(
  store: ThreadStore,
  mode: DeploymentMode,
  now = new Date().toISOString(),
  jwtSecret?: string,
): Promise<DeploymentModeSetting> {
  const setting = { mode, initializedAt: now, ...(jwtSecret?.trim() ? { jwtSecret: jwtSecret.trim() } : {}) };
  await store.setSetting(DEPLOYMENT_MODE_KEY, setting);
  return setting;
}

// 构建部署配置（从部署模式推导 auth 模式） — Chinese: build deployment config
function buildDeploymentConfig(
  mode: DeploymentMode,
  source: DeploymentSource,
  env: Record<string, string | undefined>,
  honorAuthEnv: boolean,
): DeploymentConfig {
  // 根据 NEXUS_AUTH_MODE 是否显式设置决定是否使用 env 提供的值
  // — Chinese: honor explicit NEXUS_AUTH_MODE when provided
  const authEnv = honorAuthEnv && env.NEXUS_AUTH_MODE
    ? env
    : { ...env, NEXUS_AUTH_MODE: mode === 'multi' ? 'token' : 'off' };
  const authConfig = resolveAuthConfig(mode, authEnv);
  return {
    initialized: source !== 'default',
    deploymentMode: mode,
    source,
    authMode: authConfig.mode,
    authConfig,
  };
}

// 从环境变量解析部署模式（支持 NEXUS_DEPLOYMENT_MODE 或 NEXUS_AUTH_MODE 两种方式） — Chinese: parse deployment mode from env
function parseEnvDeploymentMode(
  env: Record<string, string | undefined>,
): DeploymentMode | null {
  const rawDeployment = env.NEXUS_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (rawDeployment) return parseDeploymentMode(rawDeployment, 'NEXUS_DEPLOYMENT_MODE');
  const rawAuth = env.NEXUS_AUTH_MODE?.trim().toLowerCase();
  if (rawAuth === 'token') return 'multi';
  if (rawAuth === 'off') return 'single';
  return null;
}

// 解析部署模式字符串 — Chinese: parse deployment mode string
function parseDeploymentMode(value: string, name: string): DeploymentMode {
  if (value === 'single') return 'single';
  if (value === 'multi' || value === 'multi_tenant' || value === 'multitenant') return 'multi';
  throw new Error(`Invalid ${name}: ${value}`);
}

// 若已存储了 JWT 密钥，则将其注入到环境变量里 — Chinese: inject stored JWT secret into env
function withInitializedSecret(
  env: Record<string, string | undefined>,
  setting: DeploymentModeSetting,
): Record<string, string | undefined> {
  return setting.jwtSecret ? { ...env, NEXUS_JWT_SECRET: setting.jwtSecret } : env;
}
