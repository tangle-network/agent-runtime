/**
 * @experimental
 *
 * `analystDriver` — the REFLECTIVE improvement driver. Wraps the surface
 * improvement adapter (`proposeFromFindings`) and implements agent-eval's
 * `ImprovementDriver` contract, so the reflective analyst and the evolutionary
 * mutator are two drivers of the SAME improvement loop (see agent-eval's
 * `docs/design/loop-taxonomy.md` + `self-improvement-engine.md`), not two
 * parallel loops.
 *
 * `propose()` consumes the Phase-2 research report (analyst findings + diff),
 * drafts surface edits, and applies them as ONE coherent improvement into a
 * single worktree (PR-like) via the VCS-pluggable worktree adapter, returning
 * a `CodeSurface{ worktreeRef }` the improvement loop measures on the holdout.
 *
 * This is the cheap reflective path (the analyst already drafted the patches).
 * The heavyweight `autoresearchDriver` — whose `propose()` runs a full sandbox
 * runLoop to generate the change — is a separate driver; both conform to the
 * same contract.
 */

import { spawnSync } from 'node:child_process'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { ImprovementDriver, WorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import type { SurfaceImprovementEdit } from '../agent/improvement-adapter'
import type { ImprovementAdapter } from './types'

export interface AnalystDriverOptions {
  /** The surface improvement adapter (drafts patches from findings). */
  improvementAdapter: ImprovementAdapter<SurfaceImprovementEdit>
  /** VCS worktree adapter — one worktree per proposed improvement. */
  worktree: WorktreeAdapter
  /** Base ref the candidate worktree forks from. Default `main`. */
  baseRef?: string
  /** Override how findings are pulled from the ProposeContext. By default the
   *  Phase-2 report's `findings` are used when present, else `ctx.findings`. */
  extractFindings?: (report: unknown, fallback: AnalystFinding[]) => AnalystFinding[]
}

export function analystDriver(opts: AnalystDriverOptions): ImprovementDriver<AnalystFinding> {
  const baseRef = opts.baseRef ?? 'main'
  const extract = opts.extractFindings ?? defaultExtractFindings

  return {
    kind: 'analyst:surface-improvement',
    async propose(ctx) {
      const findings = extract(ctx.report, ctx.findings)
      if (findings.length === 0) return []

      const batch = await opts.improvementAdapter.proposeFromFindings(findings)
      if (batch.edits.length === 0) return []

      // ONE coherent improvement = ONE worktree (PR-like). Apply every drafted
      // patch into the worktree, then finalize into a single CodeSurface.
      const label =
        batch.edits.length === 1 ? batch.edits[0]!.summary : 'analyst surface improvement'
      const wt = await opts.worktree.create({ baseRef, label })

      const appliedPaths: string[] = []
      for (const edit of batch.edits) {
        if (applyPatch(edit.patch, wt.path)) appliedPaths.push(edit.target.repoRelativePath)
      }

      // Nothing applied cleanly — discard the empty worktree, propose nothing.
      if (appliedPaths.length === 0) {
        await opts.worktree.discard(wt)
        return []
      }

      const summary =
        batch.edits.length === 1
          ? batch.edits[0]!.summary
          : `analyst: ${appliedPaths.length} surface edit${appliedPaths.length === 1 ? '' : 's'}`
      const surface = await opts.worktree.finalize(wt, summary)
      return [surface]
    },
  }
}

/** Phase-2 report carries `findings` when present; otherwise fall back to the
 *  loop's `ctx.findings`. The report is opaque to the substrate, so we probe
 *  it structurally here. */
function defaultExtractFindings(report: unknown, fallback: AnalystFinding[]): AnalystFinding[] {
  if (report && typeof report === 'object' && 'findings' in report) {
    const f = (report as { findings: unknown }).findings
    if (Array.isArray(f) && f.length > 0) return f as AnalystFinding[]
  }
  return fallback
}

/** Mirror the improvement adapter's proven apply invocation, run inside the
 *  candidate worktree (a fresh checkout of `baseRef`, so `-p0` paths match). */
function applyPatch(patch: string, cwd: string): boolean {
  const result = spawnSync('git', ['apply', '--whitespace=fix', '-p0', '-'], {
    cwd,
    input: patch,
    encoding: 'utf-8',
  })
  return result.status === 0
}
