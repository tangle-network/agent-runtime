import type { BudgetPool } from './budget'
import { DriverAttemptsExhaustedError } from './driver-attempt-evidence'
import { errMessage, errorProperty } from './error-message'
import type { IntensityBreaker } from './supervisor-intensity-breaker'
import type { NoWinnerError, SupervisedResult, SupervisorOpts, TreeView } from './types'

/** Every no-winner reason, pinned to the published `SupervisedResult` union so the contract
 *  and the impl cannot drift. */
type NoWinnerReason = (SupervisedResult<unknown> & { kind: 'no-winner' })['reason']

/** The reasons the supervisor can prove from its OWN lifecycle state — everything except the
 *  driver's rejection, which no lifecycle observation can establish. */
type LifecycleNoWinnerReason = Exclude<
  NoWinnerReason,
  'driver-failed' | 'cancelled' | 'no-children-spawned' | 'no-result-selected' | 'stopped'
>

/** A captured `act()` rejection. Wrapped rather than passed bare so `throw undefined` — legal, and
 *  exactly the kind of authoring bug this field exists to surface — is still distinguishable from
 *  "the driver never threw". */
export interface DriverRejection {
  readonly error: unknown
}

/**
 * Normalize an arbitrary rejection into the serializable triple the result carries. A driver may
 * reject with anything (a string, a plain object, a null-prototype value), and the whole point of
 * this field is that the failure survives, so every branch produces a message instead of throwing:
 * a stringification that itself throws (circular, hostile `toString`) falls back to the tag.
 */
export function describeRejection(error: unknown): NoWinnerError {
  if (error instanceof Error) {
    const stack = errorProperty(error, 'stack')
    return {
      name: errorProperty(error, 'name') ?? 'Error',
      // Retry exhaustion already renders both bounded chains; treating it as one wrapper would
      // truncate the first failure again and leave only the final reconciliation cause.
      message:
        error instanceof DriverAttemptsExhaustedError
          ? (errorProperty(error, 'message') ?? '')
          : errMessage(error),
      ...(stack !== undefined ? { stack } : {}),
    }
  }
  return { name: 'NonError', message: errMessage(error) }
}

/**
 * The lifecycle cause of a no-winner, or `undefined` when the supervisor's own state proves
 * nothing. Returning `undefined` rather than falling through to `all-children-down` is what lets
 * the caller decide between the `driver-failed` arm (a rejection was captured) and the residual
 * bucket — and it is why `driver-failed` cannot be produced without an `error` to attach.
 */
export function classifyNoWinner(
  /** Whether execution was aborted, including an explicit cascade during descendant drain —
   *  NOT the controller's state now. The join barrier itself aborts children, so reading the
   *  live controller here reported every driver failure that happened to have a live child as
   *  `aborted`, hiding the real cause (#741: the run with one live child reported `aborted`, the
   *  identical failure with none reported `driver-failed`). */
  abortedAtSettle: boolean,
  pool: BudgetPool,
  opts: SupervisorOpts,
  breaker: IntensityBreaker,
  deadlineExceeded: boolean,
  /** Every spawned child was already down when root execution settled — measured BEFORE the join
   *  barrier, so the barrier's own teardown cannot manufacture this cause. */
  allChildrenDownAtSettle: boolean,
): LifecycleNoWinnerReason | undefined {
  // A tripped breaker is the most specific cause (children kept dying), so it outranks
  // the abort it raised. A deadline that won the abort race is `deadline`; then come caller/handle
  // abort, every child down (what `all-children-down` asserts), a spent pool, and a deadline the
  // clock passed without its timer winning. `budget-exhausted` names a spent pool only: measured
  // 2026-10-21, 93 of 98 runs labelled it had ended on the deadline with tokens left (median 99.8%).
  if (breaker.tripped()) return 'all-children-down'
  if (deadlineExceeded) return 'deadline'
  if (abortedAtSettle) return 'aborted'
  // Unknown terminal usage correctly seals the remaining pool, but that accounting consequence is
  // not the cause of a run where every child failed. Preserve the lifecycle outcome before asking
  // whether any budget channel is now unavailable. A real admission failure with no failed child
  // still classifies as budget exhaustion below.
  if (allChildrenDownAtSettle) return 'all-children-down'
  if (poolExhausted(pool, opts)) return 'budget-exhausted'
  if (deadlinePassed(pool, opts)) return 'deadline'
  // One down child among delivered siblings explains nothing about why the root selected no
  // result, and it used to settle `all-children-down` here: verified-agency-20260920b spawned 8,
  // settled 6 done and 2 down to a runtime restart, and carried that reason. The count stays on
  // the record as `downCount`; the reason is the root's, `no-result-selected` or `driver-failed`.
  return undefined
}

export function allSpawnedChildrenDown(tree: TreeView): boolean {
  const children = tree.nodes.filter((node) => node.id !== tree.root)
  // A child whose failure has resolved but which the driver never read off the cursor is down
  // too: its status flips to `failed` only when a settlement is committed, and a harness root
  // that ends its turn without draining leaves every such failure pending. Counting only
  // committed settlements read a fleet where every child had died as the root's own choice.
  return (
    children.length > 0 &&
    children.every((node) => node.status === 'failed' || node.settlementPending?.kind === 'down')
  )
}

function poolExhausted(pool: BudgetPool, opts: SupervisorOpts): boolean {
  const r = pool.readout()
  if (r.iterationsLeft <= 0) return true
  if (r.tokensLeft <= 0) return true
  return opts.budget.maxUsd !== undefined && r.usdLeft <= 0
}

function deadlinePassed(pool: BudgetPool, opts: SupervisorOpts): boolean {
  const deadlineMs = pool.readout().deadlineMs
  return (
    opts.budget.deadlineMs !== undefined && deadlineMs > 0 && (opts.now ?? Date.now)() >= deadlineMs
  )
}
