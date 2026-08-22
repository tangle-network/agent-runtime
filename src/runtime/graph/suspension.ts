/**
 * Suspensions (agent-runtime#976): a node parks on a host wake as the kernel's `waiting`/`woken`
 * pair. The engine owns the transition table; a host owns only how the wake arrives.
 */
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'

const SUSPEND_MARK = '__graphSuspension'

/** What a kind's executor returns to park its node until a host wakes it. */
export interface SuspensionRequest {
  readonly [SUSPEND_MARK]: true
  readonly onExpire: 'wait' | 'fail' | 'default'
  /** Milliseconds from the suspension's journaling instant; absent with `onExpire: 'wait'`. */
  readonly expiresInMs?: number
  readonly default?: unknown
}

/** Build a suspension request. `wait` never expires; `fail` settles the node down at its deadline;
 *  `default` resolves with the given payload. */
export function suspended(
  options: {
    readonly onExpire?: 'wait' | 'fail' | 'default'
    readonly expiresInMs?: number
    readonly default?: unknown
  } = {},
): SuspensionRequest {
  const onExpire = options.onExpire ?? 'wait'
  if (onExpire !== 'wait' && options.expiresInMs === undefined) {
    throw new ValidationError(`suspended: onExpire '${onExpire}' requires expiresInMs`)
  }
  if (onExpire === 'wait' && options.expiresInMs !== undefined) {
    throw new ValidationError("suspended: onExpire 'wait' never expires — remove expiresInMs")
  }
  if (onExpire === 'default' && options.default === undefined) {
    throw new ValidationError("suspended: onExpire 'default' requires a default payload")
  }
  return {
    [SUSPEND_MARK]: true,
    onExpire,
    ...(options.expiresInMs !== undefined ? { expiresInMs: options.expiresInMs } : {}),
    ...(options.default !== undefined ? { default: options.default } : {}),
  }
}

/** Whether a node's output is a park request rather than its result. */
export function isSuspensionRequest(value: unknown): value is SuspensionRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[SUSPEND_MARK] === true
  )
}

/** Content-addressed over the run identity, so a restart recomputes it and needs no token table. */
export function mintSuspensionToken(runId: string, instance: string): string {
  return contentAddress({ runId, instance, kind: 'graph-suspension' })
}

/** The journal id one suspension's `waiting`/`woken` pair shares. */
export function suspensionNodeId(token: string): string {
  return `graphwait:${token}`
}

/** The token inside a suspension node id, or `undefined` for any other id. */
export function tokenFromSuspensionNodeId(id: string): string | undefined {
  return id.startsWith('graphwait:') ? id.slice('graphwait:'.length) : undefined
}
