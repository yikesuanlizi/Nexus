import type { Locale, RunProfile } from './config.js';

export function runProfileLabel(profile: RunProfile, locale: Locale): string {
  if (profile === 'cache_first') return locale === 'zh' ? '缓存优先' : 'Cache';
  if (profile === 'harness') return locale === 'zh' ? 'Harness 自主循环' : 'Harness';
  return locale === 'zh' ? '长运行' : 'Runtime';
}

export function runProfileDescription(profile: RunProfile, locale: Locale): string {
  if (profile === 'cache_first') {
    return locale === 'zh'
      ? '保持提示词和工具结构稳定，尽量延迟压缩，提高 DeepSeek / OpenAI 兼容模型缓存命中。'
      : 'Keeps prompt and tool structure stable, delays compaction, and improves DeepSeek/OpenAI-compatible cache hits.';
  }
  if (profile === 'harness') {
    return locale === 'zh'
      ? '启用 Task Harness Engine 自主循环：Goal → Plan → Execute → Critique → Replan，配合 Evidence Ledger 与四层上下文裁切。'
      : 'Enables Task Harness Engine autonomous loop: Goal → Plan → Execute → Critique → Replan, with Evidence Ledger and 4-layer context slicing.';
  }
  return locale === 'zh'
    ? '使用 Runtime OS 策略，优先保证长任务、多智能体、工具调用、压缩和中断恢复可追踪。'
    : 'Uses the Runtime OS strategy for traceable long tasks, multi-agent work, tools, compaction, and recovery.';
}
