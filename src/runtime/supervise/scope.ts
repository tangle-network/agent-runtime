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

export type { ScopeOwnerPause } from './scope-capabilities'
export {
  closeRetainedSlots,
  closeScopeAdmission,
  DEFAULT_BUDGET_STOP_HOLD_MS,
  hasRetriableTeardowns,
  meterRuntimeOwnedAccounting,
  meterRuntimeOwnedProviderAttempt,
  recordScopeOwnerDriverAttempt,
  recordScopeOwnerPause,
  registerNestedTeardownScope,
  releaseHeldEnvironments,
  releaseManagerEnvironment,
  releaseRetainedEnvironments,
  retryUnconfirmedTeardowns,
  SUBTREE_RESULT_LIMIT,
  settleManagerWork,
  startScopeRecoveries,
  subtreeSummaryOf,
  unconfirmedTeardowns,
  waitForScopeChildren,
} from './scope-capabilities'
export { createScope } from './scope-construction'
export type { NestedScopeSeam, PreSeqSettled, ScopeArgs } from './scope-contract'
export { nestedScopeSeamKey } from './scope-contract'
export { assertRecursiveReservationPolicy, deriveNodeExecutionIdentity } from './scope-identity'
export { reenteredWorkers, settledToIteration } from './scope-observation'
export {
  beginScopeOwnerAttempt,
  finalizeScopeOwnerMaterialization,
  noteScopeOwnerPlannedExecution,
  recordScopeOwnerMaterialization,
  restoreScopeOwnerAcceptedExecution,
  scopeOwnerExecutorNodeContext,
} from './scope-owner-materialization'
