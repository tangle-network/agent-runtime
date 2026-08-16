/**
 *
 * Error taxonomy for `@tangle-network/agent-runtime`.
 *
 * Public contract: every error this package throws as part of its consumer-
 * facing API either extends `AgentEvalError` (re-exported here for ergonomic
 * `instanceof` checks at the runtime boundary) or extends one of the
 * runtime-specific subclasses below.
 *
 * Internal invariant guards (`throw new Error('this should never happen')`)
 * remain plain `Error` — they are programmer-mistake assertions, not
 * consumer-catchable contract failures.
 *
 * Subclassing strategy: where a runtime-specific failure maps cleanly to an
 * agent-eval code (validation, config, not_found), we re-use the agent-eval
 * subclass. Runtime-only failure modes (session resume against the wrong
 * backend, backend transport errors) get fresh subclasses that still carry an
 * `AgentEvalErrorCode` so cross-package handlers can pattern-match without
 * importing the runtime.
 *
 * @stable
 */

import { AgentEvalError } from '@tangle-network/agent-eval'
import type {
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
  AgentInteractiveSessionStatus,
} from '@tangle-network/agent-interface'
import type {
  RetainedInteractiveAdmission,
  RetainedRunAdmission,
} from './runtime/retained-run-types'

export {
  AgentEvalError,
  type AgentEvalErrorCode,
  ConfigError,
  JudgeError,
  NotFoundError,
  ValidationError,
} from '@tangle-network/agent-eval'

/**
 *
 * Caller asked to resume a session against a backend whose `kind` does not
 * match the session's recorded backend. This is a routing bug — the same
 * session id was reused across two different backend implementations — and
 * is not retryable without picking the right backend.
 *
 * @stable
 */
export class SessionMismatchError extends AgentEvalError {
  readonly sessionBackend: string
  readonly requestedBackend: string

  constructor(sessionBackend: string, requestedBackend: string, options?: { cause?: unknown }) {
    super(
      'validation',
      `Cannot resume ${sessionBackend} session with ${requestedBackend} backend`,
      options,
    )
    this.sessionBackend = sessionBackend
    this.requestedBackend = requestedBackend
  }
}

/**
 *
 * A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
 * status. Distinct from `JudgeError` (which is structural / unrecoverable)
 * because backend failures are sometimes retryable and consumers may want to
 * branch on the upstream status code.
 *
 * @stable
 */
export class BackendTransportError extends AgentEvalError {
  readonly backend: string
  readonly status?: number
  /**
   * Router-owned proof that a rejected request never reached a provider.
   *
   * This is intentionally one-sided. An absent value, or any value this
   * package does not understand, remains unknown to Runtime.
   */
  readonly providerDispatch?: 'not_started'
  /**
   * Truncated upstream response body (≤2 KiB) when available. Diagnostic
   * only — surfaces in `backend_error.error.body` and `final.error.body`
   * so operators can see "free_tier_limit", "invalid_api_key", etc. without
   * cracking the log line open.
   */
  readonly body?: string

  constructor(
    backend: string,
    message: string,
    options?: {
      cause?: unknown
      status?: number
      body?: string
      providerDispatch?: 'not_started'
    },
  ) {
    super('config', message, options)
    this.backend = backend
    this.status = options?.status
    this.body = options?.body
    this.providerDispatch = options?.providerDispatch
  }
}

/**
 *
 * A runtime-run lifecycle method was called in an order the state machine does
 * not allow: `persist()` before `complete()`, `complete()` twice, etc.
 *
 * @stable
 */
export class RuntimeRunStateError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 *
 * The dynamic-loop planner returned an unusable topology move — the LLM emitted
 * no parseable envelope, an unknown `kind`, or a structurally-invalid move
 * (e.g. a fanout with zero tasks). This is a structural failure of the
 * agent-authored topology, not a config mistake: the planner ran but its output
 * cannot drive the kernel. Carries `validation` so cross-package handlers can
 * pattern-match without importing the runtime. Fail loud — never substitute a
 * default move, or the loop silently runs a topology nobody chose.
 *
 * @stable
 */
export class PlannerError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 * The analyst loop could not read or run over a round's trace — e.g. an empty round
 * (no iterations to analyze) or a malformed trace projection. Fail loud: a silent empty
 * store would mask a broken capture path and the driver would steer on nothing.
 */
export class AnalystError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 *
 * The caller's `onAdmission` durability hook rejected, so a retained run's
 * admission record is not durable. For a pre-create intent, no provider work
 * has started. For a later record, provider state may already be live and the
 * environment remains available for recovery. Carries `capture_integrity`
 * because the required recovery record was not written.
 *
 * @stable
 */
abstract class RetainedAdmissionError<
  TAdmission extends RetainedRunAdmission | RetainedInteractiveAdmission,
> extends AgentEvalError {
  readonly phase: TAdmission['phase']
  /** The exact record the hook failed to persist, for direct recovery. */
  readonly admission: TAdmission

  constructor(admission: TAdmission, options?: { cause?: unknown }) {
    const recovery =
      admission.phase === 'interactive_intent'
        ? 'no provider work has started'
        : 'the environment is kept for recovery'
    super(
      'capture_integrity',
      `retained run admission (${admission.phase}) was not persisted; ${recovery}`,
      options,
    )
    this.phase = admission.phase
    this.admission = admission
  }
}

/** The caller could not persist one detached-run recovery record. @stable */
export class RetainedRunAdmissionError extends RetainedAdmissionError<RetainedRunAdmission> {}

/** The caller could not persist one exact interactive-process recovery record. @stable */
export class RetainedInteractiveAdmissionError extends RetainedAdmissionError<RetainedInteractiveAdmission> {}

/**
 * A provider returned a valid interactive reference that does not bind to the
 * exact start request, or returned data that could not be parsed as one.
 *
 * The requested start and any valid provider reference are detached snapshots.
 * Malformed provider data is never copied into the error, so the error remains
 * safe to persist while the environment remains available for orphan cleanup.
 *
 * @stable
 */
export class RetainedInteractiveBindingError extends AgentEvalError {
  /** The exact native-process start request sent to the provider. */
  readonly requested: AgentInteractiveSessionStart
  /** The valid provider data, when the provider returned a parseable value. */
  readonly returned: {
    readonly ref?: AgentInteractiveSessionRef
    readonly status?: AgentInteractiveSessionStatus
  }

  constructor(
    requested: AgentInteractiveSessionStart,
    returned: RetainedInteractiveBindingError['returned'],
    options?: { cause?: unknown },
  ) {
    super(
      'backend_integrity',
      'provider returned interactive data that does not bind to the requested start; the environment is kept for diagnosis and cleanup',
      options,
    )
    this.requested = Object.freeze(requested)
    this.returned = Object.freeze(returned)
  }
}

/**
 *
 * A retained dispatch answered with coordinates that do not bind to the
 * identity the runtime requested, or failed exact verification. The
 * environment-phase admission is already durable at this point, so its
 * coordinates plus the provider reference carried here are the manual
 * recovery path. The environment is intentionally kept. Carries
 * `backend_integrity` because the provider violated its dispatch contract.
 *
 * @stable
 */
export class RetainedRunDispatchBindingError extends AgentEvalError {
  /** The coordinates the runtime sent with the dispatch. */
  readonly requested: {
    readonly provider: string
    readonly environmentId: string
    readonly sessionId: string
    readonly executionId: string
  }
  /** The loose reference the provider actually returned, for triage. */
  readonly returned: {
    readonly id?: string
    readonly provider?: string
    readonly controlRef?: unknown
  }

  constructor(
    requested: RetainedRunDispatchBindingError['requested'],
    returned: RetainedRunDispatchBindingError['returned'],
    options?: { cause?: unknown },
  ) {
    super(
      'backend_integrity',
      'retained dispatch did not bind to the requested identity; the durable environment admission and the returned reference on this error are the recovery path',
      options,
    )
    this.requested = requested
    this.returned = returned
  }
}
