/**
 * Compatibility facade for retained provider runs.
 *
 * Public contracts stay at this import path while implementation modules own
 * startup, replay, binding checks, and handle operations.
 */

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
