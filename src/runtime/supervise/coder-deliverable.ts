/**
 * @experimental
 *
 * `coderDeliverable` — the mechanical coder gate, re-homed as a generic `DeliverableSpec` over
 * the worktree-CLI artifact. It is the ONE place the coder-domain checks reach the generic
 * `gateOnDeliverable` path: a `fanout(createWorktreeCliExecutor)` of authored harness profiles,
 * each `gateOnDeliverable(coderDeliverable(...))`, winner via `defaultSelectWinner`.
 *
 * The checks themselves are NOT re-implemented here — `runCoderChecks` (`../../profiles/coder`)
 * is the single source of the no-op / always-on secret-path floor / forbidden-path / diff-size /
 * test / typecheck logic, shared with `createCoderValidator`. This factory only adapts the
 * `WorktreePatchArtifact` shape (its `checks` carry the test/typecheck PASS signals the executor
 * derived in the live worktree) into the check inputs and returns the boolean the gate consumes.
 *
 * Test/typecheck enforcement is OPT-IN per `require`: when a command was not run in the worktree
 * (the executor's `testCmd`/`typecheckCmd` were omitted) the corresponding signal is treated as
 * passed UNLESS `require` lists it — so a gate that demands a tests-pass on an artifact that never
 * ran tests fails closed (the honest outcome) rather than passing on a missing signal.
 */

import {
  type CoderCheckConstraints,
  type CoderCheckInput,
  runCoderChecks,
} from '../../profiles/coder'
import type { DeliverableSpec } from './completion-gate'
import type { WorktreePatchArtifact } from './worktree-cli-executor'

/** @experimental */
export interface CoderDeliverableOptions extends CoderCheckConstraints {
  /**
   * Which verification signals the gate REQUIRES to be present-and-passing. A required signal
   * that the artifact never derived (the command was not configured on the executor) fails the
   * gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
   * that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.
   */
  require?: ReadonlyArray<'tests' | 'typecheck'>
}

/**
 * Build the coder `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared
 * mechanical gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals
 * and returns whether the patch is DELIVERED (the `valid` conjunction).
 *
 * @experimental
 */
export function coderDeliverable(
  options: CoderDeliverableOptions = {},
): DeliverableSpec<WorktreePatchArtifact> {
  const require = new Set(options.require ?? [])
  const constraints: CoderCheckConstraints = {
    ...(options.maxDiffLines !== undefined ? { maxDiffLines: options.maxDiffLines } : {}),
    ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
  }
  return {
    describe: 'coder patch: no-op/secret/forbidden/diff-size + required test/typecheck pass',
    check(artifact) {
      const input: CoderCheckInput = {
        patch: artifact.patch,
        testsPassed: signalPass(artifact.checks?.tests?.passed, require.has('tests')),
        typecheckPassed: signalPass(artifact.checks?.typecheck?.passed, require.has('typecheck')),
      }
      return runCoderChecks(input, constraints).valid === true
    },
  }
}

/**
 * Resolve a derived PASS signal into the boolean the gate folds in:
 *   - signal present  → its value (true/false).
 *   - signal absent + required → false (fail closed: the gate demanded a signal that was never run).
 *   - signal absent + not required → true (the executor simply didn't run that command).
 */
function signalPass(value: boolean | undefined, required: boolean): boolean {
  if (value !== undefined) return value
  return !required
}
