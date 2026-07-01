// JWT 认证相关工具：存储、读取、请求头注入、全局 fetch 劫持
// JWT authentication utilities: storage, reading, header injection, global fetch patching

export const AUTH_JWT_STORAGE_KEY = 'nexus.auth.jwt';
// JWT 在 localStorage 中的存储键
// Storage key for JWT in localStorage

let memoryJwt = readStoredJwt();
// 内存中的 JWT 缓存（避免每次读取存储）
// In-memory JWT cache (avoids storage read on every call)

export function getAuthJwt(): string {
  // 获取当前存储的 JWT
  // Returns the currently stored JWT
  return memoryJwt;
}

export function setAuthJwt(jwt: string): void {
  // 更新 JWT：同步写入内存与 localStorage
  // Updates JWT: writes to both memory and localStorage
  memoryJwt = jwt.trim();
  const storage = safeLocalStorage();
  if (!storage) return;
  if (memoryJwt) storage.setItem(AUTH_JWT_STORAGE_KEY, memoryJwt);
  else storage.removeItem(AUTH_JWT_STORAGE_KEY);
}

export function clearAuthJwt(): void {
  // 清空 JWT（登出场景）
  // Clears the JWT (used for sign out)
  setAuthJwt('');
}

export function authHeaders(input: RequestInfo | URL): Record<string, string> {
  // 根据请求目标与当前 JWT，返回需要附加的认证请求头
  // Returns authentication headers based on request target and current JWT
  const jwt = getAuthJwt();
  if (!jwt || !isSameOriginApi(input)) return {};
  return { Authorization: `Bearer ${jwt}` };
}

export function installAuthenticatedFetch(baseFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  // 返回一个包装后的 fetch：对同源 API 请求自动附加 Bearer 认证头
  // Returns a wrapped fetch that automatically attaches Bearer auth headers to same-origin API requests
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = mergeHeaders(init.headers, authHeaders(input));
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}

export function patchGlobalFetch(): void {
  // 替换全局 fetch 为带认证头的版本（幂等：已替换则直接返回）
  // Replaces global fetch with authenticated version (idempotent: no-op if already patched)
  const current = globalThis.fetch;
  if ((current as { __nexusAuthPatched?: boolean }).__nexusAuthPatched) return;
  const wrapped = installAuthenticatedFetch(current.bind(globalThis)) as typeof fetch & { __nexusAuthPatched?: boolean };
  wrapped.__nexusAuthPatched = true;
  globalThis.fetch = wrapped;
}

export function authEventSourceUrl(path: string): string {
  // 为 EventSource 路径附加 access_token 查询参数（EventSource 不支持自定义请求头）
  // Attaches access_token query parameter to EventSource path (EventSource does not support custom headers)
  const jwt = getAuthJwt();
  if (!jwt) return path;
  const [base, hash = ''] = path.split('#');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}access_token=${encodeURIComponent(jwt)}${hash ? `#${hash}` : ''}`;
}

function readStoredJwt(): string {
  // 从 localStorage 读取已保存的 JWT
  // Reads the persisted JWT from localStorage
  try {
    return safeLocalStorage()?.getItem(AUTH_JWT_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  // 判断请求目标是否为同源的 /api/ 路径
  // Checks whether the request target is a same-origin /api/ path
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  if (raw.startsWith('/api/')) return true;
  try {
    const location = globalThis.window?.location;
    if (!location) return false;
    const url = new URL(raw, location.href);
    return url.origin === location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  // 安全获取 localStorage（某些隐私模式或 SSR 下访问会抛错）
  // Safely accesses localStorage (may throw in privacy mode or SSR)
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function mergeHeaders(existing: HeadersInit | undefined, extra: Record<string, string>): HeadersInit {
  // 合并用户传入的 headers 和附加的认证头
  // Merges user-provided headers with injected authentication headers
  const output: Record<string, string> = {};
  if (existing instanceof Headers) {
    existing.forEach((value, key) => { output[key] = value; });
  } else if (Array.isArray(existing)) {
    for (const [key, value] of existing) output[key] = value;
  } else if (existing) {
    Object.assign(output, existing);
  }
  return { ...output, ...extra };
}
