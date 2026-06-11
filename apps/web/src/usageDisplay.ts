import type { Locale } from './config.js';
import type { Usage } from './types.js';

export function formatTokenSummary(total: Usage | undefined | null, locale: Locale): string {
  if (!total) return '';
  const inputTokens = Number(total.inputTokens ?? 0);
  const cachedInputTokens = Number(total.cachedInputTokens ?? 0);
  const outputTokens = Number(total.outputTokens ?? 0);
  if (!inputTokens && !cachedInputTokens && !outputTokens) return '';
  const hitRate = inputTokens > 0 ? Math.round((cachedInputTokens / inputTokens) * 100) : 0;
  const cacheLabel = total.cacheStrategy === 'deepseek-native'
    ? (locale === 'zh' ? 'DeepSeek 缓存' : 'DeepSeek cache')
    : (locale === 'zh' ? '缓存' : 'cache');
  return locale === 'zh'
    ? `Token：输入 ${inputTokens}，${cacheLabel} ${cachedInputTokens}，命中率 ${hitRate}%，输出 ${outputTokens}`
    : `Tokens: input ${inputTokens}, ${cacheLabel} ${cachedInputTokens}, hit ${hitRate}%, output ${outputTokens}`;
}

export function formatCacheDiagnostics(
  diagnostics: {
    stable?: boolean;
    reasons?: string[];
    shape?: { prefixHash?: string };
  } | null | undefined,
  locale: Locale,
): string {
  if (!diagnostics || diagnostics.stable !== false) return '';
  const reasons = diagnostics.reasons?.length ? diagnostics.reasons.join(locale === 'zh' ? '、' : ', ') : 'unknown';
  const hash = diagnostics.shape?.prefixHash ? ` · ${diagnostics.shape.prefixHash.slice(0, 8)}` : '';
  return locale === 'zh'
    ? `缓存前缀变化：${reasons}${hash}`
    : `Cache prefix changed: ${reasons}${hash}`;
}

export function formatCompactionPressure(
  pressure: {
    status?: string;
    estimatedTokens?: number;
    hardThreshold?: number;
  } | null | undefined,
  locale: Locale,
): string {
  if (!pressure || pressure.status !== 'soft') return '';
  const estimated = Number(pressure.estimatedTokens ?? 0);
  const hardThreshold = Number(pressure.hardThreshold ?? 0);
  return locale === 'zh'
    ? `上下文接近压缩阈值：${estimated}/${hardThreshold}`
    : `Context near compaction threshold: ${estimated}/${hardThreshold}`;
}
