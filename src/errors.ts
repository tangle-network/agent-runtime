/**
 * @stable
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
 */

import { AgentEvalError } from '@tangle-network/agent-eval'

export {
  AgentEvalError,
  type AgentEvalErrorCode,
  CaptureIntegrityError,
  ConfigError,
  JudgeError,
  NotFoundError,
  ReplayError,
  ValidationError,
  VerificationError,
} from '@tangle-network/agent-eval'

/**
 * @stable
 *
 * Caller asked to resume a session against a backend whose `kind` does not
 * match the session's recorded backend. This is a routing bug — the same
 * session id was reused across two different backend implementations — and
 * is not retryable without picking the right backend.
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
 * @stable
 *
 * A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
 * status. Distinct from `JudgeError` (which is structural / unrecoverable)
 * because backend failures are sometimes retryable and consumers may want to
 * branch on the upstream status code.
 */
export class BackendTransportError extends AgentEvalError {
  readonly backend: string
  readonly status?: number
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
    options?: { cause?: unknown; status?: number; body?: string },
  ) {
    super('config', message, options)
    this.backend = backend
    this.status = options?.status
    this.body = options?.body
  }
}

/**
 * @stable
 *
 * A runtime-run lifecycle method was called in an order the state machine does
 * not allow: `persist()` before `complete()`, `complete()` twice, etc.
 */
export class RuntimeRunStateError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 * @stable
 *
 * The dynamic-loop planner returned an unusable topology move — the LLM emitted
 * no parseable envelope, an unknown `kind`, or a structurally-invalid move
 * (e.g. a fanout with zero tasks). This is a structural failure of the
 * agent-authored topology, not a config mistake: the planner ran but its output
 * cannot drive the kernel. Carries `validation` so cross-package handlers can
 * pattern-match without importing the runtime. Fail loud — never substitute a
 * default move, or the loop silently runs a topology nobody chose.
 */
export class PlannerError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}
