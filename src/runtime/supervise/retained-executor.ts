import type { AgentProfile, WorkspaceCheckpointRef } from '@tangle-network/agent-interface'
import type {
  RetainedRunAdmission,
  RetainedRunAdmissionHook,
  RetainedRunEnvironmentAdmission,
} from '../retained-run-types'
import type {
  AgentSpec,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  ProfileMaterializationReceipt,
  SpawnEvent,
  WorkspaceCheckpointMarker,
} from './types'

/** Scope owns the durable writer; provider executors only publish sanitized admissions. */
export const retainedExecutorSeamKey = 'runtime.retainedExecutor'

export interface RetainedExecutorContext {
  /** Stable across recovery; distinct for deliberate later invocations of one owner. */
  readonly executionId?: string
  /** Prior committed environment admission to reuse for a deliberate later invocation. */
  readonly priorSession?: RetainedRunEnvironmentAdmission
  /** Keep the retained provider environment alive across deliberate invocations. */
  readonly preserveEnvironment?: boolean
  readonly admissions: readonly RetainedRunAdmission[]
  readonly onReady?: () => void | Promise<void>
  readonly onAdmission: RetainedRunAdmissionHook
  readonly onResult: (result: ExecutorResult<unknown>) => Promise<void>
  /** The checkpoint a NEW environment of this invocation starts from: set only when the provider
   *  lost the environment the previous invocation ran in, and it holds a checkpoint of it. */
  readonly restoreWorkspace?: RetainedWorkspaceRestore
  /** Receives what a restored environment held of the checkpoint's marker, before any turn is
   *  judged by it. */
  readonly onWorkspaceRestored?: (receipt: RetainedWorkspaceRestoreReceipt) => Promise<void>
}

/** A checkpoint to create the next environment from, with the marker it must hold. */
export interface RetainedWorkspaceRestore {
  readonly checkpoint: WorkspaceCheckpointRef
  readonly marker?: WorkspaceCheckpointMarker
}

/** What a restored environment was found to hold. */
export interface RetainedWorkspaceRestoreReceipt {
  readonly environmentId: string
  readonly checkpoint: WorkspaceCheckpointRef
  /** True only when the environment held the checkpoint's marker with its exact content. */
  readonly verified: boolean
  readonly detail?: string
}

export function retainedExecutorContext(ctx: ExecutorContext): RetainedExecutorContext | undefined {
  return ctx.seams[retainedExecutorSeamKey] as RetainedExecutorContext | undefined
}

/**
 * Why a retained execution has no accepted terminal result, classified where the cause is still
 * a typed value rather than a string in a journal.
 *
 * One reason string used to cover two situations that call for opposite operator responses
 * (#1204): an execution whose status genuinely cannot be determined — refusing to replace it is
 * correct, and the operator must reconcile before retrying or pay twice for one turn — and a
 * provider that broke its contract, where nothing needs reconciling and the right response is to
 * fix or report the provider. Six exhibits in three days wore the first name for the second fault.
 *
 * - `'unobservable'`: the execution may have run and nothing local can say. The safety refusal.
 *   Anything unclassifiable lands here, and so does a 4xx, a not-found, or a client deadline hit
 *   AFTER admission: the provider cannot resolve what it admitted, which is exactly the case the
 *   refusal exists for, not a rejected request.
 * - `'provider-contract'`: the provider answered with something its own contract forbids — a
 *   `RetainedRunProviderContractError` naming a broken answer (an `*_INVALID`, `*_CHANGED`,
 *   `*_DUPLICATE`, `*_MISSING` code), an event bound to another run.
 * - `'request-rejected'`: the request itself was refused BEFORE it ran — a schema violation
 *   (`ZodError`), an HTTP 4xx at admission. Never named after admission.
 * - `'transport'`: the provider or a gateway in front of it failed — an HTTP 5xx, a socket
 *   error, a platform service answering with a server error. Status is in doubt only because
 *   the transport was.
 * - `'nested-recovery'`: a nested manager's own recovery could not be reconstructed. Stated by
 *   the thrower, never inferred.
 *
 * Classification reads the cause's structure — class name, `code`, HTTP `status`, a Zod issue
 * list — never its message text, because the provider is not a dependency of this package and
 * its messages are not a contract. #1204's exhibit 3 (an event without a stable id) is delivered
 * rather than thrown since agent-provider-tangle 1.4.0, so it no longer reaches this path; its
 * exhibit 6 is typed as `JsonBoundError` (`code: 'JSON_BOUND_VIOLATION'`) since 1.5.0 and lands
 * with the schema violations. A provider still throwing plain `Error`s lands on `'unobservable'`,
 * which is the safe side.
 *
 * One `RetainedRunProviderContractError` is NOT one meaning. The runtime mints it both when the
 * provider answered wrongly and when a READ of the provider failed (`RETAINED_RESULT_READ_FAILED`,
 * `RETAINED_CONTROL_REF_READ_FAILED`). The second kind is a wrapper: what it wraps decides, in a
 * post-admission context, and a wrapper around nothing classifiable is exhibit 4.
 */
export type RetainedPendingCause =
  | 'unobservable'
  | 'provider-contract'
  | 'request-rejected'
  | 'transport'
  | 'nested-recovery'

const causeMessages: Record<RetainedPendingCause, string> = {
  unobservable: 'retained provider execution requires reconciliation before replacement',
  'provider-contract':
    'retained provider execution ended on a provider contract violation; nothing to reconcile',
  'request-rejected': 'retained provider execution was refused before it ran; nothing to reconcile',
  transport: 'retained provider execution lost its transport; status in doubt',
  'nested-recovery': 'retained nested execution requires recovery before replacement',
}

/** The contract-error codes that wrap a failed READ rather than name a broken answer. */
const readFailureCodes = new Set([
  'RETAINED_RESULT_READ_FAILED',
  'RETAINED_CONTROL_REF_READ_FAILED',
])

/** Socket-level failures, by the codes Node and undici assign, plus the Sandbox SDK's own. */
const transportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'NETWORK_ERROR',
])

function readNumber(value: object, key: string): number | undefined {
  const read: unknown = Reflect.get(value, key)
  return typeof read === 'number' && Number.isFinite(read) ? read : undefined
}

function readString(value: object, key: string): string | undefined {
  const read: unknown = Reflect.get(value, key)
  return typeof read === 'string' ? read : undefined
}

/**
 * When the cause arose relative to admission. A read wrapper, an event-stream failure and the
 * scope's own retained branch are all post-admission; only the bare admission path is not.
 */
export type RetainedPendingPhase = 'admission' | 'execution'

/**
 * Walk the cause chain (bounded, cycle-safe) and name the first cause whose structure decides.
 *
 * `phase` says whether a 4xx or a client deadline can mean "refused before it ran": only at
 * admission. After admission the same status means the provider cannot resolve what it
 * admitted, and the honest name is the refusal.
 */
export function classifyRetainedPendingCause(
  cause: unknown,
  phase: RetainedPendingPhase = 'execution',
): RetainedPendingCause {
  const seen = new Set<object>()
  const queue: Array<{ value: unknown; phase: RetainedPendingPhase }> = [{ value: cause, phase }]
  let steps = 0
  while (queue.length > 0 && steps < 12) {
    steps += 1
    const { value, phase: at } = queue.shift()!
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (value instanceof RetainedExecutionPendingError) return value.pendingCause
    const name = readString(value, 'name')
    const code = readString(value, 'code')
    const status = readNumber(value, 'status') ?? readNumber(value, 'statusCode')
    if (name === 'RetainedRunProviderContractError') {
      if (code === undefined || !readFailureCodes.has(code)) return 'provider-contract'
      // A read that failed is a wrapper; what the read hit decides, after admission.
      queue.unshift({ value: Reflect.get(value, 'cause'), phase: 'execution' })
      continue
    }
    if (
      name === 'ZodError' ||
      Array.isArray(Reflect.get(value, 'issues')) ||
      // agent-provider-tangle's bound refusal (JsonBoundError, since 1.5.0): the same fact as a
      // schema violation, typed at last — #1204's exhibit 6.
      code === 'JSON_BOUND_VIOLATION'
    ) {
      // A schema or bound violation at admission is a rejected request. After admission it is
      // the runtime refusing the PROVIDER's answer — a contract violation on the provider's side.
      return at === 'admission' ? 'request-rejected' : 'provider-contract'
    }
    if (code !== undefined && transportCodes.has(code)) return 'transport'
    if (name === 'NetworkError' || name === 'ServerError') return 'transport'
    if (status !== undefined) {
      if (status >= 500) return 'transport'
      if (at === 'admission' && status !== 408) return 'request-rejected'
      // 4xx after admission: the provider cannot resolve what it admitted. 408 is a client
      // deadline at either phase and says nothing about whether the request was admitted.
      return 'unobservable'
    }
    // An AggregateError carries its members in `errors`, with `cause` possibly the last one;
    // the first classifiable member decides.
    const errors: unknown = Reflect.get(value, 'errors')
    if (Array.isArray(errors)) for (const member of errors) queue.push({ value: member, phase: at })
    queue.push({ value: Reflect.get(value, 'cause'), phase: at })
  }
  return 'unobservable'
}

/**
 * Local observation stopped; the retained provider execution has no accepted terminal result.
 *
 * The message names WHICH of the situations in {@link RetainedPendingCause} this is, and the
 * `pendingCause` field carries it as a value the settlement records, so a reader never splits
 * the population on the message's wording. The cause chain is kept for the `caused by` receipt.
 */
export class RetainedExecutionPendingError extends Error {
  readonly pendingCause: RetainedPendingCause

  constructor(
    cause: unknown,
    pendingCause: RetainedPendingCause | RetainedPendingPhase = 'execution',
  ) {
    const resolved =
      pendingCause === 'admission' || pendingCause === 'execution'
        ? classifyRetainedPendingCause(cause, pendingCause)
        : pendingCause
    super(causeMessages[resolved], { cause })
    this.name = 'RetainedExecutionPendingError'
    this.pendingCause = resolved
  }
}

/** @internal Validated original invocation selected for live adoption by the supervisor. */
export interface RetainedChildRecovery {
  readonly spawned: Extract<SpawnEvent, { kind: 'spawned' }>
  readonly spec: AgentSpec
  readonly task: unknown
  readonly admissions: readonly RetainedRunAdmission[]
  readonly factory: ExecutorFactory<unknown>
  readonly priorMaterialization?: ProfileMaterializationReceipt
}

export interface RetainedExecutorPreparation {
  readonly spawned: Extract<SpawnEvent, { kind: 'spawned' }>
  readonly profile: AgentProfile
  readonly task: unknown
}

type PrepareRetainedExecutor = (input: RetainedExecutorPreparation) =>
  | {
      spec: AgentSpec
      factory: ExecutorFactory<unknown>
    }
  | undefined

const retainedPreparations = new WeakMap<ExecutorFactory<unknown>, PrepareRetainedExecutor>()

/** Reconstruct an admitted manager through its original composition boundary. @internal */
export function registerRetainedExecutorPreparation(
  factory: ExecutorFactory<unknown>,
  prepare: PrepareRetainedExecutor,
): ExecutorFactory<unknown> {
  retainedPreparations.set(factory, prepare)
  return factory
}

export function prepareRetainedExecutor(
  factory: ExecutorFactory<unknown>,
  input: RetainedExecutorPreparation,
) {
  return retainedPreparations.get(factory)?.(input)
}
