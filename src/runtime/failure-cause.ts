import { defaultRedactor } from '../redact'
import { ReservationWaitRefused } from './supervise/budget'
import { isCredentialRefusal } from './supervise/credential-refusal'
import { errMessage } from './supervise/error-message'
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
 * - `caller`: the request, its credential, its budget, or its cancellation decided the outcome.
 * - `unknown`: nothing structural attributes the failure.
 * @stable
 */
export type RuntimeFailureOwner = 'provider' | 'platform' | 'runtime' | 'work' | 'caller' | 'unknown'

/** Stable failure codes. A consumer branches on these, never on `cause` text. @stable */
export type RuntimeFailureCode =
  | 'aborted'
  | 'budget-exhausted'
  | 'credential-refused'
  | 'request-rejected'
  | 'upstream-unavailable'
  | 'transport'
  | 'provider-contract'
  | 'terminal-event-lost'
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
 * and cause chain, or the settlement's typed fields — never from message text. `cause` is the
 * redacted, bounded cause chain for people; it is not a contract.
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
  'terminal-event-lost': { code: 'terminal-event-lost', owner: 'provider' },
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

/**
 * Classify a thrown failure. Pass the caller's signal so a cancellation the caller asked for is
 * attributed to the caller even when the provider surfaced it as an ordinary error.
 */
export function runtimeFailureCause(error: unknown, signal?: AbortSignal): RuntimeFailureCause {
  const links = chain(error)
  let providerCode: string | undefined
  for (const link of links) {
    const code = read(link, 'code')
    if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(code)) {
      providerCode = code
      break
    }
  }
  const failure = (code: RuntimeFailureCode, owner: RuntimeFailureOwner): RuntimeFailureCause => ({
    code,
    owner,
    cause: boundedCause(errMessage(error)),
    ...(providerCode === undefined ? {} : { providerCode }),
  })
  if (signal?.aborted || links.some((link) => read(link, 'name') === 'AbortError')) {
    return failure('aborted', 'caller')
  }
  for (const link of links) {
    // A retained execution names why it has no accepted result as a value; a provider contract
    // error is classified the way the retained settlement classifies it.
    if (link instanceof RetainedExecutionPendingError) {
      const typed = retainedFailures[link.pendingCause]
      return failure(typed.code, typed.owner)
    }
    if (read(link, 'name') === 'RetainedRunProviderContractError') {
      const typed = retainedFailures[classifyRetainedPendingCause(link)]
      return failure(typed.code, typed.owner)
    }
  }
  for (const link of links) {
    if (link instanceof ReservationWaitRefused || read(link, 'reason') === 'budget-exhausted') {
      return failure('budget-exhausted', 'caller')
    }
    if (isCredentialRefusal(link)) return failure('credential-refused', 'caller')
    const code = read(link, 'code')
    const status = read(link, 'status') ?? read(link, 'statusCode')
    if (typeof code === 'string' && UNAVAILABLE_CODES.has(code.toLowerCase())) {
      return failure('upstream-unavailable', 'platform')
    }
    if (typeof status === 'number' && Number.isInteger(status)) {
      if (UNAVAILABLE_STATUSES.has(status)) return failure('upstream-unavailable', 'platform')
      if (status >= 500 || status === 0) return failure('transport', 'platform')
      if (status === 401 || status === 403) return failure('credential-refused', 'caller')
      if (status >= 400 && status !== 408) return failure('request-rejected', 'caller')
      if (status === 408) return failure('transport', 'platform')
    }
    if (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code)) {
      return failure('transport', 'platform')
    }
    const name = read(link, 'name')
    if (name === 'NetworkError' || name === 'ServerError') return failure('transport', 'platform')
  }
  return failure('unknown', 'unknown')
}

/**
 * Classify a down settlement from the typed fields Runtime recorded when the cause was still a
 * value: the retained cause, then the platform attribution (`infra`).
 */
export function settlementFailureCause(down: {
  readonly reason: string
  readonly infra?: boolean
  readonly retainedPendingCause?: RetainedPendingCause
}): RuntimeFailureCause {
  const cause = boundedCause(down.reason)
  if (down.retainedPendingCause !== undefined) {
    return { ...retainedFailures[down.retainedPendingCause], cause }
  }
  if (down.infra === true) return { code: 'platform', owner: 'platform', cause }
  if (down.infra === false) return { code: 'work-failed', owner: 'work', cause }
  return { code: 'unknown', owner: 'unknown', cause }
}
