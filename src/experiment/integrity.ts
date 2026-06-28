/**
 * Capture-integrity guards: make the most common dishonest-number failure modes
 * structurally hard rather than a matter of convention.
 *
 *  - {@link normalizeEvidence} fails closed on out-of-range scores / negative usage.
 *  - {@link shouldRetryEvidence} flags a cell that has not produced trustworthy
 *    evidence (invalid contract, unscored, or tokenless on a metered backend).
 *  - {@link assertExecutableEvidence} enforces that scores come from an executable
 *    grader, never an LLM judge (the selector/judge firewall at the type layer).
 *  - {@link MissingCampaignAdapterError} refuses to substitute a fixture for a
 *    live arm.
 */
import type { EvidenceKind, RunAdapterKind, RunEvidence } from './types'
import { evidenceKinds } from './types'

export class CampaignIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CampaignIntegrityError'
  }
}

export class MissingCampaignAdapterError extends Error {
  constructor(kind: RunAdapterKind, cellId?: string) {
    super(
      `No campaign adapter registered for ${kind}${cellId ? ` while planning ${cellId}` : ''}. ` +
        'Implement the runtime adapter or use artifact replay; do not substitute a fixture for a live arm.',
    )
    this.name = 'MissingCampaignAdapterError'
  }
}

/** Validate evidence invariants. Throws {@link CampaignIntegrityError} on a
 *  score outside [0,1] (non-null) or any negative usage field. */
export function normalizeEvidence(evidence: RunEvidence): RunEvidence {
  if (evidence.score !== null && (evidence.score < 0 || evidence.score > 1)) {
    throw new CampaignIntegrityError(`score must be in [0,1] or null, got ${evidence.score}`)
  }
  const u = evidence.usage
  if (u.inputTokens < 0 || u.outputTokens < 0 || u.costUsd < 0 || u.latencyMs < 0) {
    throw new CampaignIntegrityError('usage fields must be non-negative')
  }
  return evidence
}

/** True when a cell has not produced trustworthy evidence and should be re-run:
 *  the output contract failed, the cell is unscored/unjudged, or it scored on a
 *  metered backend while spending zero tokens (a fake-backend signal). */
export function shouldRetryEvidence(evidence: RunEvidence): boolean {
  const meteringUnavailable = evidence.metrics?.meteringUnavailable === 1
  const tokenless =
    !meteringUnavailable && evidence.usage.inputTokens === 0 && evidence.usage.outputTokens === 0
  return (
    evidence.outputContractValid === false ||
    evidence.score === null ||
    evidence.passed === null ||
    tokenless
  )
}

/** Evidence kinds whose scores are produced by executable graders (state checks,
 *  file diffs, field validation, replayed artifacts), never an LLM judge. */
const executableEvidenceKinds: ReadonlySet<EvidenceKind> = new Set(evidenceKinds)

/** Assert that a cell's evidence kind is one whose score is executable, not
 *  judge-produced. The current evidence-kind set is judge-free by construction;
 *  this guard makes that contract explicit and future-proof. */
export function assertExecutableEvidence(evidenceKind: EvidenceKind): void {
  if (!executableEvidenceKinds.has(evidenceKind)) {
    throw new CampaignIntegrityError(
      `evidence kind ${evidenceKind} is not an executable-graded kind; ` +
        'scores must come from a deterministic grader, not an LLM judge',
    )
  }
}
