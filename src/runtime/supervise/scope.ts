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
