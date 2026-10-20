import { canonicalCandidateDigest, sha256DigestSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { authoredProfileDigest } from './materialization'
import type { AgentSpec, NodeExecutionIdentity, RecursiveReservationPolicy } from './types'

/** Fail before execution when a reservation policy is malformed. */
export function assertRecursiveReservationPolicy(
  policy: RecursiveReservationPolicy | undefined,
): void {
  if (policy === undefined) return
  if (
    typeof policy !== 'object' ||
    policy === null ||
    Object.keys(policy).some((key) => key !== 'ownerShare')
  ) {
    throw new ValidationError('reservationPolicy accepts only ownerShare')
  }
  if (!Number.isFinite(policy.ownerShare) || policy.ownerShare <= 0 || policy.ownerShare >= 1) {
    throw new ValidationError('reservationPolicy.ownerShare must be greater than 0 and less than 1')
  }
}

export function deriveNodeExecutionIdentity(
  spec: Pick<AgentSpec, 'profile' | 'execution'>,
  task: unknown,
): NodeExecutionIdentity | undefined {
  const digest = (value: unknown) => {
    try {
      return canonicalCandidateDigest(value)
    } catch {
      return undefined
    }
  }
  const profileDigest = authoredProfileDigest(spec.profile)
  const taskDigest = digest(task)
  const candidateDigest = spec.execution?.candidateDigest
  if (candidateDigest !== undefined && !sha256DigestSchema.safeParse(candidateDigest).success) {
    throw new ValidationError('scope.spawn: execution.candidateDigest must be a sha256 digest')
  }
  const correlation = freezeCorrelation(spec.execution?.correlation)
  if (!profileDigest && !taskDigest && !candidateDigest && !correlation) return undefined
  return Object.freeze({
    ...(profileDigest ? { profileDigest } : {}),
    ...(taskDigest ? { taskDigest } : {}),
    ...(candidateDigest ? { candidateDigest } : {}),
    ...(correlation ? { correlation } : {}),
  })
}

export function isCompleteIdentity(
  identity: NodeExecutionIdentity | undefined,
): identity is NodeExecutionIdentity & {
  readonly profileDigest: string
  readonly taskDigest: string
} {
  return identity?.profileDigest !== undefined && identity.taskDigest !== undefined
}

export function sameNodeExecutionIdentity(
  a: NodeExecutionIdentity,
  b: NodeExecutionIdentity,
): boolean {
  return canonicalCandidateDigest(a) === canonicalCandidateDigest(b)
}

function freezeCorrelation(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('scope.spawn: execution.correlation must be a string record')
  }
  const entries = Object.entries(value)
  for (const [key, item] of entries) {
    if (key.length === 0 || typeof item !== 'string' || item.length === 0) {
      throw new ValidationError(
        'scope.spawn: execution.correlation keys and values must be non-empty strings',
      )
    }
  }
  return Object.freeze(Object.fromEntries(entries))
}

/** An `AgentSpec` is identified structurally — it carries a `profile` and a `harness`
 *  field (`null` or a `BackendType`) and optionally an `executor`. */
export function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'profile' in v && 'harness' in v
}
