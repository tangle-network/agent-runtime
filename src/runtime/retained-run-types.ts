import type {
  AgentExactRunControlRef,
  AgentFileOutputPolicy,
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
  AgentNativeContextContinuationOptions,
  AgentNativeContextContinuationResult,
  AgentSessionStatus,
  ContextTransferReceipt,
  ContextTransferRequest,
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
  Omit<AgentNativeContextContinuationOptions, 'turn' | 'onAdmission'>

/** Result of one verified same-session continuation. @stable */
export type NativeContextContinuationExecution = AgentNativeContextContinuationResult

/** A fresh retained turn with a canonical, approved portable context request. @stable */
export type RetainedRunTurnInput = Omit<AgentTurnInput, 'contextTransfer'> & {
  readonly turnId: string
  readonly contextTransfer?: ContextTransferRequest
}

/** Admission once the next exact reference is durable, and the terminal result. @stable */
export interface NativeContextContinuationHandle {
  readonly admission: Promise<AgentExactRunControlRef>
  readonly result: Promise<NativeContextContinuationExecution>
}

/** Reconstructable control of one provider-retained run. @stable */
export interface RetainedRunHandle {
  readonly controlRef: AgentExactRunControlRef
  /** Bound to the actual dispatched environment, never a later provider.get reconstruction. */
  readonly retainFileOutput?: AgentEnvironment['retainFileOutput']
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
  beginNativeContinuation(
    request: NativeContextContinuationRequest,
    turn: NativeContextContinuationInput,
  ): NativeContextContinuationHandle
  continueNative(
    request: NativeContextContinuationRequest,
    turn: NativeContextContinuationInput,
  ): Promise<NativeContextContinuationExecution>
  cancel(options: RetainedRunCancelOptions): Promise<RetainedRunCancellation>
}

/** Intent durable before create. The digest omits secrets; replay needs the original start material. @stable */
export interface RetainedRunIntentAdmission {
  readonly phase: 'intent'
  readonly provider: string
  readonly idempotencyKey: string
  readonly turnId: string
  readonly sessionId: string
  readonly executionId: string
  readonly runId: string
  readonly requestedProfileDigest: Sha256Digest
  /** File custody owed by this original invocation, retained across owner reconstruction. */
  readonly outputFilePolicyDigest?: Sha256Digest
  readonly requestDigest: Sha256Digest
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

/** Interactive intent durable before create. The digest omits secrets, env, and provider options. @stable */
export interface RetainedInteractiveIntentAdmission {
  readonly phase: 'interactive_intent'
  readonly provider: string
  readonly idempotencyKey: string
  readonly interactiveIdempotencyKey: string
  readonly sessionId: string
  readonly executionId: string
  readonly runId: string
  readonly requestedProfileDigest: Sha256Digest
  readonly requestDigest: Sha256Digest
}

/** Exact interactive start request durable after environment creation. @stable */
export interface RetainedInteractiveEnvironmentAdmission {
  readonly phase: 'interactive_environment'
  readonly provider: string
  readonly environmentId: string
  readonly idempotencyKey: string
  readonly interactiveIdempotencyKey: string
  readonly request: AgentInteractiveSessionStart
}

/** Provider-issued interactive process reference durable before start returns. @stable */
export interface RetainedInteractiveStartedAdmission {
  readonly phase: 'interactive_started'
  readonly idempotencyKey: string
  readonly interactiveIdempotencyKey: string
  readonly ref: AgentInteractiveSessionRef
}

/** Durable records for one exact native coding-agent process. @stable */
export type RetainedInteractiveAdmission =
  | RetainedInteractiveIntentAdmission
  | RetainedInteractiveEnvironmentAdmission
  | RetainedInteractiveStartedAdmission

/** One detached-run admission record the runtime persists before creation or dispatch proceeds. @stable */
export type RetainedRunAdmission =
  | RetainedRunIntentAdmission
  | RetainedRunEnvironmentAdmission
  | RetainedRunDispatchedAdmission

/** Blocks until the admission is durable. A rejection keeps provider state already started. @stable */
export type RetainedRunAdmissionHook = (admission: RetainedRunAdmission) => Promise<void>

/** Environment, turn, and optional identity needed to replay one retained start. @stable */
export interface RetainedRunStartMaterial {
  /** File-mode admission requirement, bound into the original intent and checked before dispatch. */
  readonly outputFile?: AgentFileOutputPolicy
  readonly environment: CreateAgentEnvironmentInput & { idempotencyKey: string }
  /** Reuse an environment whose retained ownership key is verified instead of creating one. */
  readonly existingEnvironmentId?: string
  /** Keep a newly created environment after dispatch fails so its original intent can replay. */
  readonly preserveEnvironment?: boolean
  readonly turn: RetainedRunTurnInput
  /** Accepted destination to attach, without creating or replacing its environment. */
  readonly contextTransferReceipt?: ContextTransferReceipt
  /** Explicit coordinates. Omitted values are minted from the environment key and turn id. */
  readonly identity?: {
    readonly sessionId: string
    readonly executionId: string
  }
}

/** A retained start is retry-safe only when environment and turn keys are explicit. @stable */
export interface StartRetainedRunOptions extends RetainedRunStartMaterial {
  readonly provider: AgentEnvironmentProvider
  /** A previously persisted intent used to replay the exact create operation. */
  readonly intent?: RetainedRunIntentAdmission
  readonly onAdmission: RetainedRunAdmissionHook
  readonly now?: () => number
  /** How long create may take after intent is durable. Absent uses the retained materialization bound. */
  readonly materializationTimeoutMs?: number
  /** Directory whose `<runId>/observer.jsonl` (intent run id) receives admissions for agent-runtime-top. */
  readonly journalRoot?: string
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
  readonly turn: RetainedRunTurnInput
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

/** Recover a headless start after its pre-create intent was persisted. @stable */
export interface RecoverRetainedRunIntentOptions {
  readonly provider: AgentEnvironmentProvider
  readonly admission: RetainedRunIntentAdmission
  /** The exact original environment, turn, and optional identity material. */
  readonly replay: RetainedRunStartMaterial
  readonly onAdmission: RetainedRunAdmissionHook
  readonly now?: () => number
}

/** Environment-phase coordinates, enough to recover before a dispatched record lands. @stable */
export interface RecoverRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environmentId: string
  readonly sessionId: string
  readonly executionId: string
  /** Accepted transfer request. Recovery repeats the receipt-authorized lookup; omit it only when the run had none. */
  readonly contextTransfer?: ContextTransferRequest
  readonly transferReceipt?: ContextTransferReceipt
  readonly now?: () => number
}

/** `reattached` matched the recorded session. `resumed` replayed intent. `not_found` has nothing to destroy. `unverifiable` keeps the environment. @stable */
export type RecoverRetainedRunResult =
  | {
      readonly outcome: 'recovered'
      readonly via: 'reattached' | 'resumed'
      readonly handle: RetainedRunHandle
    }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'unverifiable'; readonly environment: AgentEnvironment }
