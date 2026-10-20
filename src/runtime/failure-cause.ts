import { defaultRedactor } from '../redact'
import { ReservationWaitRefused } from './supervise/budget'
import { isCredentialRefusal } from './supervise/credential-refusal'
import { errMessage } from './supervise/error-message'
import { PLATFORM_FAILURE_CODES } from './supervise/executor-outcome'
import {
  classifyRetainedPendingCause,
  RetainedExecutionPendingError,
  type RetainedPendingCause,
  TRANSPORT_ERROR_CODES,
} from './supervise/retained-executor'
import { UNAVAILABLE_CODES, UNAVAILABLE_STATUSES } from './supervise/upstream-unavailable'

/**
 * Who must act before the same work can succeed.
 *
 * - `provider`: the execution provider holds the answer — reconcile the admitted execution, or
 *   repair the reader or provider that broke its contract.
 * - `platform`: infrastructure or an upstream model service failed or is out of capacity.
 * - `runtime`: Runtime could not reconstruct work it owns.
 * - `work`: the agent's own work failed.
 * - `caller`: the request, its credential, its budget, its deadline, or its cancellation decided
 *   the outcome.
 * - `unknown`: nothing structural attributes the failure.
 * @stable
 */
export type RuntimeFailureOwner =
  | 'provider'
  | 'platform'
  | 'runtime'
  | 'work'
  | 'caller'
  | 'unknown'

/** Stable failure codes. A consumer branches on these, never on `cause` text. @stable */
export type RuntimeFailureCode =
  | 'aborted'
  | 'deadline-exceeded'
  | 'budget-exhausted'
  | 'credential-refused'
  | 'request-rejected'
  | 'upstream-unavailable'
  | 'transport'
  | 'provider-contract'
  | 'retained-unobservable'
  | 'nested-recovery'
  | 'platform'
  | 'work-failed'
  | 'unknown'

/**
 * A terminal failure as values, carried on final and settled events beside their existing
 * `reason` and `error` fields.
 *
 * `code` and `owner` are read from the failure's structure — its class, machine code, HTTP status
 * and cause chain, the caller's signal and deadline, or the settlement's typed fields — never from
 * message text. `cause` is the redacted, bounded cause chain for people; it is not a contract.
 * @stable
 */
export interface RuntimeFailureCause {
  readonly code: RuntimeFailureCode
  readonly owner: RuntimeFailureOwner
  readonly cause: string
  /** The upstream or provider machine code the failure carried, when it carried one. */
  readonly providerCode?: string
}

const MAX_CAUSE_CHARS = 2_048
const MAX_CHAIN_STEPS = 12

const retainedFailures: Record<
  RetainedPendingCause,
  { code: RuntimeFailureCode; owner: RuntimeFailureOwner }
> = {
  unobservable: { code: 'retained-unobservable', owner: 'provider' },
  'provider-contract': { code: 'provider-contract', owner: 'provider' },
  'request-rejected': { code: 'request-rejected', owner: 'caller' },
  transport: { code: 'transport', owner: 'platform' },
  'nested-recovery': { code: 'nested-recovery', owner: 'runtime' },
}

function boundedCause(text: string): string {
  return String(defaultRedactor(text)).slice(0, MAX_CAUSE_CHARS)
}

function read(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

/** Every object in a failure's cause chain and aggregate members, bounded and cycle-safe. */
function chain(error: unknown): object[] {
  const out: object[] = []
  const seen = new Set<object>()
  const queue: unknown[] = [error]
  while (queue.length > 0 && out.length < MAX_CHAIN_STEPS) {
    const value = queue.shift()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    const members = read(value, 'errors')
    if (Array.isArray(members)) queue.push(...members)
    queue.push(read(value, 'cause'))
  }
  return out
}

/** What the caller knows about how a failed operation ended. */
export interface RuntimeFailureContext {
  /** The caller's own signal. Aborted means the caller cancelled. */
  readonly signal?: AbortSignal
  /** The operation's own deadline expired before the caller cancelled it. */
  readonly deadlineExpired?: boolean
}

type Classified = { code: RuntimeFailureCode; owner: RuntimeFailureOwner }

const UNATTRIBUTED: Classified = { code: 'unknown', owner: 'unknown' }

/** One link's own structure: budget refusal, credential refusal, machine code, HTTP status. */
function structuralFailure(link: object): Classified | undefined {
  if (link instanceof ReservationWaitRefused || read(link, 'reason') === 'budget-exhausted') {
    return { code: 'budget-exhausted', owner: 'caller' }
  }
  if (isCredentialRefusal(link)) return { code: 'credential-refused', owner: 'caller' }
  const code = read(link, 'code')
  const status = read(link, 'status') ?? read(link, 'statusCode')
  if (typeof code === 'string' && UNAVAILABLE_CODES.has(code.toLowerCase())) {
    return { code: 'upstream-unavailable', owner: 'platform' }
  }
  if (typeof status === 'number' && Number.isInteger(status)) {
    if (UNAVAILABLE_STATUSES.has(status)) return { code: 'upstream-unavailable', owner: 'platform' }
    if (status >= 500 || status === 0 || status === 408)
      return { code: 'transport', owner: 'platform' }
    if (status === 401 || status === 403) return { code: 'credential-refused', owner: 'caller' }
    if (status >= 400) return { code: 'request-rejected', owner: 'caller' }
  }
  if (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code)) {
    return { code: 'transport', owner: 'platform' }
  }
  if (typeof code === 'string' && PLATFORM_FAILURE_CODES.has(code.toLowerCase())) {
    return { code: 'platform', owner: 'platform' }
  }
  const name = read(link, 'name')
  if (name === 'NetworkError' || name === 'ServerError')
    return { code: 'transport', owner: 'platform' }
  return undefined
}

function machineCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value)
    ? value
    : undefined
}

/**
 * Classify a thrown failure. Pass the caller's signal so a cancellation the caller asked for is
 * attributed to the caller even when the provider surfaced it as an ordinary error, and say when
 * the operation's own deadline expired so a blown deadline is never reported as a cancellation.
 */
export function runtimeFailureCause(
  error: unknown,
  context: RuntimeFailureContext = {},
): RuntimeFailureCause {
  const links = chain(error)
  let providerCode: string | undefined
  for (const link of links) {
    providerCode = machineCode(read(link, 'code'))
    if (providerCode !== undefined) break
  }
  const failure = ({ code, owner }: Classified): RuntimeFailureCause => ({
    code,
    owner,
    cause: boundedCause(errMessage(error)),
    ...(providerCode === undefined ? {} : { providerCode }),
  })
  if (context.signal?.aborted) return failure({ code: 'aborted', owner: 'caller' })
  if (context.deadlineExpired) return failure({ code: 'deadline-exceeded', owner: 'caller' })
  // Without the caller's signal, an AbortError is the only evidence of a cancellation. With it,
  // an AbortError the caller did not ask for is some other party's abort, classified below.
  if (context.signal === undefined && links.some((link) => read(link, 'name') === 'AbortError')) {
    return failure({ code: 'aborted', owner: 'caller' })
  }
  for (const link of links) {
    // A retained execution names why it has no accepted result as a value; a provider contract
    // error is classified the way the retained settlement classifies it.
    if (link instanceof RetainedExecutionPendingError) {
      return failure(retainedFailures[link.pendingCause])
    }
    if (read(link, 'name') === 'RetainedRunProviderContractError') {
      return failure(retainedFailures[classifyRetainedPendingCause(link)])
    }
  }
  for (const link of links) {
    const classified = structuralFailure(link)
    if (classified !== undefined) return failure(classified)
  }
  return failure(UNATTRIBUTED)
}

/**
 * Classify a failure the execution reported without throwing — a Sandbox outcome or executor
 * envelope with `success: false` — from its machine code and HTTP status. A harness that reports
 * a failure with neither does not say who must act, so it is `unknown`, never the work's fault.
 */
export function reportedFailureCause(outcome: {
  readonly error?: string
  readonly errorCode?: string
  readonly statusCode?: number
}): RuntimeFailureCause {
  const providerCode = machineCode(outcome.errorCode)
  const classified =
    structuralFailure({
      ...(outcome.errorCode === undefined ? {} : { code: outcome.errorCode }),
      ...(outcome.statusCode === undefined ? {} : { status: outcome.statusCode }),
    }) ?? UNATTRIBUTED
  return {
    ...classified,
    cause: boundedCause(outcome.error ?? 'execution reported a failure'),
    ...(providerCode === undefined ? {} : { providerCode }),
  }
}

/**
 * Classify a down settlement from the typed facts Runtime recorded while the cause was still a
 * value: the retained cause, the failure classified where the executor threw, then `infra: false`,
 * the throw path's statement that the work itself failed. `infra: true` is not an owner: Runtime
 * also sets it for cancellations, budget reconcile faults and validation errors, and from the
 * platform's failure messages, so a settlement with nothing else typed is `unknown`.
 */
export function settlementFailureCause(down: {
  readonly reason: string
  readonly infra?: boolean
  readonly retainedPendingCause?: RetainedPendingCause
  readonly failure?: RuntimeFailureCause
}): RuntimeFailureCause {
  const cause = boundedCause(down.reason)
  if (down.retainedPendingCause !== undefined) {
    return { ...retainedFailures[down.retainedPendingCause], cause }
  }
  const providerCode = down.failure?.providerCode
  const recorded: Classified =
    down.failure !== undefined && down.failure.code !== 'unknown'
      ? { code: down.failure.code, owner: down.failure.owner }
      : down.infra === false
        ? { code: 'work-failed', owner: 'work' }
        : UNATTRIBUTED
  return {
    ...recorded,
    cause,
    ...(providerCode === undefined ? {} : { providerCode }),
  }
}
