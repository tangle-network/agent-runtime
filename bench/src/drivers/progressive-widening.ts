/**
 * @experimental
 *
 * Coded progressive-widening driver — the CONTROL variant of the recursive execution
 * atom's two driver-act bodies (the LLM meta-driver in `./llm-meta-driver.ts` is the
 * treatment). Both share the `WidenGate` below.
 *
 * The policy (MCTS progressive widening, the governor that keeps "full generality" from
 * becoming "boil the ocean"): seed a NARROW frontier (one child per seed), then react to
 * each `scope.next()` completion. A node widens — spawns ONE more child toward the same
 * promising lineage under the conserved pool — only when the `WidenGate` says so. No
 * eager fan-out: the frontier grows by at most one per settlement, bounded by the
 * conserved budget reservation (`scope.spawn` fails closed when the pool can't cover it).
 *
 * Two firewall invariants this driver upholds by construction (critique R2):
 *  - `WidenGate` DEFAULTS TO FLAT: `defaultWidenGate.shouldWiden` returns false for every
 *    settlement, so a gate run never widens and the selector≠judge conflict stays dormant.
 *  - When widening IS enabled, `promising` is derived from TRACE findings (the `analyze`
 *    hook → `AnalystFinding[]`), NEVER from a raw `verdict.score`. Reading the judge
 *    verdict for a spawn decision requires the gate's explicit `judgeExempt: true` (off by
 *    default) — the documented escape hatch that re-couples steering to the judge.
 *
 * Selection stays single-sourced: settled children adapt to `Iteration` via
 * `settledToIteration` and `defaultSelectWinner` picks the winner — the driver never
 * forks the kernel's argmax (selector ≠ judge).
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import { defaultSelectWinner } from '../../../src/loops/run-loop.ts'
import { settledToIteration } from '../../../src/loops/supervise/scope.ts'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  Scope,
  Settled,
  WidenGate,
} from '../../../src/loops/supervise/types.ts'

/** A child the driver can spawn: a leaf `Agent` plus the `AgentSpec` the open registry
 *  resolves its `LeafExecutor` from (`harness: null` → router/inline; `BackendType` →
 *  sandbox; or a BYO `executor`). The spec rides on the agent as `executorSpec` because
 *  that is the field `scope.spawn` reads to resolve a runtime — fail loud if it is absent. */
export interface ChildAgent<Out> {
  readonly agent: Agent<unknown, Out>
  readonly task: unknown
  readonly label: string
}

/** A seed of the narrow initial frontier: the child to spawn and its per-child budget. */
export interface WideningSeed<Out> {
  readonly child: ChildAgent<Out>
  readonly budget: Budget
}

/**
 * Trace-analyst hook: read a settled child's TRACE (rehydrated `out` + lineage) into
 * `AnalystFinding[]`. This is the analyst→driver wire (mirrors `PlannerContext.analyses`)
 * and the ONLY signal `promising` may read when the gate is flat-with-findings. The hook
 * MUST return trace-derived findings; the gate never inspects `settled.verdict` unless it
 * is explicitly `judgeExempt`.
 */
export type AnalyzeSettled<Out> = (
  settled: Extract<Settled<Out>, { kind: 'done' }>,
) => Promise<ReadonlyArray<AnalystFinding>>

export interface ProgressiveWideningOptions<Out> {
  readonly name?: string
  /** The narrow initial frontier — one child per seed, no eager fan-out. */
  readonly seed: (task: unknown) => ReadonlyArray<WideningSeed<Out>>
  /** Build the next child to widen toward a promising lineage. Returns `null` to stop
   *  widening this lineage (e.g. the lineage has converged). */
  readonly widen: (
    settled: Extract<Settled<Out>, { kind: 'done' }>,
    findings: ReadonlyArray<AnalystFinding>,
  ) => WideningSeed<Out> | null
  /** Trace-analyst wire feeding `promising`. Omit to run flat (no findings → never
   *  widens under the default gate). */
  readonly analyze?: AnalyzeSettled<Out>
  /** The widening governor. Defaults to `defaultWidenGate` (flat — never widens). */
  readonly gate?: WidenGate<Out>
}

/**
 * Build the coded progressive-widening `Agent`. Its `act` body is the control policy:
 * seed narrow → react to each `next()` → widen toward a promising lineage under budget →
 * synthesize the winner with the single-sourced selector. `WidenGate` defaults flat, so
 * with no `gate`/`analyze` supplied this is exactly the "spawn the seeds, pick the best"
 * flat harness.
 */
export function createProgressiveWideningDriver<Out>(
  opts: ProgressiveWideningOptions<Out>,
): Agent<unknown, Out> {
  const gate = opts.gate ?? defaultWidenGate<Out>()
  const analyze = opts.analyze

  return {
    name: opts.name ?? 'progressive-widening',
    async act(task: unknown, scope: Scope<Out>): Promise<Out> {
      // Seed the NARROW frontier: one child per seed, reserved atomically from the pool.
      // A seed that fails admission (pool can't cover it) is dropped — fail closed, never
      // overcommit; the conserved Σk holds by construction.
      for (const s of opts.seed(task)) {
        scope.spawn(asSpawnable(s.child), s.child.task, { budget: s.budget, label: s.child.label })
      }

      const done: Array<Extract<Settled<Out>, { kind: 'done' }>> = []
      // React to settlements one at a time (ray.wait n=1). `next()` is null only when the
      // live set is empty — every spawned child eventually settles done or down.
      for (let settled = await scope.next(); settled !== null; settled = await scope.next()) {
        if (settled.kind === 'down') continue // infra/bad child: excluded from merge n + equal-k
        done.push(settled)

        // Progressive widening: spawn AT MOST one more child toward this lineage, and only
        // when the gate says promising AND the pool can still cover a widen. The findings
        // are TRACE-derived (`analyze`); the gate reads them, never the raw verdict.
        if (!gate.shouldWiden(settled, scope.budget)) continue
        const findings = analyze ? await analyze(settled) : []
        if (!isPromising(findings, gate, settled)) continue
        const next = opts.widen(settled, findings)
        if (next === null) continue
        scope.spawn(asSpawnable(next.child), next.child.task, {
          budget: next.budget,
          label: next.child.label,
        })
      }

      // Single-sourced selection: adapt the done children to the kernel's Iteration shape
      // and let `defaultSelectWinner` pick (best-valid-score, ties → earliest). The driver
      // does NOT fork the argmax (selector ≠ judge).
      const iterations = done.map((s) => settledToIteration(s))
      const winner = defaultSelectWinner(iterations)
      if (!winner) {
        throw new Error(
          'progressive-widening: no done child to select a winner from (all children were down)',
        )
      }
      return winner.output as Out
    },
  }
}

/**
 * The flat-by-default widening governor (the shared `WidenGate`). `shouldWiden` returns
 * false for EVERY settlement, so a gate run never widens — the firewall conflict (R2)
 * stays dormant by construction. Override it with a findings-driven gate (severity/area
 * thresholds over trace findings) to enable widening; only an explicit `judgeExempt: true`
 * gate may read `verdict.score`.
 */
export function defaultWidenGate<Out>(): WidenGate<Out> {
  return {
    shouldWiden(): boolean {
      return false
    },
  }
}

/**
 * A findings-driven widening gate (opt-in, never the default). Widens toward a lineage
 * whose TRACE findings show a correctable middle band — a high/critical finding that
 * carries a `recommended_action` (the analyst says "this is fixable, do X"). It reads ONLY
 * trace-derived findings, never the verdict, so it composes with the steer firewall. The
 * `minTokensLeft` guard keeps a widen from starving the pool below a usable per-child floor.
 */
export function findingsWidenGate<Out>(opts: { minTokensLeft: number }): WidenGate<Out> {
  return {
    shouldWiden(_settled: Settled<Out>, budget: Scope<Out>['budget']): boolean {
      return budget.tokensLeft >= opts.minTokensLeft
    },
  }
}

/**
 * Is this lineage promising enough to widen? Promise is computed from TRACE findings, not
 * the judge verdict: a `high`/`critical` finding that names a `recommended_action` is a
 * correctable middle band worth one more shot. Empty findings are NOT promising (flat).
 *
 * The ONLY path that reads `verdict.score` is the gate's explicit `judgeExempt: true`
 * escape hatch — it re-couples steering to the judge, so it must be argued per cell and is
 * off by default.
 */
function isPromising<Out>(
  findings: ReadonlyArray<AnalystFinding>,
  gate: WidenGate<Out>,
  settled: Extract<Settled<Out>, { kind: 'done' }>,
): boolean {
  if (gate.judgeExempt === true) return judgeScore(settled.verdict) > 0
  return findings.some(
    (f) =>
      (f.severity === 'high' || f.severity === 'critical') &&
      typeof f.recommended_action === 'string' &&
      f.recommended_action.length > 0,
  )
}

/** Read a verdict's scalar score. Used ONLY behind the explicit `judgeExempt` hatch — the
 *  steering-from-the-judge path the firewall otherwise forbids. */
function judgeScore(verdict: DefaultVerdict | undefined): number {
  if (!verdict) return 0
  const score = (verdict as { score?: unknown }).score
  return typeof score === 'number' ? score : 0
}

/** Attach the child's `AgentSpec` as the `executorSpec` field `scope.spawn` resolves the
 *  runtime from. A `ChildAgent` whose `agent` already carries a matching `executorSpec`
 *  passes through unchanged; otherwise this is a fail-loud no-op (the agent must carry the
 *  spec, since only the agent author knows its profile/harness). */
function asSpawnable<Out>(child: ChildAgent<Out>): Agent<unknown, Out> {
  const carried = (child.agent as { executorSpec?: unknown }).executorSpec
  if (!isAgentSpec(carried)) {
    throw new Error(
      `progressive-widening: child "${child.label}" agent carries no executorSpec (AgentSpec); cannot resolve its LeafExecutor`,
    )
  }
  return child.agent
}

function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'profile' in v && 'harness' in v
}
