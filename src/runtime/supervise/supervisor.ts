/**
 *
 * The `Supervisor` impl (KEYSTONE, build step 5).
 *
 * Owns the four things a free-running recursive `act` cannot own itself: the GLOBAL
 * conserved budget pool, the event-sourced spawn log, the abort cascade over the whole
 * live tree, and the OTP intensity breaker. `run` builds the root `Scope` over those,
 * runs the root `Agent.act`, and returns a TYPED `SupervisedResult` — a no-winner is
 * never coerced into a best-effort `Out`.
 *
 * Three lifecycle invariants this impl enforces by construction:
 *  - Join barrier: when `act()` settles (resolve OR reject), every still-live child is
 *    torn down before `run` returns — the generalization of the kernel's
 *    `finally{ Promise.allSettled(destroy) }` barrier (run-loop.ts) from boxes to the
 *    whole sub-tree. An unconfirmed teardown is retried with backoff for `teardownConfirmMs`.
 *    Each node pending when the window opens is journaled first as `teardown-pending`, then as
 *    `teardown-confirmed` or, still unconfirmed when the window closes, `teardown-unconfirmed`
 *    naming its provider environments; it NEVER masks act()'s own outcome. act()'s rejection is the
 *    PRIMARY error (the kernel's firstError precedence), so a teardown throw during the
 *    barrier can never overwrite the real failure.
 *  - Abort cascade: a root abort (caller signal, `RootHandle.abort`, a tripped breaker,
 *    or pool exhaustion) aborts ONE internal controller whose signal is the root scope's
 *    signal. The scope cascades that into every live child's executor abort — which, for
 *    an `acquiring` child, chains into the `acquireSandbox` signal and reaps the
 *    find-by-name orphan box (M1). The supervisor never reaps children directly.
 *  - The supervisor NEVER re-enters a child (m3): the kernel/`acquireSandbox` already
 *    retried at the leaf, and a driver re-spawns through `scope.spawn`. The breaker only
 *    COUNTS `down` settlements within the intensity window and trips to a typed
 *    no-winner; it does not restart anything.
 *
 * Selection lives in the driver, not here (selector≠judge): `act` returns the synthesized
 * winner `Out`. The supervisor content-addresses that `Out` for its replay `outRef`, reads
 * `spentTotal` off the journal (`settled` child work + `metered` driver inference), and wraps
 * it as a typed `winner` — it does not re-rank children behind the driver's back.
 *
 * @stable
 */

export { maxSeqOf, sumMeasuredSpendFromEvents, uncertainSpawnBudgets } from './recover-executors'
export { createRootHandle } from './supervisor-root-handle'
export { createSupervisor, DEFAULT_MAX_DEPTH } from './supervisor-run'
export type { NoWinnerError } from './types'
