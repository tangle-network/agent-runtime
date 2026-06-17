/**
 * @experimental
 *
 * `patchDelivered` — the mechanical patch gate as a generic `DeliverableSpec` over the worktree-CLI
 * artifact. It is one construction of a `DeliverableSpec` (a plain `check(artifact) => boolean`
 * function); a domain customizes "is it done" by building its own spec, not by extending this one.
 * The canonical use: a `fanout(createWorktreeCliExecutor)` of authored harness profiles, each
 * `gateOnDeliverable(patchDelivered(...))`.
 *
 * The checks themselves are NOT re-implemented here — `runCoderChecks` (`./patch-checks`) is the
 * single source of the no-op / always-on secret-path floor / forbidden-path / diff-size / test /
 * typecheck logic. This factory only adapts the `WorktreePatchArtifact` shape (its `checks` carry
 * the test/typecheck PASS signals the executor derived in the live worktree) into the check inputs
 * and returns the boolean the gate consumes.
 *
 * Test/typecheck enforcement is OPT-IN per `require`: when a command was not run in the worktree
 * (the executor's `testCmd`/`typecheckCmd` were omitted) the corresponding signal is treated as
 * passed UNLESS `require` lists it — so a gate that demands a tests-pass on an artifact that never
 * ran tests fails closed (the honest outcome) rather than passing on a missing signal.
 */

import type { DeliverableSpec } from './completion-gate'
import { type CoderCheckConstraints, type CoderCheckInput, runCoderChecks } from './patch-checks'
import type { WorktreePatchArtifact } from './worktree-cli-executor'

/** @experimental */
export interface PatchDeliverableOptions extends CoderCheckConstraints {
  /**
   * Which verification signals the gate REQUIRES to be present-and-passing. A required signal
   * that the artifact never derived (the command was not configured on the executor) fails the
   * gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
   * that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.
   */
  require?: ReadonlyArray<'tests' | 'typecheck'>
}

/**
 * Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
 * gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
 * whether the patch is DELIVERED (the `valid` conjunction).
 *
 * @experimental
 */
export function patchDelivered(
  options: PatchDeliverableOptions = {},
): DeliverableSpec<WorktreePatchArtifact> {
  const require = new Set(options.require ?? [])
  const constraints: CoderCheckConstraints = {
    ...(options.maxDiffLines !== undefined ? { maxDiffLines: options.maxDiffLines } : {}),
    ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
  }
  return {
    describe: 'patch: no-op/secret/forbidden/diff-size + required test/typecheck pass',
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
