/**
 *
 * `reflectiveGenerator` — the cheap, no-sandbox `CandidateGenerator`. It drafts
 * surface edits via the existing improvement adapter (`proposeFromFindings`,
 * one LLM patch per finding) and applies them as ONE coherent improvement into
 * the candidate worktree. `maxShots` is ignored — reflection is single-shot by
 * construction (the patches are already drafted).
 *
 * This is the `shots=1, sandbox=off` setting of the one improvement driver.
 * The `agenticGenerator` (a multi-shot verify-in-session loop) is the
 * `shots=N` setting — both plug into the same `improvementDriver`.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import type { SurfaceImprovementEdit } from '../agent/improvement-adapter'
import type { ImprovementAdapter } from '../analyst-loop/types'
import type { CandidateGenerator } from './improvement-driver'

export interface ReflectiveGeneratorOptions {
  improvementAdapter: ImprovementAdapter<SurfaceImprovementEdit>
}

/** Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. */
export function reflectiveGenerator(opts: ReflectiveGeneratorOptions): CandidateGenerator {
  return {
    kind: 'reflective',
    async generate({ worktreePath, findings }) {
      const batch = await opts.improvementAdapter.proposeFromFindings(findings)
      if (batch.edits.length === 0) return { applied: false, summary: '' }

      let applied = 0
      for (const edit of batch.edits) {
        if (applyPatch(edit.patch, worktreePath)) applied++
      }
      if (applied === 0) return { applied: false, summary: '' }

      const summary =
        batch.edits.length === 1
          ? batch.edits[0]!.summary
          : `analyst: ${applied} surface edit${applied === 1 ? '' : 's'}`
      return { applied: true, summary }
    },
  }
}

/** Mirror the improvement adapter's proven apply invocation, run inside the
 *  candidate worktree (a fresh checkout of baseRef, so `-p0` paths match). */
function applyPatch(patch: string, cwd: string): boolean {
  const result = spawnSync('git', ['apply', '--whitespace=fix', '-p0', '-'], {
    cwd,
    input: patch,
    encoding: 'utf-8',
  })
  return result.status === 0
}
