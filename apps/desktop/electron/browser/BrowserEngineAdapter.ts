// BrowserEngineAdapter：通过 webContents.debugger（CDP）控制与用户相同的 WebContents。
// Phase 0 最小实现：Runtime.evaluate（读取/写入同一 DOM）+ Input 鼠标事件（用户可见的
// 真实交互）。Playwright connectOverCDP 仅作对比验证，不作为默认路径
// （Playwright 官方将 connectOverCDP 定义为低于原生协议的连接）。
// — English: BrowserEngineAdapter drives the SAME webContents the user sees via
//   webContents.debugger (CDP). Phase 0 minimal: Runtime.evaluate plus Input mouse
//   events. Playwright connectOverCDP is only a comparison probe, never the default.
import type { WebContentsView } from 'electron';
import type { BrowserEvaluateInput, BrowserClickInput } from '../contracts/browserTypes.js';

export interface CdpEvaluateResult {
  value?: unknown;
  // 由被评估脚本返回的对象（returnByValue=false 时用 objectId 后续引用）。
  // — English: object reference returned when returnByValue=false.
  objectId?: string;
}

interface CdpError {
  code: number;
  message: string;
}

export class BrowserEngineAdapter {
  private readonly view: WebContentsView;
  private attached = false;

  constructor(view: WebContentsView) {
    this.view = view;
  }

  // 附着 CDP：同一 webContents 的 debugger Target。失败时抛出清晰错误。
  // — English: attach CDP to the same webContents debugger target.
  async attach(): Promise<void> {
    if (this.attached) return;
    try {
      this.view.webContents.debugger.attach('1.3');
      this.attached = true;
    } catch (err) {
      throw new Error(`CDP attach 失败：${String(err)}`);
    }
  }

  get isAttached(): boolean {
    return this.attached;
  }

  // 在用户可见的同页面执行脚本：读取输入值、获取 DOM 状态、执行点击等。
  // — English: evaluate on the user-visible page — read input values, DOM state, clicks.
  async evaluate(input: BrowserEvaluateInput): Promise<unknown> {
    await this.attach();
    const { expression } = input;
    const response = await this.view.webContents.debugger.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails !== undefined) {
      const detail = response.exceptionDetails as { text?: string; exception?: { description?: string } };
      throw new Error(`页面脚本异常：${detail.exception?.description ?? detail.text ?? 'unknown'}`);
    }
    const result = response.result as { type: string; value?: unknown; objectId?: string };
    if (result.type === 'object' && result.objectId !== undefined) {
      // returnByValue 无法序列化（如函数/循环引用）：返回 objectId 供后续引用。
      // — English: un-serializable values fall back to an objectId for later use.
      const out: CdpEvaluateResult = { objectId: result.objectId };
      return out;
    }
    return result.value;
  }

  // CDP Input 事件驱动真实点击（用户在同一 View 立即可见）。
  // — English: real clicks via CDP Input events (immediately visible to the user).
  async click(input: BrowserClickInput): Promise<void> {
    await this.attach();
    const { x, y } = input;
    await this.view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  // 文本输入（真实键盘事件，用户在页面可见）。
  // — English: text insertion via CDP (visible to the user).
  async insertText(text: string): Promise<void> {
    await this.attach();
    await this.view.webContents.debugger.sendCommand('Input.insertText', { text });
  }

  detach(): void {
    if (!this.attached) return;
    try {
      this.view.webContents.debugger.detach();
    } catch {
      // 已 detach 或 webContents 已销毁
    }
    this.attached = false;
  }

  isCdpError(err: unknown): err is CdpError {
    return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
  }
}
