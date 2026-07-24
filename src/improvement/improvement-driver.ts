/**
 * Code-only candidate driver for Runtime-owned git worktrees.
 *
 * A `CandidateGenerator` edits an isolated checkout. This driver finalizes each
 * accepted edit as a `CodeSurface` and disposes rejected worktrees.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import type { AnalystFinding, CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  type CodeSurface,
  type LabeledScenarioStore,
  type ProposeContext,
  type ProposedCandidate,
  type SurfaceProposer,
  verifyCodeSurface,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import { rethrowAfterCleanup } from './cleanup'
import { toAnalystFindings } from './findings'

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
    /** The candidate worktree — a clean checkout of the current incumbent. */
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
    /** Generation coordinates supplied by Runtime's internal code candidate driver. */
    generation?: number
    candidateIndex?: number
    /** Shared run-wide paid-call account supplied by agent-eval 0.117+. */
    costLedger?: CostLedgerHandle
    /** Receipt attribution phase supplied alongside `costLedger`. */
    costPhase?: string
  }): Promise<{
    applied: boolean
    summary: string
    /** Short slug for the candidate. When present (with `rationale`), the
     *  driver returns a `ProposedCandidate` wrapper so the label survives to
     *  `GenerationRecord` and the emitted provenance. */
    label?: string
    /** Why this change was proposed — bounded, derived from the findings the
     *  shot addressed. Paired with `label`. */
    rationale?: string
  }>
}

export interface ImprovementDriverOptions {
  worktree: WorktreeAdapter
  generator: CandidateGenerator
  /** Root ref for first-generation/direct callers. Default `main`.
   *  Later code generations retain the incumbent's original root. */
  baseRef?: string
}

export interface ManagedImprovementDriver extends SurfaceProposer<AnalystFinding> {
  /** Remove every owned candidate except explicitly retained finalized winners. */
  cleanup(retainWorktreeRefs?: readonly string[]): Promise<void>
}

/** Build the code-only proposer used internally by `improve({ surface: 'code' })`. */
export function improvementDriver(opts: ImprovementDriverOptions): ManagedImprovementDriver {
  const baseRef = opts.baseRef ?? 'main'
  const owned = new Map<string, Worktree>()

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

      const surfaces: Array<CodeSurface | ProposedCandidate> = []
      const incumbent = verifiedCodeIncumbent(ctx.currentSurface)
      const proposalBaseRef = incumbent?.baseCommit ?? baseRef
      for (let i = 0; i < ctx.populationSize; i++) {
        if (ctx.signal.aborted) break
        const wt = await opts.worktree.create({
          baseRef: proposalBaseRef,
          label: `${opts.generator.kind}-gen${ctx.generation}-cand${i}`,
        })
        owned.set(wt.path, wt)
        // Once a worktree exists it MUST be accounted for: finalized into a
        // surface, or discarded. A throw from generate()/finalize() must not
        // leak the worktree + branch — discard best-effort, then rethrow loud.
        try {
          if (incumbent) advanceToIncumbent(wt, incumbent)
          const { applied, summary, label, rationale } = await opts.generator.generate({
            worktreePath: wt.path,
            report: ctx.report,
            findings,
            dataset: ctx.dataset,
            maxShots: ctx.maxImprovementShots ?? 1,
            signal: ctx.signal,
            generation: ctx.generation,
            candidateIndex: i,
            ...(ctx.costLedger ? { costLedger: ctx.costLedger } : {}),
            ...(ctx.costPhase ? { costPhase: ctx.costPhase } : {}),
          })
          if (!applied) {
            await opts.worktree.discard(wt)
            owned.delete(wt.path)
            continue
          }
          const surface = await opts.worktree.finalize(wt, summary)
          // A generator that attributes its change gets a `ProposedCandidate`
          // wrapper — the loop normalizes both forms and threads {label,
          // rationale} into `GenerationRecord` + the provenance record. A bare
          // surface stays bare (blind generators remain unattributed).
          surfaces.push(
            label || rationale
              ? { surface, label: label ?? '', rationale: rationale ?? '' }
              : surface,
          )
          owned.delete(wt.path)
          owned.set(surface.worktreeRef, wt)
        } catch (err) {
          const failure = err instanceof Error ? err.message : String(err)
          return rethrowAfterCleanup(
            err,
            async () => {
              await opts.worktree.discard(wt)
              owned.delete(wt.path)
            },
            `improvementDriver: ${failure}`,
          )
        }
      }
      return surfaces
    },
    async cleanup(retainWorktreeRefs = []) {
      const retained = new Set(retainWorktreeRefs)
      const errors: unknown[] = []
      for (const [worktreeRef, worktree] of owned) {
        if (retained.has(worktreeRef)) continue
        try {
          await opts.worktree.discard(worktree)
          owned.delete(worktreeRef)
        } catch (cause) {
          errors.push(cause)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'improvementDriver: failed to discard candidate worktrees')
      }
    },
  }
}

/** A code incumbent must still match the immutable identity that was measured. */
function verifiedCodeIncumbent(surface: ProposeContext['currentSurface']): CodeSurface | undefined {
  if (typeof surface !== 'object' || surface.kind !== 'code') return undefined
  verifyCodeSurface(surface)
  return surface
}

/** Start at the root commit recorded by the incumbent, then fast-forward the
 *  fresh branch to the incumbent commit. The worktree stays clean for the
 *  generator while `finalize()` still emits one cumulative root-to-candidate
 *  patch that can be applied or rolled back independently of prior branches. */
function advanceToIncumbent(worktree: Worktree, incumbent: CodeSurface): void {
  if (worktree.baseCommit !== incumbent.baseCommit || worktree.baseTree !== incumbent.baseTree) {
    throw new Error('improvementDriver: candidate worktree does not match incumbent base identity')
  }
  if (worktree.baseCommit === incumbent.candidateCommit) return

  const merge = spawnSync('git', ['merge', '--ff-only', incumbent.candidateCommit], {
    cwd: worktree.path,
    encoding: 'utf8',
  })
  if (merge.error) {
    throw new Error(
      `improvementDriver: failed to start candidate from incumbent: ${merge.error.message}`,
    )
  }
  if (merge.status !== 0) {
    throw new Error(
      `improvementDriver: could not fast-forward candidate to incumbent ${incumbent.candidateCommit}: ${merge.stderr.trim()}`,
    )
  }

  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: worktree.path,
    encoding: 'utf8',
  })
  if (head.error || head.status !== 0 || head.stdout.trim() !== incumbent.candidateCommit) {
    throw new Error('improvementDriver: candidate worktree did not reach the incumbent commit')
  }
}

/** Phase-2 report carries `findings` when present; else fall back to the
 *  loop's `ctx.findings`. The report is opaque to the substrate, so probe it
 *  structurally. Both paths run through `toAnalystFindings` — the wire is
 *  `unknown[]` at runtime regardless of the generic (static seeds, legacy
 *  digests), and a bare cast here fed `undefined` claims into build prompts. */
function resolveFindings(ctx: ProposeContext<AnalystFinding>): AnalystFinding[] {
  const report = ctx.report
  if (report && typeof report === 'object' && 'findings' in report) {
    const f = (report as { findings: unknown }).findings
    if (Array.isArray(f) && f.length > 0) {
      const lifted = toAnalystFindings(f, { analystId: 'report-findings', area: 'report' })
      if (lifted.length > 0) return lifted
    }
  }
  return toAnalystFindings(ctx.findings ?? [], { analystId: 'loop-context', area: 'seed' })
}
