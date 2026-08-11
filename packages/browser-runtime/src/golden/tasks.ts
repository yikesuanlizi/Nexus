// 首批黄金任务：覆盖动态 DOM、多页导航、错误页与确认流程的本地固定站点脚本
// （架构文档 16.1 第一层『本地固定站点』+ Phase 0 遗留）。
// 每个任务的站点自洽：startUrl 在 pages 中、navigate/href 目标都存在、
// onAction 效果与步骤断言一致。
// — English: first batch of golden tasks — local pinned-site scripts covering
//   dynamic DOM, multi-page navigation, error pages and confirmation flows
//   (architecture doc §16.1 layer one + Phase 0). Every site is self-consistent:
//   startUrl in pages, navigate/href targets exist, onAction matches assertions.
import type { GoldenTask } from './goldenTypes.js';

// 统一本地固定站点域名。
// — English: shared local pinned-site origin.
const ORIGIN = 'https://golden.test';
const URL_LIST = `${ORIGIN}/list`;
const URL_DETAIL = `${ORIGIN}/detail`;
const URL_FORM = `${ORIGIN}/form`;
const URL_SUCCESS = `${ORIGIN}/success`;

// T1 'open-read-title'：打开列表页，断言 url 与标题。
// — English: T1 — open the list page, assert url and title.
export const TASK_OPEN_READ_TITLE: GoldenTask = {
  id: 'open-read-title',
  name: '打开列表页并读取标题',
  goal: '打开黄金任务列表页，确认地址与页面标题。',
  site: {
    startUrl: URL_LIST,
    pages: [
      {
        url: URL_LIST,
        title: '黄金任务列表',
        elements: [
          { ref: 'link-result-1', role: 'link', name: '结果一', text: '结果一', href: URL_DETAIL },
          { ref: 'link-result-2', role: 'link', name: '结果二', text: '结果二', href: URL_DETAIL },
        ],
        content: [{ type: 'heading', text: '黄金任务列表' }],
      },
      // href 目标页必须存在，站点才自洽（本任务不访问，仅保证定义完整）。
      // — English: href targets must exist for site consistency (unused here).
      {
        url: URL_DETAIL,
        title: '结果一详情',
        content: [{ type: 'paragraph', text: '结果一的完整摘要。' }],
      },
    ],
  },
  steps: [
    { id: 's1', description: '打开列表页', navigate: { url: URL_LIST } },
    {
      id: 's2',
      description: '断言列表页 url 与标题',
      assert: { kind: 'observation', pageUrlContains: '/list', titleContains: '黄金任务列表' },
    },
  ],
};

// T2 'browse-detail-back'：列表页 → 点击结果一（导航到详情页）→ 断言 url_contains
// detail → 返回列表页 → 断言元素存在。第二步 act 的 [e1] 引用第一步 navigate 后
// 的新观测，第四步 act 的 [e1] 引用详情页观测——验证 latestObservation 刷新。
// — English: T2 — list → click result one (navigate to detail) → assert url →
//   back to list → assert element. Step 2's [e1] comes from the fresh list
//   observation, step 4's [e1] from the detail observation — refreshing works.
export const TASK_BROWSE_DETAIL_BACK: GoldenTask = {
  id: 'browse-detail-back',
  name: '浏览详情并返回列表',
  goal: '从列表页进入详情页，确认地址变化后返回列表页并确认元素仍在。',
  site: {
    startUrl: URL_LIST,
    pages: [
      {
        url: URL_LIST,
        title: '黄金任务列表',
        elements: [{ ref: 'link-result-1', role: 'link', name: '结果一', text: '结果一', href: URL_DETAIL }],
        content: [{ type: 'heading', text: '黄金任务列表' }],
      },
      {
        url: URL_DETAIL,
        title: '结果一详情',
        elements: [{ ref: 'link-back', role: 'link', name: '返回列表', text: '返回列表', href: URL_LIST }],
        content: [{ type: 'paragraph', text: '结果一的完整摘要：本项目为黄金任务回归站点。' }],
      },
    ],
  },
  steps: [
    { id: 's1', description: '打开列表页', navigate: { url: URL_LIST } },
    {
      id: 's2',
      description: '点击结果一进入详情页',
      act: {
        kind: 'click',
        targetRef: '[e1]',
        postcondition: { kind: 'url_contains', value: '/detail' },
        effect: 'local',
        risk: 'low',
        rationale: '点击列表中的结果一链接',
      },
    },
    { id: 's3', description: '断言已进入详情页', assert: { kind: 'url', pageUrlContains: '/detail' } },
    {
      id: 's4',
      description: '点击返回列表链接',
      act: {
        kind: 'click',
        targetRef: '[e1]',
        postcondition: { kind: 'url_equals', value: URL_LIST },
        effect: 'local',
        risk: 'low',
        rationale: '从详情页返回列表',
      },
    },
    { id: 's5', description: '断言列表页元素存在', assert: { kind: 'elements', hasElementText: '结果一' } },
  ],
};

// T3 'extract-summary'：打开详情页，断言 mainContent 含特定文本（摘要提取）。
// — English: T3 — open the detail page, assert a specific text in mainContent.
export const TASK_EXTRACT_SUMMARY: GoldenTask = {
  id: 'extract-summary',
  name: '提取详情页摘要',
  goal: '打开详情页，从正文中提取并核对关键摘要文本。',
  site: {
    startUrl: URL_DETAIL,
    pages: [
      {
        url: URL_DETAIL,
        title: '结果一详情',
        elements: [{ ref: 'heading-detail', role: 'heading', name: '详情', text: '结果一详情' }],
        content: [
          { type: 'heading', text: '结果一详情' },
          { type: 'paragraph', text: '核心指标：可用性 99.9%，平均响应 120ms。' },
        ],
      },
    ],
  },
  steps: [
    { id: 's1', description: '打开详情页', navigate: { url: URL_DETAIL } },
    { id: 's2', description: '断言摘要文本', assert: { kind: 'content', contentContains: '可用性 99.9%' } },
  ],
};

// T4 'compare-two-pages'：列表页与详情页各观测一次，用互斥文本断言两页内容不同。
// — English: T4 — observe list and detail once each; mutually exclusive texts
//   prove the two pages differ.
export const TASK_COMPARE_TWO_PAGES: GoldenTask = {
  id: 'compare-two-pages',
  name: '比较两页内容',
  goal: '分别观测列表页与详情页，确认两页内容不同。',
  site: {
    startUrl: URL_LIST,
    pages: [
      {
        url: URL_LIST,
        title: '黄金任务列表',
        elements: [{ ref: 'link-result-1', role: 'link', name: '结果一', text: '结果一', href: URL_DETAIL }],
        content: [{ type: 'heading', text: '列表视图：任务条目清单' }],
      },
      {
        url: URL_DETAIL,
        title: '结果一详情',
        elements: [{ ref: 'link-back', role: 'link', name: '返回列表', text: '返回列表', href: URL_LIST }],
        content: [{ type: 'heading', text: '详情视图：任务完整说明' }],
      },
    ],
  },
  steps: [
    { id: 's1', description: '观测列表页', navigate: { url: URL_LIST } },
    { id: 's2', description: '断言列表页特有文本', assert: { kind: 'content', contentContains: '列表视图' } },
    { id: 's3', description: '观测详情页', navigate: { url: URL_DETAIL } },
    { id: 's4', description: '断言详情页特有文本', assert: { kind: 'content', contentContains: '详情视图' } },
  ],
};

// T5 'form-confirm-flow'：表单页（含表单字段与提交按钮，onAction 提交后进入成功页）
// → 点击提交 → 断言成功页 url。表单填写留待 Phase 2，这里只验证提交导航闭环；
// 提交后页面整体变化（动态 DOM）由 navigate 副作用体现。
// — English: T5 — form page (fields + submit button, onAction navigates to the
//   success page after submit) → click submit → assert the success page url.
//   Form filling is deferred to Phase 2; this verifies the submit→navigate loop
//   (a full dynamic-DOM page change via the navigate side effect).
export const TASK_FORM_CONFIRM_FLOW: GoldenTask = {
  id: 'form-confirm-flow',
  name: '表单提交确认闭环',
  goal: '在反馈表单页点击提交，确认进入成功页。',
  site: {
    startUrl: URL_FORM,
    pages: [
      {
        url: URL_FORM,
        title: '反馈表单',
        elements: [{ ref: 'btn-submit', role: 'button', name: '提交反馈', text: '提交反馈' }],
        forms: [
          { formId: 'feedback', method: 'post', fields: [{ name: 'email', fieldType: 'email', required: true }] },
        ],
        onAction: (action) => {
          if (action.kind === 'click' && action.targetRef === 'btn-submit') {
            return { kind: 'navigate', url: URL_SUCCESS };
          }
          return undefined;
        },
      },
      {
        url: URL_SUCCESS,
        title: '提交成功',
        elements: [{ ref: 'badge-success', role: 'status', name: '提交成功', text: '提交成功' }],
        content: [{ type: 'paragraph', text: '您的反馈已提交，感谢参与黄金任务。' }],
      },
    ],
  },
  steps: [
    { id: 's1', description: '打开反馈表单页', navigate: { url: URL_FORM } },
    {
      id: 's2',
      description: '点击提交按钮',
      act: {
        kind: 'click',
        targetRef: '[e1]',
        postcondition: { kind: 'url_contains', value: '/success' },
        effect: 'external_reversible',
        risk: 'medium',
        rationale: '提交反馈表单，预期进入成功页',
      },
    },
    {
      id: 's3',
      description: '断言成功页',
      assert: { kind: 'observation', pageUrlContains: '/success', hasElementText: '提交成功' },
    },
  ],
};

// T6 't6-download-report'：文件列表页 → 下载报告.pdf（download 动作，页面不变）
// → 断言页面 url 未变。下载元数据进入会话账本，download_completed 由 fake
// 运行时基于『本次动作是否产生下载记录』判定（架构文档 11.2 下载管理在 fake
// 上的可执行验证）。
// — English: T6 — file list page → download report.pdf (download action leaves the
//   page untouched) → assert the page url is unchanged. Download metadata lands in
//   the session ledger; download_completed is judged by whether this action
//   produced a download record (architecture §11.2 executable on the fake).
export const TASK_DOWNLOAD_REPORT: GoldenTask = {
  id: 't6-download-report',
  name: '下载报告文件',
  goal: '从列表页下载报告文件。',
  site: {
    startUrl: 'https://example.com/files',
    pages: [
      {
        url: 'https://example.com/files',
        title: '文件列表',
        elements: [{ ref: 'dl-link', role: 'link', name: '下载报告', text: '下载报告' }],
      },
    ],
  },
  steps: [
    { id: 'observe', description: '打开文件列表页', observe: {} },
    {
      id: 'download',
      description: '下载报告.pdf',
      act: {
        kind: 'download',
        arguments: {
          url: 'https://example.com/files/report.pdf',
          suggestedName: 'report.pdf',
          sizeBytes: 1024,
        },
        postcondition: { kind: 'download_completed' },
        effect: 'external_reversible',
        risk: 'medium',
        rationale: '下载报告文件',
      },
    },
    {
      id: 'assert-page',
      description: '页面保持不变',
      assert: { kind: 'observation', pageUrlContains: 'https://example.com/files' },
    },
  ],
};

// 首批黄金任务全集（顺序即执行顺序）。
// — English: the first golden task set, in execution order.
export const GOLDEN_TASKS: readonly GoldenTask[] = [
  TASK_OPEN_READ_TITLE,
  TASK_BROWSE_DETAIL_BACK,
  TASK_EXTRACT_SUMMARY,
  TASK_COMPARE_TWO_PAGES,
  TASK_FORM_CONFIRM_FLOW,
  TASK_DOWNLOAD_REPORT,
];
