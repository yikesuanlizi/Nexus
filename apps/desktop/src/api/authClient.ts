// 本地存储 JWT 所用的 key，与后端约定
// Chinese translation: localStorage key used to persist the JWT token, agreed with the backend.
export const AUTH_JWT_STORAGE_KEY = 'nexus.auth.jwt';

// 内存中的 JWT 缓存，避免每次都读写 localStorage
// Chinese translation: In-memory JWT cache, avoids reading localStorage on every call.
let memoryJwt = readStoredJwt();

// 返回当前缓存的 JWT（字符串），未设置则为空字符串
// Chinese translation: Returns the currently cached JWT; returns an empty string if not set.
export function getAuthJwt(): string {
  return memoryJwt;
}

// 更新 JWT 并持久化到 localStorage（如可用）；入参为空字符串时会清除已有 JWT
// Chinese translation: Updates the JWT and persists it to localStorage (if available). An empty string clears the stored token.
export function setAuthJwt(jwt: string): void {
  memoryJwt = jwt.trim();
  const storage = safeLocalStorage();
  if (!storage) return;
  if (memoryJwt) storage.setItem(AUTH_JWT_STORAGE_KEY, memoryJwt);
  else storage.removeItem(AUTH_JWT_STORAGE_KEY);
}

// 清除当前 JWT（等同于 setAuthJwt('')）
// Chinese translation: Clears the current JWT (equivalent to setAuthJwt('')).
export function clearAuthJwt(): void {
  setAuthJwt('');
}

// 生成 JWT 鉴权 headers，仅对同源 API 路径生效，避免把 token 泄漏到外部
// Chinese translation: Builds JWT auth headers, only applied to same-origin API paths to avoid leaking tokens to third parties.
export function authHeaders(input: RequestInfo | URL): Record<string, string> {
  const jwt = getAuthJwt();
  if (!jwt || !isSameOriginApi(input)) return {};
  return { Authorization: `Bearer ${jwt}` };
}

// 基于一个基础 fetch 函数，返回附加了 auth headers 的新 fetch（供组件内或测试中显式调用）
// Chinese translation: Wraps a base fetch function with auth headers attached, for explicit calls in components or tests.
export function installAuthenticatedFetch(baseFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = mergeHeaders(init.headers, authHeaders(input));
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}

// 猴子补丁覆盖全局 fetch，使所有请求自动携带 JWT；使用 __nexusAuthPatched 标记避免重复 patch
// Chinese translation: Monkey-patches the global fetch so all requests carry a JWT. The __nexusAuthPatched flag prevents double patching.
export function patchGlobalFetch(): void {
  const current = globalThis.fetch;
  if ((current as { __nexusAuthPatched?: boolean }).__nexusAuthPatched) return;
  const wrapped = installAuthenticatedFetch(current.bind(globalThis)) as typeof fetch & { __nexusAuthPatched?: boolean };
  wrapped.__nexusAuthPatched = true;
  globalThis.fetch = wrapped;
}

// 把 JWT 作为 query 参数附加到 EventSource URL，因为 EventSource 无法自定义请求头
// Chinese translation: Appends the JWT as a query parameter to the EventSource URL, since EventSource cannot have custom request headers.
export function authEventSourceUrl(path: string): string {
  const jwt = getAuthJwt();
  if (!jwt) return path;
  const [base, hash = ''] = path.split('#');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}access_token=${encodeURIComponent(jwt)}${hash ? `#${hash}` : ''}`;
}

// 从 localStorage 读取已保存的 JWT，读取失败时返回空字符串
// Chinese translation: Reads the stored JWT from localStorage; returns an empty string on failure.
function readStoredJwt(): string {
  try {
    return safeLocalStorage()?.getItem(AUTH_JWT_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

// 判断一个请求目标是否为同源的后端 API：以 "/api/" 开头，或完整 URL 的 origin 与当前页面相同且路径以 "/api/" 开头
// Chinese translation: Checks whether a request target is a same-origin backend API: starts with "/api/", or has the same origin as the current page with a path beginning with "/api/".
function isSameOriginApi(input: RequestInfo | URL): boolean {
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

// 把用户已提供的 headers（可能是 Headers / 数组 / 纯对象）与鉴权 headers 合并，后者覆盖前者
// Chinese translation: Merges user-provided headers (Headers / array / plain object) with auth headers; the latter wins on key collision.
function mergeHeaders(existing: HeadersInit | undefined, extra: Record<string, string>): HeadersInit {
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

// 安全获取 localStorage，浏览器隐私模式或 SSR 环境可能抛出，返回 null 表示不可用
// Chinese translation: Safely accesses localStorage. Browser privacy modes or SSR environments may throw; null means it is unavailable.
function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
