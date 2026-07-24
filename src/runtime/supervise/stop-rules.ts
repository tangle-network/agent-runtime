/**
 *
 * PROGRESS-BASED STOP RULES — end a long-horizon run for the right reason.
 *
 * Every existing bound is a CEILING: iterations, tokens, dollars, an absolute deadline, a turn
 * cap. A ceiling answers "may this run continue?" and never "is this run still getting anywhere?".
 * So a supervision tree that stopped learning at settle 4 keeps buying workers until it hits a
 * wall — the run ends on exhaustion, and the operator cannot tell a run that finished from a run
 * that ran out.
 *
 * A stop rule reads the run's own PROGRESS and decides. Three signals feed it:
 *   - the objective curve over settled work (best-so-far, from `anytime.ts` — see below),
 *   - the LIVE worker feed (`WorkerProgress`: `idleMs`, `stalled`, `turns`, `tokens`),
 *   - tree-level shape (how many are in flight, how many are waiting, when the last settle landed).
 *
 * ── Two boundaries this module holds deliberately ───────────────────────────────────────────────
 *
 * ENFORCEMENT lives here; THRESHOLDS do not. "Stop after 5 settles with no improvement" is a
 * judgment about a domain — how noisy its scores are, how expensive a worker is, how much a late
 * breakthrough is worth. That belongs to the caller (a loop, a bench, a product). Every rule below
 * takes its thresholds as required options with no hidden defaults for the numbers that decide;
 * the module ships the MECHANISM and refuses to ship the judgment.
 *
 * A stop rule can only ADD a stop, never remove one. The driver evaluates the hard ceilings
 * (`poolStarved`, `deadlinePassed`, abort, the driver's own stop) FIRST and independently; the
 * rule is consulted only when they all say "continue". So no rule can talk a run past its budget.
 *
 * ── What is reused, not re-derived ──────────────────────────────────────────────────────────────
 *
 * `anytime.ts` already computed best-so-far curves, their area, and plateau detection — but only
 * after a run was over, from waterfall spans. Rather than write a second copy for the live path,
 * `bestSoFar` / `areaUnderCurve` / `plateauLength` were extracted there and are imported here. A
 * stop rule that calls a run plateaued therefore agrees, number for number, with the report that
 * later judges whether stopping was right.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import { areaUnderCurve, bestSoFar, plateauLength } from '../anytime'
import type { WorkerProgress } from './progress'
import type { Scope, Settled } from './types'

/** One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own
 *  quality signal (a verdict score, a test pass-rate, a judge rating); `undefined` = this
 *  settlement produced no measurable objective (it failed, or nothing scored it). */
export interface ProgressSample {
  readonly id: string
  /** Epoch ms the settlement was observed. */
  readonly at: number
  readonly objective?: number
  /** True when the settlement passed its deliverable check — a scored-but-undelivered result is
   *  not progress. */
  readonly delivered: boolean
}

/** The read-model a `StopRule` decides from — the run's progress, not its budget. */
export interface ProgressView {
  readonly now: number
  /** Settlements observed so far, in the order they landed. */
  readonly settles: number
  /** Of those, how many passed their deliverable check. */
  readonly delivered: number
  /** Best-so-far objective after each settlement (`anytime.bestSoFar`). */
  readonly curve: ReadonlyArray<number>
  /** The current best objective; `0` when nothing has scored. */
  readonly best: number
  /** Mean of the best-so-far curve — how EARLY the run climbed (`anytime.areaUnderCurve`). */
  readonly auc: number
  /** Epoch ms of the most recent settlement; `0` when none has landed. */
  readonly lastSettleAt: number
  /** Epoch ms of the most recent improvement in best-so-far; `0` when none. */
  readonly lastImprovementAt: number
  /** Settlements since the last improvement — `0` right after one improves. */
  readonly settlesSinceImprovement: number
  /** Live read of every non-terminal worker (the `Scope.progress` feed). Empty when the caller
   *  supplied no scope. */
  readonly workers: ReadonlyArray<WorkerProgress>
  /** Nodes running or acquiring. */
  readonly inFlight: number
  /** Armed wait-state nodes — deliberately separate from `inFlight`: a tree whose only remaining
   *  nodes are waits is NOT stalled, it is waiting on the world. */
  readonly waiting: number
}

/** A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say
 *  why in the result, and an unexplained early stop is indistinguishable from a bug. */
export type StopDecision =
  | { readonly stop: false }
  | { readonly stop: true; readonly reason: string }

/** Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on
 *  the driver's hot path, once per turn. */
export type StopRule = (view: ProgressView) => StopDecision

const CONTINUE: StopDecision = { stop: false }

/** Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a
 *  caller may re-push its whole roster every turn (the driver does exactly that) without
 *  double-counting or moving a recorded timestamp. */
export interface ProgressTracker {
  /** Record a settlement. A second call with the same `id` is ignored. Returns true when it was
   *  new. */
  record(sample: ProgressSample): boolean
  /** Materialize the view. Pass the live `Scope` to include the worker feed and tree shape. */
  view(scope?: Scope<unknown>, opts?: { readonly stallAfterMs?: number }): ProgressView
  /** Evaluate a rule against the current view. */
  evaluate(
    rule: StopRule,
    scope?: Scope<unknown>,
    opts?: { readonly stallAfterMs?: number },
  ): StopDecision
  /** The samples recorded so far, in order. */
  samples(): ReadonlyArray<ProgressSample>
}

export interface ProgressTrackerOptions {
  /** Clock for `view().now`. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Treat a settlement that did NOT pass its deliverable check as having no objective. Default
   *  true — "scored 0.9 but never delivered" is not progress, and counting it as progress is the
   *  exact way a plateau rule gets talked out of firing. */
  readonly requireDelivered?: boolean
  /** How much the best-so-far must rise for a settlement to count as an IMPROVEMENT. Default 0
   *  (any strict rise counts). Raise it to ignore score noise. */
  readonly minImprovement?: number
}

/** Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by
 *  id) and materialize a `ProgressView` combining the best-so-far curve with the live worker feed. */
export function createProgressTracker(opts: ProgressTrackerOptions = {}): ProgressTracker {
  const now = opts.now ?? Date.now
  const requireDelivered = opts.requireDelivered ?? true
  const minImprovement = opts.minImprovement ?? 0
  const seen = new Set<string>()
  const recorded: ProgressSample[] = []

  return {
    record(sample) {
      if (seen.has(sample.id)) return false
      seen.add(sample.id)
      recorded.push(sample)
      return true
    },
    samples: () => [...recorded],
    view(scope, viewOpts) {
      const objectives = recorded.map((s) =>
        requireDelivered && !s.delivered ? undefined : s.objective,
      )
      const curve = bestSoFar(objectives)
      const best = curve.length > 0 ? (curve[curve.length - 1] as number) : 0
      let lastImprovementAt = 0
      let lastImprovementIdx = -1
      let prev = 0
      for (const [i, value] of curve.entries()) {
        if (value - prev > minImprovement) {
          lastImprovementAt = (recorded[i] as ProgressSample).at
          lastImprovementIdx = i
        }
        prev = value
      }
      const treeView = scope?.view
      const workers: WorkerProgress[] = []
      if (scope && treeView) {
        for (const node of treeView.nodes) {
          if (node.status === 'done' || node.status === 'failed' || node.status === 'cancelled') {
            continue
          }
          // A wait-state is not a worker. It produces no metered activity by design, so including
          // it here would make every waiting tree read as a fleet of stalled workers — the exact
          // false positive `allWorkersStalled` exists to avoid. It is counted in `waiting` instead.
          if (node.status === 'waiting') continue
          const p = scope.progress(
            node.id,
            viewOpts?.stallAfterMs !== undefined
              ? { now: now(), stallAfterMs: viewOpts.stallAfterMs }
              : { now: now() },
          )
          if (p) workers.push(p)
        }
      }
      return {
        now: now(),
        settles: recorded.length,
        delivered: recorded.filter((s) => s.delivered).length,
        curve,
        best,
        auc: areaUnderCurve(curve),
        lastSettleAt:
          recorded.length > 0 ? (recorded[recorded.length - 1] as ProgressSample).at : 0,
        lastImprovementAt,
        settlesSinceImprovement:
          lastImprovementIdx < 0 ? recorded.length : recorded.length - 1 - lastImprovementIdx,
        workers,
        inFlight: treeView?.inFlight ?? 0,
        waiting: treeView?.waiting ?? 0,
      }
    },
    evaluate(rule, scope, viewOpts) {
      return rule(this.view(scope, viewOpts))
    },
  }
}

/** Build a `ProgressSample` from a scope settlement. The objective is the verdict score and
 *  `delivered` is the verdict's `valid` — the SAME single delivery signal `finalizeBestDelivered`
 *  and `defaultSelectWinner` use, so "progress" and "winner" cannot disagree. */
export function sampleFromSettled(settled: Settled<unknown>, at: number): ProgressSample {
  if (settled.kind === 'down') {
    return { id: settled.handle.id, at, delivered: false }
  }
  return {
    id: settled.handle.id,
    at,
    ...(settled.verdict?.score !== undefined ? { objective: settled.verdict.score } : {}),
    delivered: settled.verdict?.valid === true,
  }
}

// ── The default rules ────────────────────────────────────────────────────────────────────────
//
// Each takes its thresholds as REQUIRED options. A default number here would be this module
// deciding a domain's judgment for it — which is the boundary the header states.

export interface NoProgressForOptions {
  /** Stop when this many ms have passed since the last SETTLEMENT. Omit to not bound on time. */
  readonly ms?: number
  /** Stop when this many settlements have landed with no improvement in best-so-far. Omit to not
   *  bound on settles. */
  readonly settles?: number
  /** Never stop before this many settlements have landed — the warm-up that stops a rule from
   *  firing on an empty run. Default 1. */
  readonly minSettles?: number
}

/**
 * "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no
 * IMPROVEMENT over the last `settles` settlements.
 *
 * A tree whose only remaining nodes are armed WAITS is exempt from the time bound: a run waiting
 * on CI is not a run that stopped making progress, and killing it there would defeat mechanic C.
 */
export function noProgressFor(opts: NoProgressForOptions): StopRule {
  if (opts.ms === undefined && opts.settles === undefined) {
    throw new ValidationError('noProgressFor: set at least one of { ms, settles }')
  }
  if (opts.ms !== undefined && opts.ms <= 0) {
    throw new ValidationError('noProgressFor: ms must be > 0')
  }
  if (opts.settles !== undefined && opts.settles < 1) {
    throw new ValidationError('noProgressFor: settles must be >= 1')
  }
  const minSettles = opts.minSettles ?? 1
  return (v) => {
    if (v.settles < minSettles) return CONTINUE
    if (opts.settles !== undefined && v.settlesSinceImprovement >= opts.settles) {
      return {
        stop: true,
        reason: `no-progress: ${v.settlesSinceImprovement} settles with no improvement (limit ${opts.settles}), best=${v.best}`,
      }
    }
    if (opts.ms !== undefined && v.waiting === 0 && v.lastSettleAt > 0) {
      const idle = v.now - v.lastSettleAt
      if (idle >= opts.ms) {
        return {
          stop: true,
          reason: `no-progress: ${idle}ms since the last settlement (limit ${opts.ms}ms)`,
        }
      }
    }
    return CONTINUE
  }
}

export interface PlateauOptions {
  /** How many trailing settlements to judge. The rule fires when the whole window failed to lift
   *  the best-so-far by more than `minDelta`. */
  readonly window: number
  /** The rise that counts as an improvement — the domain's noise floor. `0` means any strict rise
   *  counts. */
  readonly minDelta: number
  /** Never fire before this many settlements. Defaults to `window` (so the first decision is made
   *  on a full window, not on a partial one). */
  readonly minSettles?: number
}

/**
 * "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than
 * `minDelta` across the last `window` settlements.
 *
 * Built on `anytime.plateauLength` — the same plateau math the post-run anytime report uses, so a
 * rule that stops a run and a report that grades the decision cannot disagree about whether the
 * run was flat.
 */
export function plateau(opts: PlateauOptions): StopRule {
  if (!Number.isInteger(opts.window) || opts.window < 1) {
    throw new ValidationError('plateau: window must be a positive integer')
  }
  if (!Number.isFinite(opts.minDelta) || opts.minDelta < 0) {
    throw new ValidationError('plateau: minDelta must be >= 0')
  }
  const minSettles = opts.minSettles ?? opts.window
  return (v) => {
    if (v.settles < minSettles) return CONTINUE
    const flat = plateauLength(v.curve, opts.minDelta)
    if (flat >= opts.window) {
      return {
        stop: true,
        reason: `plateau: best-so-far rose <= ${opts.minDelta} over the last ${flat} settles (window ${opts.window}), best=${v.best}, auc=${v.auc.toFixed(3)}`,
      }
    }
    return CONTINUE
  }
}

export interface AllWorkersStalledOptions {
  /** Require at least this many live workers before the rule can fire — one stalled worker in a
   *  one-worker tree is a weaker signal than a whole fleet going quiet. Default 1. */
  readonly minWorkers?: number
  /** Idle time that counts as stalled, passed through to the live progress read. Omit = the
   *  runtime default (`DEFAULT_STALL_AFTER_MS`). */
  readonly stallAfterMs?: number
}

/**
 * "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for
 * longer than the stall threshold — and none of the tree is merely waiting.
 *
 * `stalled` is a derived read at observation time, never a background watchdog; this rule only
 * reads it. A tree with armed waits never fires: waiting is not stalling.
 */
export function allWorkersStalled(opts: AllWorkersStalledOptions = {}): StopRule {
  const minWorkers = opts.minWorkers ?? 1
  return (v) => {
    if (v.waiting > 0) return CONTINUE
    if (v.workers.length < minWorkers) return CONTINUE
    if (!v.workers.every((w) => w.stalled)) return CONTINUE
    const worst = Math.max(...v.workers.map((w) => w.idleMs))
    return {
      stop: true,
      reason: `all-stalled: ${v.workers.length} live workers idle, worst ${worst}ms`,
    }
  }
}

/** Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). */
export function anyOf(...rules: ReadonlyArray<StopRule>): StopRule {
  return (v) => {
    for (const rule of rules) {
      const d = rule(v)
      if (d.stop) return d
    }
    return CONTINUE
  }
}

/** Stop only when EVERY rule stops — for a conservative gate that needs corroboration. */
export function allOf(...rules: ReadonlyArray<StopRule>): StopRule {
  if (rules.length === 0) throw new ValidationError('allOf: needs at least one rule')
  return (v) => {
    const reasons: string[] = []
    for (const rule of rules) {
      const d = rule(v)
      if (!d.stop) return CONTINUE
      reasons.push(d.reason)
    }
    return { stop: true, reason: reasons.join(' AND ') }
  }
}
