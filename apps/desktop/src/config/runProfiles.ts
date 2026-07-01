import type { Locale, RunProfile } from './config.js';

// 根据当前语言返回运行模式的简短标签，用于下拉选择等 UI
// Chinese translation: Returns a short label for the run profile in the current language, used for dropdown UIs.
export function runProfileLabel(profile: RunProfile, locale: Locale): string {
  if (profile === 'cache_first') return locale === 'zh' ? '缓存优先' : 'Cache';
  return locale === 'zh' ? '长运行' : 'Runtime';
}

// 返回运行模式的详细说明文本（缓存优先 vs Runtime OS）
// Chinese translation: Returns a detailed description text for a run profile (cache-first vs Runtime OS).
export function runProfileDescription(profile: RunProfile, locale: Locale): string {
  if (profile === 'cache_first') {
    return locale === 'zh'
      ? '保持提示词和工具结构稳定，尽量延迟压缩，提高 DeepSeek / OpenAI 兼容模型缓存命中。'
      : 'Keeps prompt and tool structure stable, delays compaction, and improves DeepSeek/OpenAI-compatible cache hits.';
  }
  return locale === 'zh'
    ? '使用 Runtime OS 策略，优先保证长任务、多智能体、工具调用、压缩和中断恢复可追踪。'
    : 'Uses the Runtime OS strategy for traceable long tasks, multi-agent work, tools, compaction, and recovery.';
}
