/**
 * @experimental
 *
 * `improvementDriver` — the ONE reflective/agentic improvement driver for
 * agent-eval's improvement loop. It implements `ImprovementDriver` and owns
 * the candidate lifecycle (worktree create → generate → finalize/discard,
 * × populationSize); it delegates the only thing that genuinely varies — HOW
 * a candidate change is produced — to a pluggable `CandidateGenerator`.
 *
 * There is no separate "analyst driver" vs "autoresearch driver": those are
 * the SAME driver at two settings of a dial.
 *   - cheap reflective path  → `reflectiveGenerator` (shots=1, no sandbox;
 *                              applies pre-drafted patches)
 *   - full agentic path      → `agenticGenerator` (shots=N, sandbox runLoop;
 *                              an agent reads code + report and edits)
 * Both emit changes into a worktree the driver finalizes into a
 * `CodeSurface{ worktreeRef }` the loop measures on the holdout. See
 * agent-eval's `docs/design/self-improvement-engine.md`.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type {
  CodeSurface,
  ImprovementDriver,
  LabeledScenarioStore,
  ProposeContext,
  WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'

/** The byte-producing seam — the ONE thing that differs between the cheap
 *  reflective path and the full agentic path. A generator makes (uncommitted)
 *  changes inside `worktreePath`; the driver commits them via the worktree
 *  adapter's `finalize`. */
export interface CandidateGenerator {
  kind: string
  generate(args: {
    /** The candidate worktree — a fresh checkout of baseRef. Write changes here. */
    worktreePath: string
    /** Phase-2 research report (analyst findings + diff), opaque. */
    report: unknown
    /** Findings resolved from the report or the loop context. */
    findings: AnalystFinding[]
    /** Handle to all captured data, to ground the change. */
    dataset?: LabeledScenarioStore
    /** DEPTH: max iterations the generator may take (agentic uses this; the
     *  reflective generator ignores it). */
    maxShots: number
    signal: AbortSignal
  }): Promise<{ applied: boolean; summary: string }>
}

export interface ImprovementDriverOptions {
  worktree: WorktreeAdapter
  generator: CandidateGenerator
  /** Base ref candidate worktrees fork from. Default `main`. */
  baseRef?: string
}

export function improvementDriver(
  opts: ImprovementDriverOptions,
): ImprovementDriver<AnalystFinding> {
  const baseRef = opts.baseRef ?? 'main'

  return {
    kind: `improvement:${opts.generator.kind}`,
    async propose(ctx) {
      const findings = resolveFindings(ctx)
      // No signal to act on — propose nothing rather than spin up worktrees.
      if (findings.length === 0 && ctx.report === undefined) return []

      const surfaces: CodeSurface[] = []
      for (let i = 0; i < ctx.populationSize; i++) {
        if (ctx.signal.aborted) break
        const wt = await opts.worktree.create({
          baseRef,
          label: `${opts.generator.kind}-gen${ctx.generation}-cand${i}`,
        })
        // Once a worktree exists it MUST be accounted for: finalized into a
        // surface, or discarded. A throw from generate()/finalize() must not
        // leak the worktree + branch — discard best-effort, then rethrow loud.
        try {
          const { applied, summary } = await opts.generator.generate({
            worktreePath: wt.path,
            report: ctx.report,
            findings,
            dataset: ctx.dataset,
            maxShots: ctx.maxImprovementShots ?? 1,
            signal: ctx.signal,
          })
          if (!applied) {
            await opts.worktree.discard(wt)
            continue
          }
          surfaces.push(await opts.worktree.finalize(wt, summary))
        } catch (err) {
          // Best-effort cleanup; never mask the original failure.
          await opts.worktree.discard(wt).catch(() => {})
          throw err
        }
      }
      return surfaces
    },
  }
}

/** Phase-2 report carries `findings` when present; else fall back to the
 *  loop's `ctx.findings`. The report is opaque to the substrate, so probe it
 *  structurally. */
function resolveFindings(ctx: ProposeContext<AnalystFinding>): AnalystFinding[] {
  const report = ctx.report
  if (report && typeof report === 'object' && 'findings' in report) {
    const f = (report as { findings: unknown }).findings
    if (Array.isArray(f) && f.length > 0) return f as AnalystFinding[]
  }
  return ctx.findings
}
