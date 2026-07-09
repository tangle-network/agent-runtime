/**
 *
 * `improvementDriver` — the ONE reflective/agentic improvement proposer for
 * agent-eval's improvement loop. It implements `SurfaceProposer` and owns
 * the candidate lifecycle (worktree create → generate → finalize/discard,
 * × populationSize); it delegates the only thing that genuinely varies — HOW
 * a candidate change is produced — to a pluggable `CandidateGenerator`.
 *
 * There is no separate "analyst driver" vs "autoresearch driver": those are
 * the SAME driver at two settings of a dial.
 *   - cheap reflective path  → `reflectiveGenerator` (shots=1, no sandbox;
 *                              applies pre-drafted patches)
 *   - full agentic path      → `agenticGenerator` (shots=N, multi-shot
 *                              verify-in-session loop; an agent reads code +
 *                              report, edits, and re-tries on verifier failure)
 * Both emit changes into a worktree the driver finalizes into a
 * `CodeSurface{ worktreeRef }` the loop measures on the holdout. See
 * agent-eval's `docs/design/self-improvement-engine.md`.
 *
 * @experimental
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type {
  CodeSurface,
  LabeledScenarioStore,
  ProposeContext,
  SurfaceProposer,
  WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'

/** The byte-producing seam — the ONE thing that differs between the cheap
 *  reflective path and the full agentic path. A generator makes (uncommitted)
 *  changes inside `worktreePath`; the driver commits them via the worktree
 *  adapter's `finalize`. */
export interface CandidateGenerator {
  kind: string
  /** Whether this generator can produce a candidate from an EMPTY findings set
   *  and no phase-2 report — i.e. it draws its change signal from the repo and
   *  the raw-trace filesystem context on disk, not only from pre-summarized
   *  findings. An agentic coder (`agenticGenerator`) sets this: the seed repo +
   *  raw traces ARE the signal, so it must still run the full `populationSize`
   *  when the distiller yielded nothing (this is the meta-harness contract — the
   *  agent diagnoses from the raw traces itself). A patch-applier
   *  (`reflectiveGenerator`) leaves it unset — with no findings there is no
   *  patch to draft, so the driver short-circuits rather than spin up worktrees
   *  for a guaranteed no-op. Default `false`. */
  proposesWithoutFindings?: boolean
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

/** The one reflective/agentic improvement proposer (`SurfaceProposer`): owns the candidate worktree lifecycle and delegates HOW a change is produced to a pluggable `CandidateGenerator`. */
export function improvementDriver(opts: ImprovementDriverOptions): SurfaceProposer<AnalystFinding> {
  const baseRef = opts.baseRef ?? 'main'

  return {
    kind: `improvement:${opts.generator.kind}`,
    async propose(ctx: ProposeContext<AnalystFinding>) {
      const findings = resolveFindings(ctx)
      // No findings AND no report AND a generator that can only act on findings
      // (the reflective patch-applier) — propose nothing rather than spin up
      // worktrees for a guaranteed no-op. An agentic coder draws its signal from
      // the repo + raw traces on disk, so it opts in via `proposesWithoutFindings`
      // and still runs the full populationSize even on an empty findings set —
      // otherwise the FIRST generation (whose seed findings are empty and whose
      // rawTraceDistiller has not run yet) would always generate ZERO candidates.
      if (
        findings.length === 0 &&
        ctx.report === undefined &&
        !opts.generator.proposesWithoutFindings
      ) {
        return []
      }

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
