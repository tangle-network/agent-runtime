/**
 * Evidence-rich worker settlement.
 *
 * The supervisor BRAIN decides respawn/steer/stop from what a settled worker
 * shows it. A bare `finished passed=false patchBytes=6138` starves that
 * decision: the brain cannot quote the failing assertion, so its next worker
 * goal is authored blind. This module composes the bounded evidence block a
 * settling worker appends to its event stream and — on failure — returns as
 * its output artifact, so `observe_agent` hands the brain the failing verify
 * tail, a diff summary, and the worker's final note instead of counters.
 */

/** Hard cap on one worker's evidence block so the brain's context cannot blow up. */
export const EVIDENCE_MAX_CHARS = 3000
/** Tail of the verify output — the failing assertion lives at the END of a test log. */
export const VERIFY_TAIL_CHARS = 1200
const TYPECHECK_TAIL_CHARS = 400
const PATCH_HEAD_LINES = 40
const PATCH_LINE_MAX_CHARS = 200
/** Cap on the worker's closing note inside the evidence block. */
export const NOTE_MAX_CHARS = 300

export interface WorkerEvidenceInput {
  readonly passed: boolean
  readonly testPassed: boolean
  readonly typecheckPassed: boolean
  /** Combined stdout+stderr of the verify/test command (already backend-capped). */
  readonly testOutput: string
  readonly typecheckOutput: string
  readonly patch: string
  /** The worker's own closing commentary, when the backend surfaces one. */
  readonly reviewerNotes?: string
}

/**
 * Compose the settle evidence block. Section order is priority order under the
 * hard cap: the verify tail (what failed) survives before the diff head (what
 * was tried) and the worker note — a truncated diff is recoverable from the
 * persisted patch file, a truncated failing assertion is not recoverable at all.
 */
export function composeWorkerEvidence(input: WorkerEvidenceInput): string {
  const sections: string[] = []
  const failures = [
    ...(input.testPassed ? [] : ['tests failed']),
    ...(input.typecheckPassed ? [] : ['typecheck failed']),
  ]
  sections.push(
    input.passed ? 'verify PASSED' : `verify FAILED (${failures.join(', ') || 'gate not passed'})`,
  )
  const testTail = input.testOutput.trim().slice(-VERIFY_TAIL_CHARS)
  if (testTail) sections.push(`--- verify output (tail) ---\n${testTail}`)
  if (!input.typecheckPassed) {
    const typecheckTail = input.typecheckOutput.trim().slice(-TYPECHECK_TAIL_CHARS)
    if (typecheckTail) sections.push(`--- typecheck output (tail) ---\n${typecheckTail}`)
  }
  sections.push(diffSummary(input.patch))
  const note = input.reviewerNotes?.trim()
  if (note) sections.push(`--- worker note ---\n${note.slice(0, NOTE_MAX_CHARS)}`)
  return sections.join('\n').slice(0, EVIDENCE_MAX_CHARS)
}

/**
 * What a settled worker exposes as its output artifact (the blob the brain's
 * `observe_agent` reads). A passing worker's output is its patch — the
 * deliverable. A failing worker's output is its evidence block. A passing
 * worker with NO edits — the post-delivery read-only reviewer: the workspace
 * already holds a delivered fix, so the gate stays green under an empty diff —
 * would otherwise settle with an EMPTY output and its review would be lost, so
 * it exposes its evidence block instead (the worker note carries the review).
 */
export function settledWorkerOut(input: {
  readonly passed: boolean
  readonly patch: string
  readonly evidence: string
}): string {
  if (input.evidence.length === 0) return input.patch
  if (!input.passed) return input.evidence
  return input.patch.trim().length > 0 ? input.patch : input.evidence
}

/**
 * The worker's closing commentary off a local harness run: the TAIL of its
 * stdout (falling back to stderr), bounded to the note cap so a reviewer's
 * final verdict line — written last — survives into the evidence block
 * (`composeWorkerEvidence` keeps the note's FIRST `NOTE_MAX_CHARS` chars).
 */
export function closingWorkerNote(stdout: string, stderr: string): string | undefined {
  const source = stdout.trim() || stderr.trim()
  if (!source) return undefined
  return source.slice(-NOTE_MAX_CHARS)
}

function diffSummary(patch: string): string {
  const trimmed = patch.trim()
  if (!trimmed) return '--- diff: EMPTY (the worker produced no edits) ---'
  const lines = trimmed.split('\n')
  const filesChanged = lines.filter((line) => line.startsWith('diff --git ')).length
  const head = lines
    .slice(0, PATCH_HEAD_LINES)
    .map((line) =>
      line.length > PATCH_LINE_MAX_CHARS ? `${line.slice(0, PATCH_LINE_MAX_CHARS)}~` : line,
    )
  const omitted = lines.length - head.length
  const header = `--- diff: ${filesChanged} file(s) changed, ${Buffer.byteLength(patch)} bytes; first ${head.length} line(s) ---`
  return `${header}\n${head.join('\n')}${omitted > 0 ? `\n... (${omitted} more patch lines; full patch persisted per worker)` : ''}`
}
