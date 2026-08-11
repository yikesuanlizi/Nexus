// 浏览器会话状态机与 storageState 测试：转换表、非法转换报错且状态不变、
// 序列化往返、反序列化容错、storageState 清洗、会话摘要不泄露敏感值
// — English: browser session state machine and storageState tests — transition
//   table, illegal transitions throw and leave state unchanged, serialization
//   round-trip, tolerant deserialization, storageState sanitization, and a
//   session summary that never leaks sensitive values
import { describe, expect, it } from 'vitest';
import type { BrowserSessionState, StorageState } from './sessionState.js';
import {
  canTransitionSessionState,
  deserializeStorageState,
  sanitizeStorageState,
  serializeStorageState,
  summarizeSession,
  transitionSessionState,
} from './sessionState.js';

function makeSession(overrides: Partial<BrowserSessionState> = {}): BrowserSessionState {
  return {
    sessionId: 'sess-1',
    taskId: 'task-1',
    state: 'starting',
    authStatus: 'unknown',
    createdAt: 1000,
    lastActiveAt: 1000,
    ...overrides,
  };
}

describe('canTransitionSessionState', () => {
  it('合法转换对返回 true', () => {
    expect(canTransitionSessionState('starting', 'active')).toBe(true);
    expect(canTransitionSessionState('active', 'suspended')).toBe(true);
    expect(canTransitionSessionState('suspended', 'active')).toBe(true);
    expect(canTransitionSessionState('active', 'closing')).toBe(true);
    expect(canTransitionSessionState('closing', 'closed')).toBe(true);
    expect(canTransitionSessionState('starting', 'failed')).toBe(true);
  });

  it('非法转换对返回 false', () => {
    expect(canTransitionSessionState('closed', 'active')).toBe(false);
    expect(canTransitionSessionState('failed', 'starting')).toBe(false);
    expect(canTransitionSessionState('active', 'starting')).toBe(false);
    expect(canTransitionSessionState('closing', 'suspended')).toBe(false);
  });

  it('同态转换返回 false', () => {
    expect(canTransitionSessionState('starting', 'starting')).toBe(false);
    expect(canTransitionSessionState('active', 'active')).toBe(false);
    expect(canTransitionSessionState('suspended', 'suspended')).toBe(false);
    expect(canTransitionSessionState('closing', 'closing')).toBe(false);
    expect(canTransitionSessionState('closed', 'closed')).toBe(false);
    expect(canTransitionSessionState('failed', 'failed')).toBe(false);
  });
});

describe('transitionSessionState', () => {
  it('合法转换更新 state 与 lastActiveAt，其余字段保留', () => {
    const before = makeSession({ state: 'starting', lastActiveAt: 1000 });
    const after = transitionSessionState(before, 'active');
    expect(after.state).toBe('active');
    expect(after.lastActiveAt).toBeGreaterThan(1000);
    expect(after.sessionId).toBe('sess-1');
    expect(after.taskId).toBe('task-1');
    expect(after.createdAt).toBe(1000);
    // 不可变：原对象不被修改
    expect(before.state).toBe('starting');
    expect(before.lastActiveAt).toBe(1000);
  });

  it('进入 closing 时更新 state 但不更新 lastActiveAt', () => {
    const before = makeSession({ state: 'active', lastActiveAt: 2000 });
    const after = transitionSessionState(before, 'closing');
    expect(after.state).toBe('closing');
    expect(after.lastActiveAt).toBe(2000);
  });

  it('进入 closed 时也不更新 lastActiveAt', () => {
    const before = makeSession({ state: 'closing', lastActiveAt: 3000 });
    const after = transitionSessionState(before, 'closed');
    expect(after.state).toBe('closed');
    expect(after.lastActiveAt).toBe(3000);
  });
});

describe('transitionSessionState 非法转换', () => {
  it('抛出含 from -> to 描述的 Error 且会话状态不变', () => {
    const session = makeSession({ state: 'active', lastActiveAt: 1500 });
    expect(() => transitionSessionState(session, 'starting')).toThrow(/active -> starting/);
    expect(session.state).toBe('active');
    expect(session.lastActiveAt).toBe(1500);
  });

  it('从终态无法转换', () => {
    const closed = makeSession({ state: 'closed' });
    expect(() => transitionSessionState(closed, 'active')).toThrow(/closed -> active/);
    const failed = makeSession({ state: 'failed' });
    expect(() => transitionSessionState(failed, 'starting')).toThrow(/failed -> starting/);
  });
});

describe('serializeStorageState / deserializeStorageState', () => {
  const storageState: StorageState = {
    version: 1,
    cookies: [
      {
        name: 'sid',
        value: 'abc123',
        domain: '.example.com',
        path: '/',
        expires: 1700000000000,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      { name: 'theme', value: 'dark', domain: 'example.com', path: '/' },
    ],
    localStorage: [{ origin: 'https://example.com', items: [{ key: 'pref', value: 'x' }] }],
    capturedAt: 1700000000000,
  };

  it('序列化结果单行 JSON，反序列化往返一致', () => {
    const raw = serializeStorageState(storageState);
    expect(raw).not.toContain('\n');
    const roundTrip = deserializeStorageState(raw);
    expect(roundTrip).toEqual(storageState);
  });

  it('非法 JSON / 缺字段 / 版本不符返回 null', () => {
    expect(deserializeStorageState('not json')).toBeNull();
    expect(deserializeStorageState('{"version":1}')).toBeNull();
    expect(deserializeStorageState('{"version":1,"cookies":[],"localStorage":[]}')).toBeNull();
    expect(deserializeStorageState('{"version":2,"cookies":[],"localStorage":[],"capturedAt":1}')).toBeNull();
  });
});

describe('sanitizeStorageState', () => {
  it('非对象输入返回 null', () => {
    expect(sanitizeStorageState(null)).toBeNull();
    expect(sanitizeStorageState(undefined)).toBeNull();
    expect(sanitizeStorageState('storage')).toBeNull();
    expect(sanitizeStorageState(42)).toBeNull();
    expect(sanitizeStorageState([])).toBeNull();
  });

  it('非法条目（空 name/domain、expires 字符串）被丢弃，合法条目保留', () => {
    const input = {
      version: 1,
      cookies: [
        { name: '', value: 'v', domain: 'example.com', path: '/' },
        { name: 'a', value: 'v', domain: '', path: '/' },
        { name: 'b', value: 'v', domain: 'example.com', path: '/', expires: 'soon' },
        {
          name: 'ok',
          value: 'keep-me',
          domain: 'example.com',
          path: '/',
          expires: 1700000000000,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      localStorage: [],
      capturedAt: 1000,
    };
    const result = sanitizeStorageState(input);
    expect(result).not.toBeNull();
    expect(result!.cookies).toHaveLength(1);
    expect(result!.cookies[0]).toEqual({
      name: 'ok',
      value: 'keep-me',
      domain: 'example.com',
      path: '/',
      expires: 1700000000000,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
  });

  it('localStorage 中 origin 非法或 item 非法的条目被丢弃', () => {
    const input = {
      version: 1,
      cookies: [],
      localStorage: [
        { origin: '', items: [{ key: 'k', value: 'v' }] },
        { origin: 'https://good.example', items: [{ key: '', value: 'v' }, { key: 'ok', value: 'v' }, 'junk'] },
      ],
      capturedAt: 1000,
    };
    const result = sanitizeStorageState(input);
    expect(result).not.toBeNull();
    expect(result!.localStorage).toHaveLength(1);
    expect(result!.localStorage[0]).toEqual({
      origin: 'https://good.example',
      items: [{ key: 'ok', value: 'v' }],
    });
  });
});

describe('summarizeSession', () => {
  it('只统计 cookie 数量、只列 localStorage origin、activePageUrl 取 active 页，不含任何敏感值', () => {
    const session = makeSession({
      state: 'active',
      authStatus: 'logged_in',
      pageGraph: {
        activePageId: 'p2',
        pages: [
          { pageId: 'p1', url: 'https://a.example/home', title: 'A', state: 'background', navigationEpoch: 1 },
          { pageId: 'p2', url: 'https://b.example/dashboard', title: 'B', state: 'active', navigationEpoch: 2 },
        ],
      },
      storageState: {
        version: 1,
        cookies: [
          { name: 'session_cookie', value: 'SUPER-SECRET-COOKIE-VALUE', domain: '.example.com', path: '/' },
          { name: 'csrf', value: 'ANOTHER-SECRET-VALUE', domain: '.example.com', path: '/' },
        ],
        localStorage: [
          { origin: 'https://a.example', items: [{ key: 'k1', value: 'local-secret-1' }] },
          { origin: 'https://b.example', items: [{ key: 'k2', value: 'local-secret-2' }] },
        ],
        capturedAt: 1000,
      },
    });

    const summary = summarizeSession(session);
    expect(summary.sessionId).toBe('sess-1');
    expect(summary.state).toBe('active');
    expect(summary.authStatus).toBe('logged_in');
    expect(summary.pageCount).toBe(2);
    expect(summary.cookieCount).toBe(2);
    expect(summary.localStorageOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(summary.activePageUrl).toBe('https://b.example/dashboard');

    // 摘要序列化后不得包含任何 cookie / localStorage 的值（文档 4.4/4.6）
    const json = JSON.stringify(summary);
    expect(json).not.toContain('SUPER-SECRET-COOKIE-VALUE');
    expect(json).not.toContain('ANOTHER-SECRET-VALUE');
    expect(json).not.toContain('local-secret-1');
    expect(json).not.toContain('local-secret-2');
  });

  it('无 pageGraph / storageState 时给出零值与缺省', () => {
    const summary = summarizeSession(makeSession());
    expect(summary.pageCount).toBe(0);
    expect(summary.cookieCount).toBe(0);
    expect(summary.localStorageOrigins).toEqual([]);
    expect(summary.activePageUrl).toBeUndefined();
  });
});
