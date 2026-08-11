// 用户进度投影测试（架构文档 15.2）：全类型事件文案逐条匹配、无法映射的事件
// 跳过、tone 映射、空输入、at 字段解析
// — English: user progress projection tests (architecture §15.2) — copy
//   matching per event type, unmappable events skipped, tone mapping, empty
//   input, at-field resolution
import { describe, expect, it } from 'vitest';
import { actionKindLabel, projectProgress, type ProgressSource } from './progress.js';

describe('projectProgress', () => {
  it('全类型事件序列 → 文案逐条匹配（含 click/navigate/submit 等 label 映射）', () => {
    const sources: ProgressSource[] = [
      { type: 'task.created', createdAt: '2025-01-01T00:00:00.000Z' },
      { type: 'browser.navigate', url: 'https://example.com', at: 1_000 },
      { type: 'observation.accepted', elementCount: 12, at: 2_000 },
      { type: 'action.prepared', actionKind: 'click', at: 3_000 },
      { type: 'action.completed', outcome: 'committed', at: 4_000 },
      { type: 'action.prepared', actionKind: 'navigate', at: 5_000 },
      { type: 'action.completed', outcome: 'uncertain', at: 6_000 },
      { type: 'action.prepared', actionKind: 'submit', at: 7_000 },
      { type: 'action.completed', outcome: 'failed', errorCode: 'E_TIMEOUT', at: 8_000 },
      { type: 'human.requested', prompt: '是否允许访问该页面？', at: 9_000 },
      { type: 'human.resolved', approved: true, at: 10_000 },
      { type: 'human.resolved', approved: false, at: 11_000 },
      { type: 'budget.updated', at: 12_000 },
      { type: 'task.paused', at: 13_000 },
      { type: 'task.cancelled', at: 14_000 },
      { type: 'task.failed', code: 'E_BUDGET', at: 15_000 },
      { type: 'task.completed', at: 16_000 },
    ];

    const entries = projectProgress(sources);

    expect(entries).toHaveLength(sources.length);
    // 文案逐条匹配
    // — English: copy matches entry by entry
    expect(entries.map((e) => e.text)).toEqual([
      '任务已创建',
      '正在打开 https://example.com',
      '已获取页面快照（12 个可交互元素）',
      '正在执行 点击',
      '操作完成',
      '正在执行 导航',
      '操作结果不确定，等待对账',
      '正在执行 提交',
      '操作失败：E_TIMEOUT',
      '需要确认：是否允许访问该页面？',
      '已确认',
      '已拒绝，Agent 将调整方案',
      '预算已更新',
      '任务已暂停',
      '任务已取消',
      '任务失败：E_BUDGET',
      '任务完成',
    ]);
    // tone 与 source 逐条匹配
    // — English: tone and source match entry by entry
    expect(entries.map((e) => e.tone)).toEqual([
      'info', 'info', 'info', 'info', 'ok', 'info', 'warn', 'info',
      'error', 'warn', 'ok', 'info', 'info', 'info', 'warn', 'error', 'ok',
    ]);
    expect(entries.map((e) => e.source)).toEqual(sources.map((s) => s.type));
  });

  it('无法映射的输入被跳过且不抛错', () => {
    // 类型上用 ProgressSource 收窄不了 unknown——直接传 as never 验证运行时跳过
    // — English: ProgressSource cannot narrow unknown — pass as never to
    //   verify runtime skipping
    const unknown = { type: 'unknown' } as never;
    const future = { type: 'plan.updated' } as never;
    expect(() => projectProgress([unknown, future])).not.toThrow();
    expect(projectProgress([unknown])).toEqual([]);
    expect(projectProgress([unknown, future])).toEqual([]);
  });

  it('uncertain / failed / cancelled 的 tone 断言', () => {
    const entries = projectProgress([
      { type: 'action.completed', outcome: 'uncertain', at: 1 },
      { type: 'action.completed', outcome: 'failed', errorCode: 'E_X', at: 2 },
      { type: 'action.completed', outcome: 'failed', at: 3 }, // 无 errorCode → 未知错误
      { type: 'task.cancelled', at: 4 },
      { type: 'task.failed', code: 'E_Y', at: 5 },
    ]);
    expect(entries.map((e) => e.tone)).toEqual(['warn', 'error', 'error', 'warn', 'error']);
    expect(entries[2].text).toBe('操作失败：未知错误');
  });

  it('空数组返回空数组', () => {
    expect(projectProgress([])).toEqual([]);
  });

  it('at 字段：数字事件透传，task.created 用 Date.parse(createdAt)', () => {
    const entries = projectProgress([
      { type: 'task.created', createdAt: '2025-03-01T08:00:00.000Z' },
      { type: 'browser.navigate', url: 'https://example.com', at: 42 },
      { type: 'task.created', createdAt: 'not-a-date' }, // 解析失败回退 0
    ]);
    expect(entries[0].at).toBe(Date.parse('2025-03-01T08:00:00.000Z'));
    expect(entries[1].at).toBe(42);
    expect(entries[2].at).toBe(0);
  });
});

describe('actionKindLabel', () => {
  it('已知动作种类映射为中文标签，未知种类原样返回', () => {
    expect(actionKindLabel('click')).toBe('点击');
    expect(actionKindLabel('type')).toBe('输入');
    expect(actionKindLabel('navigate')).toBe('导航');
    expect(actionKindLabel('submit')).toBe('提交');
    expect(actionKindLabel('download')).toBe('下载');
    expect(actionKindLabel('scroll')).toBe('滚动');
    expect(actionKindLabel('screenshot')).toBe('截图');
    expect(actionKindLabel('wait')).toBe('等待');
    expect(actionKindLabel('select')).toBe('select'); // 未收录 → 原样
    expect(actionKindLabel('press')).toBe('press');
    expect(actionKindLabel('observe')).toBe('observe');
  });
});
