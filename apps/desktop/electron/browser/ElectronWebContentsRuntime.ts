// ElectronWebContentsRuntime：把 WebContentsView（用户可见的真实页面）实现为
// BrowserRuntimePort。观测（元素 [eN]/epoch）与动作（导航/点击/输入/滚动/等待/截图/
// 下载）全部映射到同一 webContents.id——Agent 与用户操作同一个会话
// （迁移计划 Phase 3）。策略/预算/账本由 Main 进程的 orchestrator 负责。
// — English: ElectronWebContentsRuntime implements BrowserRuntimePort over the
//   user-visible WebContentsView. Observations ([eN]/epoch) and actions
//   (navigate/click/type/scroll/wait/screenshot/download) all map onto the same
//   webContents.id — the agent and the user operate one shared session (Phase 3).
import type {
  ActionResult,
  BrowserRuntimePort,
  BrowserSessionHandle,
  PostconditionCheck,
} from '@nexus/browser-runtime';
import type { ActionIntent, ClassifiedError, ContentBlock, FormInfo, Observation, PageGraph, Postcondition } from '@nexus/protocol';
import type { WebContentsView } from 'electron';
import type { BrowserEngineAdapter } from './BrowserEngineAdapter.js';

// 元素引用定位信息（观测时 [eN] → 定位；动作时反向解析）。
// — English: element locator info — [eN] → locator at observation time.
interface ElementRefInfo {
  index: number;
  tag: string;
  name?: string;
  href?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function actionError(actionId: string, error: Omit<ClassifiedError, 'actionId'>): ClassifiedError {
  return { ...error, actionId };
}

function safeOrigin(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
}

// 滚动/等待等不需要元素引用的动作种类。
// — English: action kinds that need no element reference.
const NO_REF_KINDS = new Set(['scroll', 'wait', 'back', 'forward', 'reload', 'navigate', 'screenshot', 'download']);

export interface ElectronWebContentsRuntimeDeps {
  view: WebContentsView;
  adapter: BrowserEngineAdapter;
  defaultTimeoutMs?: number;
}

export class ElectronWebContentsRuntime implements BrowserRuntimePort {
  readonly kind = 'electron' as const;

  private readonly view: WebContentsView;
  private readonly adapter: BrowserEngineAdapter;
  private readonly defaultTimeoutMs: number;

  constructor(deps: ElectronWebContentsRuntimeDeps) {
    this.view = deps.view;
    this.adapter = deps.adapter;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 15_000;
  }

  async start(input: { taskId: string; signal?: AbortSignal }): Promise<BrowserSessionHandle> {
    const taskId = input.taskId;
    const signal = input.signal;
    let navigationEpoch = 1;
    let observeCount = 0;
    let refMap = new Map<string, ElementRefInfo>();
    let closed = false;
    let cachedUrl = '';
    let cachedTitle = '';

    // epoch 随真实导航递增（did-navigate 由 WebContentsView 触发）。
    // — English: the epoch tracks real navigation via did-navigate.
    const onNavigate = (_event: Electron.Event, url: string): void => {
      navigationEpoch += 1;
      refMap = new Map();
      cachedUrl = url;
    };
    this.view.webContents.on('did-navigate', onNavigate as never);
    const onTitle = (_event: Electron.Event, title: string): void => {
      cachedTitle = title;
    };
    this.view.webContents.on('page-title-updated', onTitle as never);

    const thisView = this.view;

    const throwIfAborted = (s?: AbortSignal): void => {
      if (s?.aborted) {
        throw { kind: 'cancelled', code: 'ABORTED', message: '任务已取消', retryable: false } satisfies ClassifiedError;
      }
    };

    const snapshot = async (): Promise<{ elements?: Array<Record<string, unknown>>; content?: Array<Record<string, unknown>>; forms?: Array<Record<string, unknown>> }> => {
      // 复用 browser-runtime 的页面快照脚本（宿主无关）。
      // — English: reuse browser-runtime's host-agnostic snapshot script.
      const { SNAPSHOT_SCRIPT } = await import('@nexus/browser-runtime');
      const raw = await this.adapter.evaluate({ tabId: taskId, expression: SNAPSHOT_SCRIPT });
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw) as { elements?: Array<Record<string, unknown>>; content?: Array<Record<string, unknown>>; forms?: Array<Record<string, unknown>> };
        } catch {
          return {};
        }
      }
      if (typeof raw === 'object' && raw !== null) {
        return raw as { elements?: Array<Record<string, unknown>>; content?: Array<Record<string, unknown>>; forms?: Array<Record<string, unknown>> };
      }
      return {};
    };

    const currentUrl = async (): Promise<string> => {
      const value = await this.adapter.evaluate({ tabId: taskId, expression: 'location.href' });
      return typeof value === 'string' ? value : cachedUrl;
    };

    const observe = async (input?: { signal?: AbortSignal; pageId?: string }): Promise<Observation> => {
      if (closed) throw new Error('session closed');
      const pageId = input?.pageId ?? 'page-1';
      if (pageId !== 'page-1') {
        throw { kind: 'element', code: 'PAGE_NOT_FOUND', message: '页面不存在', retryable: true } satisfies ClassifiedError;
      }
      throwIfAborted(input?.signal);

      const snapshotData = await snapshot();
      const url = await currentUrl();
      const title = await this.view.webContents.getTitle();
      cachedUrl = url;
      cachedTitle = title;

      const origin = safeOrigin(url);
      const epoch = navigationEpoch;
      const count = observeCount + 1;
      observeCount = count;
      const observationId = `obs-${taskId}-${epoch}-${count}`;

      // 只保留可见元素，按顺序分配 [e1]..[eN]，重建 ref → 定位信息映射。
      // — English: visible elements only, numbered [e1]..[eN]; rebuilds the ref map.
      const elements: Observation['elements'] = [];
      const newRefMap = new Map<string, ElementRefInfo>();
      let n = 0;
      for (const el of snapshotData.elements ?? []) {
        if (el.visible === false) continue;
        n += 1;
        const ref = `[e${n}]`;
        const tag = typeof el.tag === 'string' ? el.tag : 'unknown';
        const name = typeof el.name === 'string' ? el.name : undefined;
        const href = typeof el.href === 'string' ? el.href : undefined;
        newRefMap.set(ref, { index: n, tag, name, href });
        elements.push({
          ref,
          role: typeof el.role === 'string' ? el.role : undefined,
          name,
          text: typeof el.text === 'string' ? el.text : undefined,
          frameId: 'frame-main',
          visible: true,
          enabled: el.enabled !== false,
          fingerprint: `fp:${n}:${epoch}`,
          provenance: { trust: 'untrusted', source: 'dom', origin, pageId, observationId },
        });
      }
      refMap = newRefMap;

      const contentTypes = new Set<ContentBlock['type']>(['heading', 'paragraph', 'list', 'link', 'table', 'other']);
      const mainContent: ContentBlock[] = [];
      for (const c of snapshotData.content ?? []) {
        if (typeof c.text !== 'string') continue;
        const block: ContentBlock = {
          type: c.type !== undefined && contentTypes.has(c.type as ContentBlock['type'])
            ? (c.type as ContentBlock['type'])
            : 'other',
          text: c.text.slice(0, 200),
        };
        if (typeof c.href === 'string') block.href = c.href;
        mainContent.push(block);
      }

      const forms: FormInfo[] = [];
      for (const f of snapshotData.forms ?? []) {
        if (typeof f.formId !== 'string') continue;
        const fields = (f.fields ?? []) as Array<Record<string, unknown>>;
        const form: FormInfo = {
          formId: f.formId,
          fields: fields
            .filter((fd) => typeof fd.name === 'string')
            .map((fd) => ({
              name: fd.name as string,
              ...(fd.fieldType !== undefined && typeof fd.fieldType === 'string' ? { fieldType: fd.fieldType as string } : {}),
              required: fd.required === true,
            })),
        };
        if (typeof f.action === 'string') form.action = f.action;
        if (f.method === 'post') form.method = 'post';
        else if (f.method === 'get') form.method = 'get';
        forms.push(form);
      }

      return {
        observationId,
        taskId,
        pageId,
        navigationEpoch: epoch,
        capturedAt: Date.now(),
        url,
        title,
        readiness: 'stable',
        elements,
        mainContent,
        forms,
        network: { pendingRequests: 0, recentFailures: [] },
        pageState: { captchaDetected: false, authRequired: false },
      };
    };

    // 按 [eN] 解析元素位置（仅可见元素按观测顺序编号）。
    // — English: resolve an element's position by [eN] (visible elements only).
    const locateElement = async (ref: string): Promise<{ x: number; y: number; tag: string; name?: string } | undefined> => {
      const info = refMap.get(ref);
      if (info === undefined) return undefined;
      const locator = await this.adapter.evaluate({
        tabId: taskId,
        expression: `(() => {
          const selectors = ['a[href]', 'button', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]'];
          const seen = new Set();
          let idx = 0;
          for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
              if (seen.has(el)) continue;
              seen.add(el);
              const rect = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
              if (!visible) continue;
              idx += 1;
              if (idx === ${info.index}) {
                const r = el.getBoundingClientRect();
                return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName.toLowerCase(), name: el.getAttribute('aria-label') || el.textContent });
              }
            }
          }
          return 'null';
        })()`,
      });
      if (typeof locator !== 'string' || locator === 'null') return undefined;
      try {
        const parsed = JSON.parse(locator) as { x: number; y: number; tag: string; name?: string };
        return parsed;
      } catch {
        return undefined;
      }
    };

    // 后置条件验证（对真实页面状态求值）。
    // — English: postcondition evaluation against the real page state.
    const evaluatePostconditions = async (post: Postcondition, beforeEpoch: number): Promise<PostconditionCheck[]> => {
      const check = (passed: boolean, detail?: string): PostconditionCheck => ({
        postcondition: JSON.stringify(post),
        passed,
        ...(detail !== undefined ? { detail } : {}),
      });
      switch (post.kind) {
        case 'none':
          return [check(true)];
        case 'url_contains': {
          const url = await currentUrl();
          return [check(url.includes(post.value))];
        }
        case 'url_equals': {
          const url = await currentUrl();
          return [check(url === post.value)];
        }
        case 'navigation_epoch_changed':
          return [check(navigationEpoch !== beforeEpoch)];
        case 'element_appears': {
          const el = await locateElement(post.ref);
          return [check(el !== undefined)];
        }
        case 'element_disappears': {
          const el = await locateElement(post.ref);
          return [check(el === undefined)];
        }
        case 'element_text_contains': {
          const el = await locateElement(post.ref);
          return [check(el !== undefined && el.name !== undefined && el.name.includes(post.value), el === undefined ? '元素不存在或不可见' : undefined)];
        }
        case 'download_completed':
          return [check(false, '当前会话无法证明下载完成（等待下载管理器）')];
        default:
          return [check(false, `未知后置条件: ${(post as { kind: string }).kind}`)];
      }
    };

    const act = async (input: { intent: ActionIntent; signal?: AbortSignal }): Promise<ActionResult> => {
      if (closed) throw new Error('session closed');
      const { intent, signal } = input;
      const actionId = intent.actionId;
      const failed = (error: Omit<ClassifiedError, 'actionId'>): ActionResult => ({
        status: 'failed',
        error: actionError(actionId, error),
      });

      if (signal?.aborted) {
        return failed({ kind: 'cancelled', code: 'ABORTED', message: '任务已取消', retryable: false });
      }
      if (intent.pageId !== 'page-1') {
        return failed({ kind: 'element', code: 'PAGE_NOT_FOUND', message: '页面不存在', retryable: true });
      }
      if (intent.expectedNavigationEpoch !== navigationEpoch) {
        return failed({ kind: 'element', code: 'STALE_EPOCH', message: '观测已过期，请重新观测', retryable: true });
      }

      const beforeEpoch = navigationEpoch;
      const beforeUrl = await currentUrl();

      // 元素解析与状态校验。
      // — English: element resolution and state checks.
      let point: { x: number; y: number; tag: string; name?: string } | undefined;
      if (intent.targetRef !== undefined && !NO_REF_KINDS.has(intent.kind)) {
        point = await locateElement(intent.targetRef);
        if (point === undefined) {
          return failed({ kind: 'element', code: 'ELEMENT_NOT_FOUND', message: '元素不存在或已过期，请重新观测', retryable: true });
        }
        throwIfAborted(signal);
      }

      try {
        // 动作分发（同一 webContents 上的真实交互）。
        // — English: action dispatch — real interactions on the shared webContents.
        switch (intent.kind) {
          case 'navigate': {
            const url = typeof intent.arguments.url === 'string' ? intent.arguments.url : '';
            if (url === '') return failed({ kind: 'page', code: 'BAD_ARG', message: 'url 缺失', retryable: false });
            await this.view.webContents.loadURL(url);
            navigationEpoch += 1;
            refMap = new Map();
            break;
          }
          case 'click': {
            if (point === undefined) return failed({ kind: 'element', code: 'ELEMENT_NOT_FOUND', message: '元素不存在', retryable: true });
            await this.adapter.click({ tabId: taskId, x: point.x, y: point.y });
            break;
          }
          case 'type': {
            const text = typeof intent.arguments.value === 'string' ? intent.arguments.value : String(intent.arguments.value ?? '');
            if (point !== undefined) {
              await this.adapter.click({ tabId: taskId, x: point.x, y: point.y });
            }
            await this.adapter.insertText(text);
            break;
          }
          case 'wait': {
            const ms = typeof intent.arguments.durationMs === 'number' ? intent.arguments.durationMs : 1000;
            await new Promise((resolve) => setTimeout(resolve, Math.min(ms, this.defaultTimeoutMs)));
            break;
          }
          case 'scroll': {
            const expression = `window.scrollBy(0, ${typeof intent.arguments.dy === 'number' ? intent.arguments.dy : 400}); 'scrolled'`;
            await this.adapter.evaluate({ tabId: taskId, expression });
            break;
          }
          case 'screenshot': {
            // 截图经 CDP Page.captureScreenshot 返回 base64（Phase 2 不再走数据 URL 传输）。
            // — English: screenshots via CDP Page.captureScreenshot (base64 artifact ref).
            await this.adapter.attach();
            const shot = await this.view.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
            const data = shot.data as string | undefined;
            if (typeof data !== 'string') return failed({ kind: 'page', code: 'SHOT_FAILED', message: '截图失败', retryable: true });
            return {
              status: 'committed',
              evidence: {
                actionId,
                verifiedAt: Date.now(),
                checks: await evaluatePostconditions(intent.postcondition, beforeEpoch),
                observed: { url: await currentUrl(), title: cachedTitle, navigationEpoch },
                externalEvidence: { screenshot: `data:image/png;base64,${data.slice(0, 64)}…` },
              },
            };
          }
          default:
            return failed({ kind: 'page', code: 'UNSUPPORTED_ACTION', message: `不支持的动作: ${intent.kind}`, retryable: false });
        }

        throwIfAborted(signal);

        // URL 变化视为导航：epoch++ 并作废引用（navigate 已在上面递增）。
        // — English: a URL change counts as navigation — bump epoch and invalidate refs.
        const afterUrl = await currentUrl();
        if (intent.kind !== 'navigate' && afterUrl !== beforeUrl) {
          navigationEpoch += 1;
          refMap = new Map();
        }

        const checks = await evaluatePostconditions(intent.postcondition, beforeEpoch);
        const passed = checks.every((c) => c.passed);
        return {
          status: passed ? 'committed' : 'uncertain',
          ...(passed
            ? { evidence: { actionId, verifiedAt: Date.now(), checks, observed: { url: afterUrl, title: cachedTitle, navigationEpoch } } }
            : { reason: '后置条件未满足', evidence: { actionId, verifiedAt: Date.now(), checks, observed: { url: afterUrl, title: cachedTitle, navigationEpoch } } }),
        } as ActionResult;
      } catch (err) {
        if (signal?.aborted || (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ABORTED')) {
          return failed({ kind: 'cancelled', code: 'ABORTED', message: '任务已取消', retryable: false });
        }
        return failed({ kind: 'page', code: 'ACT_FAILED', message: errorMessage(err), retryable: true });
      }
    };

    const handle: BrowserSessionHandle = {
      sessionId: `electron-${taskId}`,
      taskId,
      async close(reason?: string): Promise<void> {
        if (closed) return;
        closed = true;
        thisView.webContents.removeListener('did-navigate', onNavigate as never);
        thisView.webContents.removeListener('page-title-updated', onTitle as never);
        void reason;
      },
      currentPageGraph(): PageGraph {
        return {
          activePageId: 'page-1',
          pages: [
            {
              pageId: 'page-1',
              url: cachedUrl,
              title: cachedTitle,
              state: 'active',
              navigationEpoch,
            },
          ],
        };
      },
      observe: (input) => observe(input),
      navigate: async (input) => {
        throwIfAborted(input.signal);
        await this.view.webContents.loadURL(input.url);
        navigationEpoch += 1;
        refMap = new Map();
        return observe({ signal: input.signal });
      },
      act,
    };

    return handle;
  }
}
