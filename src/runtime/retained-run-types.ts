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

/** A retained start is retry-safe only when environment and turn keys are explicit. @stable */
export interface StartRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environment: CreateAgentEnvironmentInput & { idempotencyKey: string }
  readonly turn: AgentTurnInput & { turnId: string }
  /** Runtime-owned coordinates for providers that support deterministic retained dispatch. */
  readonly identity?: {
    readonly sessionId: string
    readonly executionId: string
  }
  readonly now?: () => number
}

/** Inputs sufficient to rebuild a control client in a new process. @stable */
export interface ReconnectRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly controlRef: AgentExactRunControlRef
  readonly now?: () => number
}
