import { isUsageAmount } from '../runtime-usage'
import type { RunReport, UsageSplit } from './index'

/** Numeric reports replace subtotals; explicit or malformed missingness is irreversible. */
export function mergeReportedUsage(
  target: Partial<UsageSplit>,
  report: Pick<RunReport, 'costUsd' | 'usage'>,
): void {
  const update = {
    ...report.usage,
    inferenceUsd: report.usage?.inferenceUsd ?? report.costUsd,
  }
  for (const [amount, known] of [
    ['inferenceUsd', 'inferenceUsdKnown'],
    ['intelligenceUsd', 'intelligenceUsdKnown'],
    ['estimatedInferenceUsd', undefined],
  ] as const) {
    const value = update[amount]
    if (isUsageAmount(value)) target[amount] = value
    else if (value !== undefined && known !== undefined) target[known] = false
    if (known !== undefined && update[known] === false) target[known] = false
  }
}

/** Absence is unknown; OFF alone proves zero Intelligence spend without a receipt. */
export function normalizeReportedUsage(
  usage: Partial<UsageSplit>,
  intelligenceOff = false,
): UsageSplit {
  const inferenceKnown = isUsageAmount(usage.inferenceUsd) && usage.inferenceUsdKnown !== false
  const intelligenceKnown =
    intelligenceOff ||
    (isUsageAmount(usage.intelligenceUsd) && usage.intelligenceUsdKnown !== false)
  return {
    inferenceUsd: isUsageAmount(usage.inferenceUsd) ? usage.inferenceUsd : 0,
    intelligenceUsd:
      intelligenceOff || !isUsageAmount(usage.intelligenceUsd) ? 0 : usage.intelligenceUsd,
    ...(!inferenceKnown ? { inferenceUsdKnown: false } : {}),
    ...(!intelligenceKnown ? { intelligenceUsdKnown: false } : {}),
    ...(isUsageAmount(usage.estimatedInferenceUsd)
      ? { estimatedInferenceUsd: usage.estimatedInferenceUsd }
      : {}),
  }
}
