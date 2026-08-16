/**
 * Compatibility facade for retained provider runs.
 *
 * Public contracts stay at this import path while implementation modules own
 * startup, replay, binding checks, and handle operations.
 */

export {
  reconnectRetainedInteractiveRun,
  recoverRetainedInteractiveRun,
  startRetainedInteractiveRun,
} from './retained-interactive'
export {
  type ClaimRetainedInteractiveControlOptions,
  claimRetainedInteractiveControl,
} from './retained-interactive-control'
export type {
  ReconnectRetainedInteractiveRunOptions,
  RecoverRetainedInteractiveRunOptions,
  RetainedInteractiveAdmissionHook,
  RetainedInteractiveEnvironmentInput,
  RetainedInteractiveRunHandle,
  RetainedInteractiveStartMaterial,
  StartRetainedInteractiveRunOptions,
} from './retained-interactive-types'
export {
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
  startRetainedRunInEnvironment,
} from './retained-run-start'
export type {
  NativeContextContinuationExecution,
  NativeContextContinuationInput,
  ReconnectRetainedRunOptions,
  RecoverRetainedRunOptions,
  RecoverRetainedRunResult,
  RetainedInteractiveAdmission,
  RetainedInteractiveEnvironmentAdmission,
  RetainedInteractiveIntentAdmission,
  RetainedInteractiveStartedAdmission,
  RetainedRunAdmission,
  RetainedRunAdmissionHook,
  RetainedRunCancellation,
  RetainedRunCancelOptions,
  RetainedRunDispatchedAdmission,
  RetainedRunEffect,
  RetainedRunEnvironmentAdmission,
  RetainedRunEventOptions,
  RetainedRunHandle,
  RetainedRunReplayPoint,
  RetainedRunSnapshot,
  StartRetainedRunInEnvironmentOptions,
  StartRetainedRunOptions,
} from './retained-run-types'
