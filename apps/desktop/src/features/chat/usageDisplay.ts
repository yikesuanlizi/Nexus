import type { Locale } from '../../config/config.js';
import type { ThreadUsage, Usage } from '../../shared/types.js';

export interface TokenUsageSummary {
  totalInput: number;
  totalCached: number;
  totalOutput: number;
  hitRate: number;
  cacheLabel: string;
}

export function buildTokenUsageSummary(
  threadUsage: ThreadUsage | undefined | null,
  locale: Locale,
): TokenUsageSummary | null {
  if (!threadUsage) return null;
  const total = threadUsage.total;
  const inputTokens = Number(total.inputTokens ?? 0);
  const cachedInputTokens = Number(total.cachedInputTokens ?? 0);
  const outputTokens = Number(total.outputTokens ?? 0);
  if (!inputTokens && !cachedInputTokens && !outputTokens) return null;
  const hitRate = inputTokens > 0 ? Math.round((cachedInputTokens / inputTokens) * 100) : 0;
  return {
    totalInput: inputTokens,
    totalCached: cachedInputTokens,
    totalOutput: outputTokens,
    hitRate,
    cacheLabel: locale === 'zh' ? '缓存' : 'cache',
  };
}

export function formatTokenSummary(total: Usage | undefined | null, locale: Locale): string {
  if (!total) return '';
  return formatUsageLine(total, locale);
}

export function formatThreadTokenSummary(threadUsage: ThreadUsage | undefined | null, locale: Locale): string {
  if (!threadUsage) return '';
  const last = threadUsage.turns.at(-1)?.usage;
  const total = threadUsage.total;
  if (!last) return formatUsageLine(total, locale);
  const lastText = formatUsageNumbers(last, locale);
  const totalText = formatUsageNumbers(total, locale, { omitCacheLabel: true });
  return locale === 'zh'
    ? `Token：本轮 ${lastText}；累计 ${totalText}`
    : `Tokens: turn ${lastText}; total ${totalText}`;
}

function formatUsageLine(total: Usage, locale: Locale): string {
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

function formatUsageNumbers(
  usage: Usage,
  locale: Locale,
  options: { omitCacheLabel?: boolean } = {},
): string {
  const inputTokens = Number(usage.inputTokens ?? 0);
  const cachedInputTokens = Number(usage.cachedInputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  const hitRate = inputTokens > 0 ? Math.round((cachedInputTokens / inputTokens) * 100) : 0;
  const cacheLabel = options.omitCacheLabel
    ? (locale === 'zh' ? '缓存' : 'cache')
    : usage.cacheStrategy === 'deepseek-native'
      ? (locale === 'zh' ? 'DeepSeek 缓存' : 'DeepSeek cache')
      : (locale === 'zh' ? '缓存' : 'cache');
  return locale === 'zh'
    ? `输入 ${inputTokens}，${cacheLabel} ${cachedInputTokens}，命中率 ${hitRate}%，输出 ${outputTokens}`
    : `input ${inputTokens}, ${cacheLabel} ${cachedInputTokens}, hit ${hitRate}%, output ${outputTokens}`;
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
