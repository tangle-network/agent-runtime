/**
 * The generated-eval interchange contract.
 *
 * This schema — not our code — is the integration surface: authoring agents
 * emit it, the certifier validates it, runners consume it, the leaderboard
 * aggregates it. It extends the bench `SearchTask` (so admitted evals drop
 * straight into the existing search-bench runner) with the two things
 * generation needs: a reproducible environment (`setup`) and an executable
 * reference (`reference`) the certifier can re-run independently.
 *
 * Soundness contract (enforced by certify.ts, never by the authoring model):
 *   - grounding: the reference must execute and pass against the real pinned
 *     target named in `setup`.
 *   - discrimination: a no-tools parametric baseline must FAIL the oracle.
 * An eval without a passed `certification` block is a CANDIDATE, not an eval.
 */
import type { SearchTask } from '../search-bench/tasks'

export const generatedEvalSchemaVersion = 1

export interface EvalReference {
  /** Files written into the certification workspace, path → content. */
  files: Record<string, string>
  /** Command that exercises the reference against the pinned target.
   *  Exit 0 ⇒ grounding gate passes. Run from the workspace root. */
  cmd: string
  /** Optional stdout requirement — every string must appear in the command's
   *  stdout. Guards against a reference that "passes" by doing nothing. */
  stdoutContains?: string[]
}

export interface EvalCertification {
  schemaVersion: number
  /** Reference executed + passed against the pinned target. */
  groundingPassed: boolean
  /** No-tools baseline failed the oracle (the task discriminates). */
  parametricFailed: boolean
  /** Model used for the parametric gate. */
  parametricModel: string
  /** Exact target the reference ran against (e.g. hono@4.6.3). */
  resolvedTarget: string
  certifiedAt: string
  /** Tool that performed certification (name@version). */
  certifier: string
}

export interface GeneratedEval extends SearchTask {
  schemaVersion: number
  /** Shell commands that provision a CLEAN workspace with the pinned target
   *  (e.g. ["npm init -y", "npm i hono@4.6.3"]). Re-run by the certifier from
   *  scratch — the authoring agent's own workspace is never trusted. */
  setup: string[]
  reference: EvalReference
  /** Present + both-gates-true ⇔ admitted. */
  certification?: EvalCertification
}

/** Parse + structurally validate a candidate emitted by an authoring agent.
 *  Fail-loud: a malformed candidate is a generation failure, not a skip. */
export function parseCandidate(raw: string): GeneratedEval {
  const v = JSON.parse(raw) as Partial<GeneratedEval>
  const problems: string[] = []
  if (v.schemaVersion !== generatedEvalSchemaVersion)
    problems.push(`schemaVersion must be ${generatedEvalSchemaVersion}`)
  if (!v.id || !/^[a-z0-9][a-z0-9-]*$/.test(v.id)) problems.push('id must be kebab-case')
  if (!v.domain) problems.push('missing domain')
  if (!v.prompt || v.prompt.length < 40) problems.push('prompt missing or too short')
  if (!v.needsFreshDocs) problems.push('missing needsFreshDocs')
  const o = v.oracle
  if (!o || !(o.containsAll?.length || o.containsAny?.length || o.regex?.length))
    problems.push('oracle needs containsAll, containsAny, or regex')
  if (!v.setup?.length) problems.push('setup must pin the target')
  if (!v.reference?.cmd || !v.reference.files || Object.keys(v.reference.files).length === 0)
    problems.push('reference needs files + cmd')
  if (!v.sourceUrl) problems.push('missing sourceUrl (primary-doc provenance)')
  if (problems.length) throw new Error(`invalid candidate: ${problems.join('; ')}`)
  return v as GeneratedEval
}
