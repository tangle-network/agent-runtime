import { type AgentProfile, validateAgentProfileSecurity } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  GraphSubtasks,
  MakeWorkerAgent,
  WorkerSpawnContext,
} from '../../mcp/tools/coordination-contracts'
import type { GraphOverlay } from './graph-overlay'
import type { GraphSubtaskTopology, validateGraphSubtask } from './graph-topology'
import { assertProfileModelsAllowed } from './model-policy'
import type { RunCancelRequest } from './run-cancellation'
import { authoredSeatStages } from './seat-chain'
import { canonicalExecution, freezeDetached, freezeDetachedProfile } from './supervise-identity'
import { captureDeliverable } from './supervise-option-capture'
import type { AuthorizedSpawnContext } from './supervise-options'
import { isExternalSupervisor } from './supervise-profile-admission'
import type { prepareSuperviseRun } from './supervise-run-setup'
import { spawnModelSubstitution } from './supervise-worker-backend'
import { declaredRuntimeToolNames } from './supervisor-agent'
import type { ExecutorFactory, NodeExecutionIdentity } from './types'

/** What every worker factory of one run shares: the run's setup and the leaf/graph seams it built. */
export interface WorkerTreeEnv {
  readonly setup: ReturnType<typeof prepareSuperviseRun>
  readonly cancelDurableRun: (reason: string, request?: RunCancelRequest) => void
  readonly graphSubtasks: GraphSubtasks | undefined
  readonly graphOverlayFor: (topology: GraphSubtaskTopology) => {
    overlay: GraphOverlay
    validated: ReturnType<typeof validateGraphSubtask>
  }
  readonly recoveryFactories: WeakMap<MakeWorkerAgent, ExecutorFactory<unknown>>
  readonly withRetry: (make: MakeWorkerAgent) => MakeWorkerAgent
  readonly makeLeaf: MakeWorkerAgent
  readonly securityPolicy: Parameters<typeof validateAgentProfileSecurity>[1]
}

/** The parent a worker factory spawns for: its profile, identity, depth and owning graph. */
export interface ParentSeat {
  readonly parent: AgentProfile
  readonly parentIdentity: NodeExecutionIdentity
  readonly depth: number
  readonly parentOwnerId: string
  readonly analystLineage: boolean
  readonly peerRootOwnerId?: string
  /** The graph this parent's subtree belongs to, when it is part of a `run_graph` subtask. */
  readonly graph?: GraphOverlay
}

/** A spawn after authorization, security, model-policy and deliverable decisions. */
export interface AdmittedSpawn {
  readonly authorized: AgentProfile
  readonly modelSubstitution: ReturnType<typeof spawnModelSubstitution>
  readonly childExecution: ReturnType<typeof canonicalExecution>
  readonly authorizedContext: WorkerSpawnContext
  readonly selectedDeliverable: ReturnType<
    NonNullable<ReturnType<typeof prepareSuperviseRun>['options']['resolveDeliverable']>
  >
  readonly childDeliverable: ReturnType<typeof captureDeliverable> | undefined
  /** A Runtime tool grant (or an authored seat chain) makes this a managed persistent node. */
  readonly seatManagedLeaf: boolean
  readonly usesRuntimeCoordination: boolean
}

/** Authorize one spawn and decide everything about it that does not depend on how it runs. */
export function admitSpawn(
  env: WorkerTreeEnv,
  seat: ParentSeat,
  authoredProfile: AgentProfile,
  spawnContext: WorkerSpawnContext,
  recovering: boolean,
): AdmittedSpawn {
  const { options, applyTraceTools, deliverable } = env.setup
  const { parent, parentIdentity, depth } = seat
  const input = freezeDetachedProfile(authoredProfile)
  const spawnFacts = {
    parent,
    parentIdentity,
    parentNodeId: spawnContext.parentNodeId,
    assignmentId: spawnContext.assignmentId,
    task: spawnContext.task,
    budget: spawnContext.budget,
    label: spawnContext.label,
    ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
    depth,
  }
  const authorizationInput = Object.freeze({
    profile: input,
    ...spawnFacts,
    ...(spawnContext.analyst !== undefined ? { analyst: spawnContext.analyst } : {}),
    ...(spawnContext.map !== undefined ? { map: spawnContext.map } : {}),
    ...(spawnContext.route !== undefined ? { route: spawnContext.route } : {}),
    ...(spawnContext.continuity !== undefined ? { continuity: spawnContext.continuity } : {}),
  })
  // Recovery reconstructs the admitted authority; authorization cannot replace it. Inside a
  // graph subtask the graph pins each spawn first and hands the pinned profile to the run's
  // own authority, as `runGraph` does for a run's root graph.
  const authorize = seat.graph?.authorizeSpawn ?? options.authorizeSpawn
  const decision =
    !recovering && authorize
      ? freezeDetached(authorize(authorizationInput))
      : Object.freeze({
          profile: input,
          ...(spawnContext.execution ? { execution: spawnContext.execution } : {}),
        })
  if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
    throw new ValidationError('supervise: authorizeSpawn must return an AuthorizedSpawn')
  }
  const authorized = freezeDetachedProfile(applyTraceTools(decision.profile))
  const modelSubstitution = spawnModelSubstitution(input, authorized)
  const childExecution = canonicalExecution(
    authorized,
    spawnContext.task,
    decision.execution,
    `supervise spawn ${JSON.stringify(spawnContext.label)}`,
  )
  const authorizedContext = Object.freeze({
    ...spawnContext,
    ...(childExecution.ref ? { execution: childExecution.ref } : {}),
  })
  // `resolveDeliverable` callers may serialize this, so its key order is part of the contract.
  const postAuthorizationContext: AuthorizedSpawnContext = freezeDetached({
    profile: authorized,
    parent,
    parentIdentity,
    execution: childExecution.identity,
    parentNodeId: spawnContext.parentNodeId,
    assignmentId: spawnContext.assignmentId,
    task: spawnContext.task,
    budget: spawnContext.budget,
    label: spawnContext.label,
    ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
    depth,
  })
  const security = validateAgentProfileSecurity(authorized, env.securityPolicy)
  if (!security.ok) {
    const details = security.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
      .join(', ')
    throw new ValidationError(`supervise: spawned AgentProfile refused: ${details}`)
  }
  assertProfileModelsAllowed(authorized, options.allowedModels)
  const selectedDeliverable = options.resolveDeliverable?.(postAuthorizationContext)
  const childDeliverable =
    selectedDeliverable === undefined
      ? deliverable
      : selectedDeliverable === null
        ? undefined
        : captureDeliverable(
            selectedDeliverable,
            `supervise deliverable for ${JSON.stringify(spawnContext.label)}`,
          )
  const seatManagedLeaf =
    authoredSeatStages(authorized) !== undefined &&
    declaredRuntimeToolNames(authorized).length === 0 &&
    isExternalSupervisor(authorized)
  return {
    authorized,
    modelSubstitution,
    childExecution,
    authorizedContext,
    selectedDeliverable,
    childDeliverable,
    seatManagedLeaf,
    usesRuntimeCoordination: declaredRuntimeToolNames(authorized).length > 0 || seatManagedLeaf,
  }
}
