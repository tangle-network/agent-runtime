/**
 *
 * The reactive `Scope` impl (KEYSTONE, build step 4 + the step-8 adapter).
 *
 * An `Agent.act` runs inside a `Scope`. It `spawn`s children dynamically and reacts to
 * them via `next()`. The scope owns ONE in-memory nursery — the authoritative live set —
 * and is the single place that drives a child's lifecycle: reserve budget atomically,
 * resolve a `Executor` through the open registry, run it (one-shot OR streaming),
 * fold its normalized `UsageEvent`s into a conserved `Spend`, reconcile the reservation
 * (refunding the unspent remainder), persist the result blob + journal records, and
 * deliver the `Settled` through the `next()` cursor.
 *
 * Three invariants this impl enforces by construction:
 *  - `next()` is a ray.wait n=1 cursor over THIS scope's live set; it assigns the
 *    monotonic `seq` (the recorded cursor order) at the moment it yields a settlement, so
 *    replay re-delivers in the identical order — `seq` is never wall-clock.
 *  - Budget is reserved at spawn and reconciled at settle through the shared `BudgetPool`,
 *    so `spawn` fails CLOSED on an exhausted pool and total ≡ free + reserved + committed.
 *  - `view` reads the in-memory nursery, never the journal — O(live), synchronous.
 *
 * The settle path is the only writer of journal `settled` events; the spawn path the only
 * writer of `spawned` events. The result blob is `put` BEFORE the journal `settled` record
 * references its `outRef`, so a crash can never leave a journaled ref with no blob.
 *
 * @stable
 */

export type { ScopeArgs } from './scope-contract'
export { reenteredWorkers } from './scope-observation'
export type { ScopeOwnerPause } from './scope-capabilities'
export { SUBTREE_RESULT_LIMIT } from './scope-capabilities'
export { subtreeSummaryOf } from './scope-capabilities'
export { DEFAULT_BUDGET_STOP_HOLD_MS } from './scope-capabilities'
export { releaseHeldEnvironments } from './scope-capabilities'
export { startScopeRecoveries } from './scope-capabilities'
export { releaseRetainedEnvironments } from './scope-capabilities'
export { releaseManagerEnvironment } from './scope-capabilities'
export { settleManagerWork } from './scope-capabilities'
export { closeRetainedSlots } from './scope-capabilities'
export { unconfirmedTeardowns } from './scope-capabilities'
export { registerNestedTeardownScope } from './scope-capabilities'
export { retryUnconfirmedTeardowns } from './scope-capabilities'
export { hasRetriableTeardowns } from './scope-capabilities'
export { closeScopeAdmission } from './scope-capabilities'
export { waitForScopeChildren } from './scope-capabilities'
export { assertRecursiveReservationPolicy } from './scope-identity'
export type { PreSeqSettled } from './scope-contract'
export { nestedScopeSeamKey } from './scope-contract'
export type { NestedScopeSeam } from './scope-contract'
export { createScope } from './scope-construction'
export { meterRuntimeOwnedProviderAttempt } from './scope-capabilities'
export { recordScopeOwnerPause } from './scope-capabilities'
export { recordScopeOwnerDriverAttempt } from './scope-capabilities'
export { meterRuntimeOwnedAccounting } from './scope-capabilities'
export { noteScopeOwnerPlannedExecution } from './scope-owner-materialization'
export { recordScopeOwnerMaterialization } from './scope-owner-materialization'
export { beginScopeOwnerAttempt } from './scope-owner-materialization'
export { scopeOwnerExecutorNodeContext } from './scope-owner-materialization'
export { restoreScopeOwnerAcceptedExecution } from './scope-owner-materialization'
export { finalizeScopeOwnerMaterialization } from './scope-owner-materialization'
export { settledToIteration } from './scope-observation'
export { deriveNodeExecutionIdentity } from './scope-identity'
