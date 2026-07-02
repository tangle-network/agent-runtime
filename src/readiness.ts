/**
 *
 * Pure readiness-decision helper. Maps a `KnowledgeReadinessReport` from
 * `@tangle-network/agent-eval` to a three-state branch (`ready` / `blocked` /
 * `caveat`) the runtime, route handlers, and UI shells can all switch on.
 *
 * Default `minimumScore` of 0.7 mirrors the readiness scoring scale in
 * agent-eval; callers tightening or loosening this should keep it consistent
 * across all entry points for the same product so the UI / metrics agree on
 * what "caveat" means.
 *
 * @stable
 */

import type { KnowledgeReadinessReport } from '@tangle-network/agent-eval'

import { ValidationError } from './errors'
import type { KnowledgeReadinessDecision } from './types'

const DEFAULT_MINIMUM_READINESS_SCORE = 0.7

/**
 * Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.
 *
 * @stable
 */
export function decideKnowledgeReadiness(
  report: KnowledgeReadinessReport,
  options: { minimumScore?: number } = {},
): KnowledgeReadinessDecision {
  const minimumScore = options.minimumScore ?? DEFAULT_MINIMUM_READINESS_SCORE
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new ValidationError(
      `minimumScore must be a finite number in [0, 1]; received ${String(minimumScore)}`,
    )
  }
  const blockingGapIds = report.blockingMissingRequirements.map((requirement) => requirement.id)
  const nonBlockingGapIds = report.nonBlockingGaps.map((requirement) => requirement.id)
  if (blockingGapIds.length > 0) {
    return {
      passed: false,
      status: 'blocked',
      reason: report.reason,
      readinessScore: report.readinessScore,
      recommendedAction: report.recommendedAction,
      severity: report.severity,
      blockingGapIds,
      nonBlockingGapIds,
    }
  }
  if (report.readinessScore < minimumScore) {
    return {
      passed: false,
      status: 'caveat',
      reason: `Knowledge readiness score ${report.readinessScore.toFixed(3)} is below minimum ${minimumScore.toFixed(3)}.`,
      readinessScore: report.readinessScore,
      recommendedAction: report.recommendedAction,
      severity: report.severity,
      blockingGapIds,
      nonBlockingGapIds,
    }
  }
  return {
    passed: true,
    status: 'ready',
    reason: report.reason,
    readinessScore: report.readinessScore,
    recommendedAction: report.recommendedAction,
    severity: report.severity,
    blockingGapIds,
    nonBlockingGapIds,
  }
}
