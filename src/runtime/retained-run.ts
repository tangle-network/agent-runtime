/**
 * Compatibility facade for retained provider runs.
 *
 * Public contracts stay at this import path while implementation modules own
 * startup, replay, binding checks, and handle operations.
 */

export { reconnectRetainedRun, startRetainedRun } from './retained-run-start'
export type {
  NativeContextContinuationExecution,
  NativeContextContinuationInput,
  ReconnectRetainedRunOptions,
  RetainedRunCancellation,
  RetainedRunCancelOptions,
  RetainedRunEffect,
  RetainedRunEventOptions,
  RetainedRunHandle,
  RetainedRunReplayPoint,
  RetainedRunSnapshot,
  StartRetainedRunOptions,
} from './retained-run-types'
