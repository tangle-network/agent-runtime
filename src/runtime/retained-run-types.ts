import type {
  AgentExactRunControlRef,
  AgentNativeContextContinuationOptions,
  AgentNativeContextContinuationResult,
  AgentSessionStatus,
  InteractionAcknowledgement,
  InteractionResponseCommand,
  NativeContextBoundaryProof,
  NativeContextContinuationRequest,
  NativeContextContinuationTurn,
  RuntimeEventEnvelope,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentTurnInput,
  AgentTurnResult,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'

/** Cursor plus runtime sequence needed to continue one ordered replay. @stable */
export interface RetainedRunReplayPoint {
  readonly cursor: string
  readonly sequence: number
}

/** Options for replaying canonical events strictly after a saved point. @stable */
export interface RetainedRunEventOptions {
  readonly after?: RetainedRunReplayPoint
  readonly signal?: AbortSignal
}

/** Effect recorded for one retained control operation. @stable */
export type RetainedRunEffect = 'cancel_requested' | 'cancelled' | 'not_live' | 'unknown'

/** Stable status snapshot for a retained run. @stable */
export interface RetainedRunSnapshot {
  readonly runId: string
  readonly controlRef: AgentExactRunControlRef
  readonly status: AgentSessionStatus | null
  readonly effect: RetainedRunEffect
  readonly observedAt: string
  readonly reason?: string
  readonly signal?: string
}

/** Durable acknowledgement state for one retained control operation. @stable */
export interface RetainedRunCancellation {
  readonly operationId: string
  readonly requestDigest: Sha256Digest
  readonly status: 'accepted' | 'replayed' | 'conflict' | 'unknown'
  readonly effect: RetainedRunEffect
  readonly snapshot: RetainedRunSnapshot
  readonly reason?: string
  readonly signal?: string
}

/** Options for an idempotent retained cancellation. @stable */
export interface RetainedRunCancelOptions {
  readonly operationId: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

/** Runtime controls plus the exact user turn bound into a continuation request. @stable */
export type NativeContextContinuationInput = NativeContextContinuationTurn &
  Omit<AgentNativeContextContinuationOptions, 'turn'>

/** Result of one verified same-session continuation. @stable */
export type NativeContextContinuationExecution = AgentNativeContextContinuationResult

/** Reconstructable control of one provider-retained run. @stable */
export interface RetainedRunHandle {
  readonly controlRef: AgentExactRunControlRef
  /** Capabilities measured from the exact environment that owns this run. */
  readonly capabilities: AgentEnvironmentCapabilities
  status(options?: { waitMs?: number; signal?: AbortSignal }): Promise<RetainedRunSnapshot>
  events(options?: RetainedRunEventOptions): AsyncIterable<RuntimeEventEnvelope>
  result(): Promise<AgentTurnResult>
  respondToInteraction(
    command: InteractionResponseCommand,
    options?: { signal?: AbortSignal },
  ): Promise<InteractionAcknowledgement>
  contextBoundary(options?: { signal?: AbortSignal }): Promise<NativeContextBoundaryProof | null>
  continueNative(
    request: NativeContextContinuationRequest,
    turn: NativeContextContinuationInput,
  ): Promise<NativeContextContinuationExecution>
  cancel(options: RetainedRunCancelOptions): Promise<RetainedRunCancellation>
}

/** Recovery coordinates durable after environment creation and before dispatch. @stable */
export interface RetainedRunEnvironmentAdmission {
  readonly phase: 'environment'
  readonly provider: string
  readonly environmentId: string
  readonly idempotencyKey: string
  readonly turnId: string
  /** Caller-supplied or runtime-minted; always the identity the dispatch will request. */
  readonly sessionId: string
  /** Caller-supplied or runtime-minted; always the identity the dispatch will request. */
  readonly executionId: string
}

/** The verified exact reference, durable before the start promise resolves. @stable */
export interface RetainedRunDispatchedAdmission {
  readonly phase: 'dispatched'
  readonly controlRef: AgentExactRunControlRef
  readonly idempotencyKey: string
  readonly turnId: string
}

/** One admission record the runtime persists through the caller before proceeding. @stable */
export type RetainedRunAdmission = RetainedRunEnvironmentAdmission | RetainedRunDispatchedAdmission

/**
 * Awaited durability hook for retained admission records.
 *
 * The runtime blocks after environment creation and again after dispatch until
 * the hook resolves, so no retained run becomes caller-visible before its
 * recovery record is durable. A rejection fails the start without destroying
 * the environment; the persisted record or provider state is the recovery path.
 *
 * @stable
 */
export type RetainedRunAdmissionHook = (admission: RetainedRunAdmission) => Promise<void>

/** A retained start is retry-safe only when environment and turn keys are explicit. @stable */
export interface StartRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environment: CreateAgentEnvironmentInput & { idempotencyKey: string }
  readonly turn: AgentTurnInput & { turnId: string }
  /**
   * Explicit dispatch coordinates. When omitted, the runtime mints
   * deterministic coordinates from `(environment.idempotencyKey, turn.turnId)`
   * so every process derives the same values.
   */
  readonly identity?: {
    readonly sessionId: string
    readonly executionId: string
  }
  readonly onAdmission: RetainedRunAdmissionHook
  readonly now?: () => number
}

/** A fresh retained session inside a provider environment that already exists. @stable */
export interface StartRetainedRunInEnvironmentOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environment: {
    /** Stable provider environment identifier used by `provider.get`. */
    readonly id: string
    /** Original environment key. The provider must return the matching retained metadata. */
    readonly idempotencyKey: string
  }
  readonly turn: AgentTurnInput & { turnId: string }
  /**
   * Explicit fresh-session coordinates. When omitted, the runtime mints them
   * from `(environment.idempotencyKey, turn.turnId)`.
   */
  readonly identity?: {
    readonly sessionId: string
    readonly executionId: string
  }
  readonly onAdmission: RetainedRunAdmissionHook
  readonly now?: () => number
}

/** Inputs sufficient to rebuild a control client in a new process. @stable */
export interface ReconnectRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly controlRef: AgentExactRunControlRef
  readonly now?: () => number
}

/**
 * Pre-dispatch admission coordinates for one recovery attempt.
 *
 * A `phase: 'environment'` admission record carries these fields, so a caller
 * can pass that record after a crash before the dispatched record landed.
 *
 * @stable
 */
export interface RecoverRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environmentId: string
  readonly sessionId: string
  readonly executionId: string
  readonly now?: () => number
}

/**
 * Outcome of one recovery attempt from pre-dispatch admission coordinates.
 *
 * `not_found`: the provider no longer holds the environment; nothing remains
 * to destroy. `recovered`: the provider self-identified the session with a
 * strict exact reference matching the recorded coordinates. `unverifiable`:
 * the environment exists but the provider cannot self-identify the session;
 * never destroy on this outcome — keep the environment, retry
 * `reconnectRetainedRun` with a dispatched admission record, or inspect it
 * with provider-native tools.
 *
 * @stable
 */
export type RecoverRetainedRunResult =
  | { readonly outcome: 'recovered'; readonly handle: RetainedRunHandle }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'unverifiable'; readonly environment: AgentEnvironment }
