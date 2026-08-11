// 能力层测试（架构文档 12.1 + 12.2）：能力注册表完整性、getCapability 查找、
// 权限需求映射、副作用/后置条件契约，以及健康度聚合（成功率、不确定率、
// 过期引用率、平均步数、人工接管率、最近连续非 committed 的降级/停用判定）。
// — English: capability-layer tests (architecture §12.1 + §12.2) — catalog
//   completeness, getCapability lookup, grant mapping, effect/postcondition
//   contract, and health aggregation (success/uncertain/stale-ref rates,
//   avg steps, human-takeover rate, and degraded/disabled from the most
//   recent consecutive non-committed run).
import { describe, expect, it } from 'vitest';
import {
  BROWSER_CAPABILITIES,
  aggregateCapabilityHealth,
  getCapability,
} from './capabilities.js';

const CAPABILITY_NAMES = BROWSER_CAPABILITIES.map((c) => c.name);

describe('BROWSER_CAPABILITIES（12.1 能力注册表）', () => {
  it('注册 10 个能力且 name 全唯一、字段齐全', () => {
    // — English: exactly 10 capabilities, unique names, complete fields
    expect(BROWSER_CAPABILITIES).toHaveLength(10);
    expect(new Set(CAPABILITY_NAMES).size).toBe(10);
    for (const c of BROWSER_CAPABILITIES) {
      expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.outputSummary.length).toBeGreaterThan(0);
      expect(c.requiredGrant.access).toMatch(/^(read|write|command|network|tool_call)$/);
      expect(c.requiredGrant.target).toEqual({ kind: 'tool', toolName: c.name });
      expect(c.estimatedCost.steps).toBeGreaterThan(0);
      expect(c.estimatedCost.tokens).toBeGreaterThan(0);
      expect(['none', 'local', 'external_reversible', 'external_irreversible']).toContain(c.effect);
      expect(['low', 'medium', 'high', 'critical']).toContain(c.risk);
      expect(typeof c.defaultPostcondition.kind).toBe('string');
      // 必填输入字段的 name 唯一（— English: required input field names unique）
      const fieldNames = c.inputFields.map((f) => f.name);
      expect(new Set(fieldNames).size).toBe(fieldNames.length);
    }
  });

  it('覆盖 10 个约定能力名', () => {
    // — English: covers the ten contracted capability names
    const expected = [
      'browser.navigate',
      'browser.observe',
      'browser.click',
      'browser.type',
      'browser.select',
      'browser.press',
      'browser.scroll',
      'browser.screenshot',
      'browser.download',
      'browser.wait',
    ];
    expect([...CAPABILITY_NAMES].sort()).toEqual([...expected].sort());
  });
});

describe('getCapability', () => {
  it("'browser.click' 返回对应定义", () => {
    // — English: 'browser.click' returns the matching definition
    const cap = getCapability('browser.click');
    expect(cap).toBeDefined();
    expect(cap?.name).toBe('browser.click');
    // 与注册表同一引用（— English: same reference as the catalog entry）
    expect(cap).toBe(BROWSER_CAPABILITIES.find((c) => c.name === 'browser.click'));
  });

  it("未知名称返回 undefined，且查找大小写敏感", () => {
    // — English: unknown names return undefined; lookup is case-sensitive
    expect(getCapability('browser.unknown')).toBeUndefined();
    expect(getCapability('Browser.click')).toBeUndefined();
    expect(getCapability('')).toBeUndefined();
  });
});

describe('权限需求（requiredGrant）映射', () => {
  it('navigate/download 要求 network，click/type 要求 tool_call，observe 要求 read', () => {
    // — English: navigate/download need network, click/type need tool_call,
    //   observe needs read
    expect(getCapability('browser.navigate')?.requiredGrant.access).toBe('network');
    expect(getCapability('browser.download')?.requiredGrant.access).toBe('network');
    expect(getCapability('browser.click')?.requiredGrant.access).toBe('tool_call');
    expect(getCapability('browser.type')?.requiredGrant.access).toBe('tool_call');
    expect(getCapability('browser.observe')?.requiredGrant.access).toBe('read');
  });
});

describe('副作用与后置条件契约', () => {
  it('download 的 effect 为 external_reversible、风险 medium、后置条件 download_completed', () => {
    // — English: download has effect external_reversible, risk medium, and
    //   postcondition download_completed
    const download = getCapability('browser.download');
    expect(download?.effect).toBe('external_reversible');
    expect(download?.risk).toBe('medium');
    expect(download?.defaultPostcondition).toEqual({ kind: 'download_completed' });
  });

  it('navigate 的默认后置条件为 url_contains（占位符由调用方实例化）', () => {
    // — English: navigate defaults to url_contains (placeholder instantiated
    //   by the caller)
    expect(getCapability('browser.navigate')?.defaultPostcondition).toEqual({
      kind: 'url_contains',
      value: '{url}',
    });
  });

  it('click 的默认后置条件为 none（具体后置条件由调用方给）', () => {
    // — English: click defaults to 'none' (the caller supplies the concrete
    //   postcondition)
    expect(getCapability('browser.click')?.defaultPostcondition).toEqual({ kind: 'none' });
  });
});

describe('aggregateCapabilityHealth（12.2 健康度）', () => {
  it('空 outcomes → attempts 0、successRate 1、degraded/disabled false', () => {
    // — English: empty outcomes → attempts 0, successRate 1, healthy
    const h = aggregateCapabilityHealth({ name: 'browser.click', outcomes: [] });
    expect(h.name).toBe('browser.click');
    expect(h.attempts).toBe(0);
    expect(h.successRate).toBe(1);
    expect(h.uncertainRate).toBe(0);
    expect(h.degraded).toBe(false);
    expect(h.disabled).toBe(false);
  });

  it('3 次 committed + 1 次 failed(NETWORK) → attempts 4、successRate 0.75、不降级', () => {
    // — English: 3 committed + 1 failed(NETWORK) → attempts 4, successRate
    //   0.75, not degraded
    const h = aggregateCapabilityHealth({
      name: 'browser.navigate',
      outcomes: [
        { outcome: 'committed' },
        { outcome: 'committed' },
        { outcome: 'committed' },
        { outcome: 'failed', errorCode: 'NETWORK' },
      ],
    });
    expect(h.attempts).toBe(4);
    expect(h.successRate).toBe(0.75);
    expect(h.uncertainRate).toBe(0);
    expect(h.staleRefRate).toBe(0);
    expect(h.degraded).toBe(false);
    expect(h.disabled).toBe(false);
  });

  it('平均步数：缺省 1 步，四舍五入到 1 位小数', () => {
    // — English: avg steps default to 1 per outcome, rounded to 1 decimal
    const h = aggregateCapabilityHealth({
      name: 'browser.download',
      outcomes: [
        { outcome: 'committed', steps: 2 },
        { outcome: 'committed', steps: 3 },
        { outcome: 'committed' },
      ],
    });
    expect(h.avgSteps).toBe(2);
  });

  it('连续 3 次 failed(STALE_EPOCH) → degraded true、staleRefRate 1、未停用', () => {
    // — English: 3 consecutive failed(STALE_EPOCH) → degraded, staleRefRate 1,
    //   not disabled
    const h = aggregateCapabilityHealth({
      name: 'browser.click',
      outcomes: [
        { outcome: 'failed', errorCode: 'STALE_EPOCH' },
        { outcome: 'failed', errorCode: 'STALE_EPOCH' },
        { outcome: 'failed', errorCode: 'STALE_EPOCH' },
      ],
    });
    expect(h.degraded).toBe(true);
    expect(h.staleRefRate).toBe(1);
    expect(h.successRate).toBe(0);
    expect(h.disabled).toBe(false);
  });

  it('ELEMENT_ 前缀错误码计入 staleRefRate', () => {
    // — English: ELEMENT_-prefixed error codes count into staleRefRate
    const h = aggregateCapabilityHealth({
      name: 'browser.type',
      outcomes: [
        { outcome: 'committed' },
        { outcome: 'failed', errorCode: 'ELEMENT_NOT_FOUND' },
      ],
    });
    expect(h.staleRefRate).toBe(0.5);
  });

  it('连续 5 次 failed → disabled true', () => {
    // — English: 5 consecutive failed → disabled (12.2 disable + alert)
    const h = aggregateCapabilityHealth({
      name: 'browser.wait',
      outcomes: [
        { outcome: 'failed', errorCode: 'TIMEOUT' },
        { outcome: 'failed', errorCode: 'TIMEOUT' },
        { outcome: 'failed', errorCode: 'TIMEOUT' },
        { outcome: 'failed', errorCode: 'TIMEOUT' },
        { outcome: 'failed', errorCode: 'TIMEOUT' },
      ],
    });
    expect(h.disabled).toBe(true);
    expect(h.degraded).toBe(true);
    expect(h.successRate).toBe(0);
  });

  it('混合：中间失败后连续 3 次 uncertain → degraded true（只看最近连续）', () => {
    // — English: mixed — a middle failure followed by 3 consecutive
    //   uncertain → degraded true (only the most recent run counts)
    const h = aggregateCapabilityHealth({
      name: 'browser.scroll',
      outcomes: [
        { outcome: 'committed' },
        { outcome: 'failed', errorCode: 'ELEMENT_NOT_FOUND' },
        { outcome: 'uncertain', errorCode: 'NAVIGATION_RACE' },
        { outcome: 'uncertain' },
        { outcome: 'uncertain' },
      ],
    });
    expect(h.degraded).toBe(true);
    expect(h.disabled).toBe(false);
    expect(h.uncertainRate).toBe(0.6);
  });

  it('最近连续以 committed 结尾时即使中间失败也不降级', () => {
    // — English: ending on committed never degrades, even with middle failures
    const h = aggregateCapabilityHealth({
      name: 'browser.select',
      outcomes: [
        { outcome: 'failed', errorCode: 'STALE_EPOCH' },
        { outcome: 'failed', errorCode: 'STALE_EPOCH' },
        { outcome: 'committed' },
      ],
    });
    expect(h.degraded).toBe(false);
    expect(h.disabled).toBe(false);
  });

  it('humanTakeoverRate：3 次中 1 次 requiredApproval → 0.333', () => {
    // — English: 1 of 3 outcomes with requiredApproval → 0.333
    const h = aggregateCapabilityHealth({
      name: 'browser.download',
      outcomes: [
        { outcome: 'committed', requiredApproval: true },
        { outcome: 'committed' },
        { outcome: 'committed', requiredApproval: false },
      ],
    });
    expect(h.humanTakeoverRate).toBe(0.333);
    expect(h.successRate).toBe(1);
  });
});
