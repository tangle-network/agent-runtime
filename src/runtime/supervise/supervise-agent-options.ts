import { ValidationError } from '../../errors'
import { plateau, type StopRule } from './stop-rules'

import type { SuperviseOptions } from './supervise-options'

/** A stop rule as a function, or the declared plateau form a record carries as data. */
function stopRuleOf(rule: NonNullable<SuperviseOptions['stopRule']>): StopRule {
  if (typeof rule === 'function') return rule
  if (typeof rule === 'object' && rule !== null && 'plateau' in rule) return plateau(rule.plateau)
  throw new ValidationError(
    'supervise: stopRule must be a StopRule or { plateau: { window, minDelta } }',
  )
}

export function supervisorTurnOptions(options: SuperviseOptions) {
  return {
    ...(options.stopRule ? { stopRule: stopRuleOf(options.stopRule) } : {}),
    ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(options.compaction ? { compaction: options.compaction } : {}),
    ...(options.driverRetry ? { driverRetry: options.driverRetry } : {}),
    ...(options.onDriverAttempt ? { onDriverAttempt: options.onDriverAttempt } : {}),
  }
}
