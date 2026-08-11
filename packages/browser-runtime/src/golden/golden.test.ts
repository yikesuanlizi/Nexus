// 黄金任务框架测试：T1-T5 全绿、断言失败中止、动作失败错误码、
// 取消传播、步骤顺序与观测刷新。
// — English: golden task framework tests — T1-T5 all pass, assertion failure
//   aborts the run, action failure carries the error code, cancellation
//   propagates, step order and observation refresh.
import { describe, expect, it } from 'vitest';
import { FakeBrowserRuntime, type FakeSiteDefinition } from '../fakeRuntime.js';
import type { GoldenTask } from './goldenTypes.js';
import { runGoldenTask } from './goldenRunner.js';
import { GOLDEN_TASKS, TASK_BROWSE_DETAIL_BACK } from './tasks.js';

const LIST_URL = 'https://golden.test/list';
const DETAIL_URL = 'https://golden.test/detail';

describe('golden tasks', () => {
  // 1. 首批黄金任务 T1-T5 用 FakeBrowserRuntime 全部 passed。
  // — English: the first batch T1-T5 all pass on the fake runtime.
  for (const task of GOLDEN_TASKS) {
    it(`${task.id}（${task.name}）全部步骤 passed`, async () => {
      const runtime = new FakeBrowserRuntime(task.site);
      const result = await runGoldenTask(runtime, task);
      expect(result.taskId).toBe(`golden-${task.id}`);
      expect(result.passed).toBe(true);
      expect(result.failedStepId).toBeUndefined();
      expect(result.steps).toHaveLength(task.steps.length);
      for (const s of result.steps) {
        expect(s.status).toBe('passed');
      }
      expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
    });
  }

  // 站点自洽：startUrl 在 pages 中；navigate 与 href 目标都存在。
  // — English: site consistency — startUrl in pages, navigate/href targets exist.
  it('所有黄金任务站点自洽', () => {
    for (const task of GOLDEN_TASKS) {
      const urls = new Set(task.site.pages.map((p) => p.url));
      expect(urls.has(task.site.startUrl), `${task.id}: startUrl 不在 pages 中`).toBe(true);
      for (const step of task.steps) {
        if (step.navigate !== undefined) {
          expect(urls.has(step.navigate.url), `${task.id}: navigate 目标不存在`).toBe(true);
        }
      }
      for (const page of task.site.pages) {
        for (const el of page.elements ?? []) {
          if (el.href !== undefined) {
            expect(urls.has(el.href), `${task.id}: href 目标不存在`).toBe(true);
          }
        }
      }
    }
  });

  // 2. 断言失败：passed=false、failedStepId 正确、后续步骤未执行。
  // — English: assertion failure — passed=false, failedStepId set, later steps skipped.
  it('断言失败时中止：failedStepId 指向失败步骤且后续步骤未执行', async () => {
    const task: GoldenTask = {
      id: 'assert-fail',
      name: '断言失败任务',
      goal: '构造一个断言不可能满足的任务。',
      site: {
        startUrl: LIST_URL,
        pages: [{ url: LIST_URL, title: '列表页', content: [{ type: 'heading', text: '列表' }] }],
      },
      steps: [
        { id: 's1', description: '打开列表页', navigate: { url: LIST_URL } },
        {
          id: 's2',
          description: '断言不存在的正文文本',
          assert: { kind: 'content', contentContains: '不存在的文本XYZ' },
        },
        // s3 一旦被执行会因目标页面不存在而失败——用于证明后续步骤确实未执行。
        // — English: s3 would fail if executed (target page missing) — proving it was skipped.
        { id: 's3', description: '不应执行', navigate: { url: 'https://golden.test/nowhere' } },
      ],
    };
    const result = await runGoldenTask(new FakeBrowserRuntime(task.site), task);
    expect(result.passed).toBe(false);
    expect(result.failedStepId).toBe('s2');
    // 只有已执行的步骤进入结果：s3 未执行。
    // — English: only executed steps are recorded: s3 was skipped.
    expect(result.steps.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result.steps[0].status).toBe('passed');
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].detail).toContain('不存在的文本XYZ');
  });

  // 3. act 失败：跨页引用不存在的 [eN] → failed 且 detail 含错误码。
  // — English: action failure — a stale cross-page [eN] ref fails with the error code.
  it('act 引用失效元素：failed 且 detail 含 ELEMENT_NOT_FOUND', async () => {
    // 列表页有 2 个元素、详情页只有 1 个；导航到详情页后 [e2] 已不存在。
    // — English: list has 2 elements, detail only 1; after navigating, [e2] is gone.
    const task: GoldenTask = {
      id: 'act-fail',
      name: '动作失败任务',
      goal: '构造一个引用失效元素的动作。',
      site: {
        startUrl: LIST_URL,
        pages: [
          {
            url: LIST_URL,
            title: '列表页',
            elements: [
              { ref: 'link-result-1', role: 'link', name: '结果一', text: '结果一', href: DETAIL_URL },
              { ref: 'link-result-2', role: 'link', name: '结果二', text: '结果二', href: DETAIL_URL },
            ],
          },
          { url: DETAIL_URL, title: '详情页', elements: [{ ref: 'link-back', role: 'link', name: '返回', text: '返回' }] },
        ],
      },
      steps: [
        { id: 's1', description: '打开列表页', navigate: { url: LIST_URL } },
        { id: 's2', description: '进入详情页', navigate: { url: DETAIL_URL } },
        // 详情页只有 [e1]；[e2] 是列表页的旧引用 → ELEMENT_NOT_FOUND。
        // — English: detail has only [e1]; [e2] is a stale list-page ref.
        {
          id: 's3',
          description: '点击列表页遗留的第二个元素',
          act: { kind: 'click', targetRef: '[e2]', postcondition: { kind: 'none' } },
        },
      ],
    };
    const result = await runGoldenTask(new FakeBrowserRuntime(task.site), task);
    expect(result.passed).toBe(false);
    expect(result.failedStepId).toBe('s3');
    expect(result.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(result.steps[2].status).toBe('failed');
    expect(result.steps[2].detail).toContain('ELEMENT_NOT_FOUND');
  });

  // 4. 取消：signal abort 后 runner 抛 cancelled（不吞取消）。
  // — English: cancellation — runner throws 'cancelled' after signal abort.
  it('取消传播：abort 后 runner 抛 cancelled', async () => {
    const site: FakeSiteDefinition = {
      startUrl: 'https://golden.test/form',
      pages: [
        {
          url: 'https://golden.test/form',
          title: '表单页',
          elements: [{ ref: 'btn-submit', role: 'button', name: '提交', text: '提交' }],
          // 长延时让 act 挂起，等待 abort 生效。
          // — English: long delay keeps act pending until abort lands.
          onAction: () => ({ kind: 'delay', delayMs: 500 }),
        },
      ],
    };
    const task: GoldenTask = {
      id: 'cancel-task',
      name: '取消任务',
      goal: '验证取消传播。',
      site,
      steps: [
        { id: 's1', description: '打开表单页', navigate: { url: 'https://golden.test/form' } },
        { id: 's2', description: '点击提交（挂起）', act: { kind: 'click', targetRef: '[e1]', postcondition: { kind: 'none' } } },
      ],
    };
    const controller = new AbortController();
    const promise = runGoldenTask(new FakeBrowserRuntime(site), task, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow('cancelled');
  });

  // 5. 步骤顺序与观测刷新：T2 的第二步 act 使用第一步 navigate 后新观测的引用，
  //    第四步 act 使用详情页观测的引用——全部成功即证明 latestObservation 刷新。
  // — English: step order & observation refresh — T2's step 2 acts on the fresh
  //   list observation, step 4 on the detail observation; passing proves refresh.
  it('T2 步骤顺序与观测刷新：navigate 后 act 使用新观测引用', async () => {
    const result = await runGoldenTask(
      new FakeBrowserRuntime(TASK_BROWSE_DETAIL_BACK.site),
      TASK_BROWSE_DETAIL_BACK,
    );
    expect(result.passed).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
    // s2 点击结果一（列表页新观测 [e1]）与 s4 点击返回（详情页新观测 [e1]）均 committed。
    // — English: s2 (list [e1]) and s4 (detail [e1]) both committed.
    expect(result.steps[1].detail).toContain('已提交');
    expect(result.steps[3].detail).toContain('已提交');
  });
});
