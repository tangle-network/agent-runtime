import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { CoordinationEvent, WorkerSpawnContext } from '../../mcp/tools/coordination'
import { deriveNodeExecutionIdentity } from './scope'
import { detachedSnapshot } from './snapshot'
import type { SupervisorNodeContext } from './supervisor-agent'
import type { AgentExecutionRef, NodeExecutionIdentity } from './types'

export function externalExecutionId(kind: string, identity: unknown): string {
  const digest = canonicalCandidateDigest({ kind, identity })
  return `${kind}-${digest.slice('sha256:'.length)}`
}

export function freezeDetached<T>(value: T): T {
  return detachedSnapshot(value, 'supervise')
}

export function freezeDetachedProfile(value: unknown): AgentProfile {
  return freezeDetached(agentProfileSchema.parse(value))
}

export function canonicalExecution(
  profile: AgentProfile,
  task: unknown,
  rawExecution: AgentExecutionRef | undefined,
  context: string,
): { readonly identity: NodeExecutionIdentity; readonly ref?: AgentExecutionRef } {
  const execution = rawExecution === undefined ? undefined : freezeDetached(rawExecution)
  if (execution !== undefined) {
    if (typeof execution !== 'object' || execution === null || Array.isArray(execution)) {
      throw new ValidationError(`${context}: execution must be an object`)
    }
    const unknown = Object.keys(execution).filter(
      (key) => key !== 'candidateDigest' && key !== 'correlation',
    )
    if (unknown.length > 0) {
      throw new ValidationError(`${context}: unknown execution fields: ${unknown.join(', ')}`)
    }
  }
  const identity = deriveNodeExecutionIdentity({ profile, execution }, task)
  if (!identity?.profileDigest || !identity.taskDigest) {
    throw new ValidationError(
      `${context}: profile and task must be finite, acyclic canonical JSON for durable identity`,
    )
  }
  const ref: AgentExecutionRef | undefined =
    identity.candidateDigest || identity.correlation
      ? Object.freeze({
          ...(identity.candidateDigest ? { candidateDigest: identity.candidateDigest } : {}),
          ...(identity.correlation ? { correlation: identity.correlation } : {}),
        })
      : undefined
  return { identity, ...(ref ? { ref } : {}) }
}

export function rootCoordinationOwner(identity: NodeExecutionIdentity): string {
  return canonicalCandidateDigest({ kind: 'supervisor-root', identity })
}

export function childCoordinationOwner(
  parentOwnerId: string,
  identity: NodeExecutionIdentity,
  context: WorkerSpawnContext,
  depth: number,
): string {
  return canonicalCandidateDigest({
    kind: 'supervisor-child',
    parentOwnerId,
    identity,
    assignment: {
      id: context.assignmentId,
      label: context.label,
      key: context.key ?? null,
      depth,
    },
  })
}

export function supervisionRunNamespace(runDir: string | undefined, runId: string): string {
  return canonicalCandidateDigest(
    runDir === undefined
      ? { kind: 'supervise-ephemeral-run', runId, nonce: randomUUID() }
      : { kind: 'supervise-durable-run', runId, runDir: resolve(runDir) },
  )
}

export function workerAssignmentNamespace(
  runNamespace: string,
  parentOwnerId: string,
  assignmentId: string,
): string {
  return canonicalCandidateDigest({
    kind: 'supervise-worker-assignment',
    runNamespace,
    parentOwnerId,
    assignmentId,
  })
}

/** Hash only durable coordination meaning. Bus sequence/timestamp are delivery metadata and a
 * resumed projection's marker describes the reader, not the original settlement. */
export function coordinationEventId(
  context: SupervisorNodeContext,
  event: CoordinationEvent,
): Sha256Digest {
  const durableEvent =
    event.type === 'settled' && event.worker.resumed === true
      ? (() => {
          const { resumed: _resumed, ...worker } = event.worker
          return { type: 'settled' as const, worker }
        })()
      : event
  return canonicalCandidateDigest({
    kind: 'supervise-coordination-event',
    runNamespace: context.runNamespace,
    ownerId: context.ownerId,
    event: detachedSnapshot(durableEvent, 'supervise coordination event identity'),
  })
}
