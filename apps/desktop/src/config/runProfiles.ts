import type { Locale, RunProfile } from './config.js';

/**
 * 运行模式简短标签，用于下拉选择等 UI。
 *
 * 注意：harness 不再是 RunProfile。如果传入旧值 'harness'，
 * 会当作 runtime_os 处理（避免历史配置显示异常）。
 */
export function runProfileLabel(profile: RunProfile | 'harness', locale: Locale): string {
  if (profile === 'cache_first') return locale === 'zh' ? '缓存优先' : 'Cache';
  // runtime_os 或旧值 harness 都显示为"长运行"
  return locale === 'zh' ? '长运行' : 'Runtime';
}

/**
 * 运行模式详细说明文本（缓存优先 / 长运行）。
 *
 * harness 不再是独立 profile，其自主循环能力已下沉为 runtime 底座的
 * 约束/证据/验收层，由 runtime 在长运行模式下按需启用。
 */
export function runProfileDescription(profile: RunProfile | 'harness', locale: Locale): string {
  if (profile === 'cache_first') {
    return locale === 'zh'
      ? '保持提示词和工具结构稳定，尽量延迟压缩，提高 DeepSeek / OpenAI 兼容模型缓存命中。'
      : 'Keeps prompt and tool structure stable, delays compaction, and improves DeepSeek/OpenAI-compatible cache hits.';
  }
  // runtime_os 或旧值 harness
  return locale === 'zh'
    ? '使用长运行策略，优先保证长任务、多智能体、工具调用、压缩和中断恢复可追踪。harness 的约束/证据/验收能力已下沉为 runtime 底座，按需自动启用。'
    : 'Uses the long-running strategy for traceable long tasks, multi-agent work, tools, compaction, and recovery. Harness constraints/evidence/acceptance are now a runtime subsystem, auto-engaged as needed.';
}
