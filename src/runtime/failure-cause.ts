import { z } from 'zod'
import { BackendTransportError } from '../errors'
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

const MAX_CAUSE_CHARS = 2_048
const MAX_CHAIN_STEPS = 12
const MACHINE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u

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
export type RuntimeFailureOwner = RuntimeFailureCause['owner']

/** Stable failure codes. A consumer branches on these, never on `cause` text. @stable */
export type RuntimeFailureCode = RuntimeFailureCause['code']

/** @internal Canonical producer-supplied remediation, shared by transport and read models. */
export const runtimeFailureRemediationSchema = z.object({
  cause: z.enum([
    'api_key_selected',
    'provider_unresolved',
    'subscription_unverified',
    'not_authenticated',
  ]),
  fix: z.string().min(1).max(256),
  harness: z.string().min(1).max(64),
  provider: z.string().min(1).max(128).nullable(),
})

/** @internal Validate Runtime-owned failure values on observation transports. */
export const runtimeFailureCauseSchema = z
  .object({
    code: z.enum([
      'aborted',
      'deadline-exceeded',
      'budget-exhausted',
      'credential-refused',
      'request-rejected',
      'upstream-unavailable',
      'transport',
      'provider-contract',
      'retained-unobservable',
      'nested-recovery',
      'platform',
      'work-failed',
      'unknown',
    ]),
    owner: z.enum(['provider', 'platform', 'runtime', 'work', 'caller', 'unknown']),
    cause: z.string().max(MAX_CAUSE_CHARS),
    /** The upstream or provider machine code the failure carried, when it carried one. */
    providerCode: z.string().regex(MACHINE_CODE_PATTERN).optional(),
    remediation: runtimeFailureRemediationSchema.readonly().optional(),
  })
  .readonly()
/**
 * A terminal failure as values, carried on final and settled events beside their existing
 * `reason` and `error` fields.
 *
 * `code` and `owner` are read from the failure's structure — its class, machine code, HTTP status
 * and cause chain, the caller's signal and deadline, or the settlement's typed fields — never from
 * message text. `cause` is the redacted, bounded cause chain for people; it is not a contract.
 * @stable
 * @useDeclaredType
 */
export type RuntimeFailureCause = z.infer<typeof runtimeFailureCauseSchema>

const retainedFailures: Record<RetainedPendingCause, Classified> = {
  unobservable: { code: 'retained-unobservable', owner: 'provider' },
  'provider-contract': { code: 'provider-contract', owner: 'provider' },
  'request-rejected': { code: 'request-rejected', owner: 'caller' },
  transport: { code: 'transport', owner: 'platform' },
  'nested-recovery': { code: 'nested-recovery', owner: 'runtime' },
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
  const queue: unknown[] = [error]
  while (queue.length > 0 && out.length < MAX_CHAIN_STEPS) {
    const value = queue.shift()
    if (typeof value !== 'object' || value === null || out.includes(value)) continue
    out.push(value)
    const members = read(value, 'errors')
    if (Array.isArray(members)) {
      const limit = Math.min(members.length, MAX_CHAIN_STEPS)
      for (let index = 0; index < limit; index++) queue.push(read(members, String(index)))
    }
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
  const code = upstreamMachineCode([link])
  if (isCredentialRefusal(link) || code === 'SEAT_NOT_LOGGED_IN')
    return { code: 'credential-refused', owner: 'caller' }
  const status = read(link, 'status') ?? read(link, 'statusCode')
  if (code === 'MODEL_NOT_FOUND') return { code: 'request-rejected', owner: 'caller' }
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

/** @internal The same machine-code validation used by public failure values. */
export function runtimeProviderCode(value: unknown): string | undefined {
  return typeof value === 'string' && MACHINE_CODE_PATTERN.test(value) ? value : undefined
}

function upstreamMachineCode(links: readonly object[]): string | undefined {
  return ['upstreamCode', 'errorCode', 'code']
    .flatMap((field) => links.map((link) => runtimeProviderCode(read(link, field))))
    .find((code) => code !== undefined)
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
  const cause = errMessage(error).slice(0, MAX_CAUSE_CHARS)
  const caller = context.signal?.aborted
    ? 'aborted'
    : context.deadlineExpired
      ? 'deadline-exceeded'
      : undefined
  try {
    const links = chain(error)
    // Prefer an upstream diagnosis across the whole chain over a wrapper's generic code.
    const providerCode = upstreamMachineCode(links)
    const upstream = links.find(
      (link) =>
        link instanceof BackendTransportError &&
        link.backend === 'bridge' &&
        link.status === 403 &&
        link.upstreamCode === 'subscription_required' &&
        link.providerDispatch === 'not_started',
    ) as BackendTransportError | undefined
    const remedy = runtimeFailureRemediationSchema.readonly().safeParse(upstream?.remediation)
    const failure = ({ code, owner }: Classified): RuntimeFailureCause => ({
      code,
      owner,
      cause,
      ...(providerCode === undefined ? {} : { providerCode }),
      ...(code === 'credential-refused' &&
      providerCode === 'subscription_required' &&
      remedy.success
        ? { remediation: remedy.data }
        : {}),
    })
    if (caller !== undefined) return failure({ code: caller, owner: 'caller' })
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
  } catch {
    // Foreign arrays, proxies and prototype checks cannot replace the original rejection.
    return { ...(caller === undefined ? UNATTRIBUTED : { code: caller, owner: 'caller' }), cause }
  }
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
  return runtimeFailureCause(
    Object.assign(new Error(outcome.error ?? 'execution reported a failure'), {
      errorCode: outcome.errorCode,
      statusCode: outcome.statusCode,
    }),
  )
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
  const cause = errMessage(down.reason).slice(0, MAX_CAUSE_CHARS)
  if (down.retainedPendingCause !== undefined) {
    return { ...retainedFailures[down.retainedPendingCause], cause }
  }
  if (down.failure !== undefined && down.failure.code !== 'unknown')
    return { ...down.failure, cause }
  return {
    ...(down.infra === false
      ? { code: 'work-failed' as const, owner: 'work' as const }
      : UNATTRIBUTED),
    cause,
    ...(down.failure?.providerCode === undefined
      ? {}
      : { providerCode: down.failure.providerCode }),
  }
}
