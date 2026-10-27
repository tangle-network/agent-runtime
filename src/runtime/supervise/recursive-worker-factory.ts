import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type ProfileMaterializationContract,
  promptModelProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { driverChild, driverExecutorFactory, isDriverSpec } from './driver-executor'
import { buildNestedManagerDeps, type ManagedChild } from './nested-manager-deps'
import { registerRetainedExecutorPreparation } from './retained-executor'
import { createExecutor, type ExecutorConfig } from './runtime'
import {
  type AdmittedSpawn,
  admitSpawn,
  type ParentSeat,
  type WorkerTreeEnv,
} from './spawn-admission'
import { graphSubtaskOutput } from './supervise-graph-subtasks'
import {
  childCoordinationOwner,
  freezeDetached,
  workerAssignmentNamespace,
} from './supervise-identity'
import {
  assertBridgeProfileMaterializes,
  assertProfileContract,
  isExternalSupervisor,
} from './supervise-profile-admission'
import { withModelSubstitution, workerFromBackend } from './supervise-worker-backend'
import {
  ownSubmissionDeliverable,
  providerVisibleProfile,
  supervisorAgent,
  supervisorAgentWithTestBrain,
} from './supervisor-agent'
import type { Agent, AgentSpec } from './types'

/** The factory that spawns the children of one parent seat, leaf or managed. */
export function recursiveWorkerFactoryFor(env: WorkerTreeEnv, seat: ParentSeat): MakeWorkerAgent {
  const makeRecursiveWorker = (
    authoredProfile: AgentProfile,
    spawnContext: WorkerSpawnContext | undefined,
    recovering = false,
  ): ReturnType<MakeWorkerAgent> => {
    if (!spawnContext) {
      throw new ValidationError('supervise: backend-derived workers require spawn context')
    }
    const admitted = admitSpawn(env, seat, authoredProfile, spawnContext, recovering)
    return admitted.usesRuntimeCoordination
      ? managedWorker(env, seat, admitted, spawnContext)
      : leafWorker(env, seat, admitted, spawnContext)
  }
  registerRecovery(env, makeRecursiveWorker)
  return makeRecursiveWorker
}

function leafWorker(
  env: WorkerTreeEnv,
  seat: ParentSeat,
  admitted: AdmittedSpawn,
  spawnContext: WorkerSpawnContext,
): ReturnType<MakeWorkerAgent> {
  const { options, deliverable, runNamespace } = env.setup
  const { childDeliverable } = admitted
  if (childDeliverable !== deliverable && !options.backend) {
    throw new ValidationError(
      'supervise: resolveDeliverable selected a per-spawn deliverable but there is no backend to derive that leaf from; makeLeafAgent owns its own completion check',
    )
  }
  const makeSelectedLeaf =
    childDeliverable === deliverable
      ? env.makeLeaf
      : env.withRetry(workerFromBackend(options.backend as ExecutorConfig, childDeliverable))
  return withModelSubstitution(
    makeSelectedLeaf(
      admitted.authorized,
      Object.freeze({
        ...admitted.authorizedContext,
        assignmentId: workerAssignmentNamespace(
          runNamespace,
          seat.parentOwnerId,
          spawnContext.assignmentId,
        ),
      }),
    ),
    admitted.modelSubstitution,
  )
}

/** A coordinating child: a nested manager under the run's authority, wrapped as a driver node. */
function managedWorker(
  env: WorkerTreeEnv,
  seat: ParentSeat,
  admitted: AdmittedSpawn,
  spawnContext: WorkerSpawnContext,
): ReturnType<MakeWorkerAgent> {
  const { options, journal } = env.setup
  const { authorized, childExecution } = admitted
  const ownerId = childCoordinationOwner(
    seat.parentOwnerId,
    childExecution.identity,
    spawnContext,
    seat.depth,
  )
  const { ownGraph, subtreeGraph, ownFlow } = admitted.subtree
  // Judge the child’s submission locally; the run’s check judges the composed result.
  const ownSubmission =
    admitted.selectedDeliverable === undefined &&
    (subtreeGraph !== undefined || env.setup.deliverable !== undefined)
  const driveHarness = admitDriverSeat(env, seat, admitted, spawnContext, ownerId)
  const rootPeerOwner = options.peerAudit
    ? seat.depth === 1
      ? ownerId
      : seat.peerRootOwnerId
    : undefined
  const child: ManagedChild = {
    env,
    seat,
    admitted,
    spawnContext,
    ownerId,
    rootPeerOwner,
    childFactory: recursiveWorkerFactoryFor(env, {
      parent: authorized,
      parentIdentity: childExecution.identity,
      depth: seat.depth + 1,
      parentOwnerId: ownerId,
      analystLineage:
        seat.analystLineage ||
        spawnContext.analyst !== undefined ||
        spawnContext.assignmentId.startsWith('analyst:'),
      peerRootOwnerId: rootPeerOwner,
      graph: subtreeGraph,
    }),
    driveHarness,
    subtreeGraph,
    ownFlow,
    managerDeliverable: ownSubmission ? ownSubmissionDeliverable : admitted.childDeliverable,
    ownSubmission,
    acceptedSubmission: false,
    unassessedOutput: false,
  }
  const deps = buildNestedManagerDeps(child)
  const nested =
    ownFlow === undefined
      ? supervisorAgent(authorized, deps)
      : supervisorAgentWithTestBrain(authorized, {
          ...deps,
          brain: ownFlow.brain,
          routeFlow: ownFlow.route,
          finalizer: ownFlow.run.finalizer,
          // A flow root's wake batches nothing for a decision.
          wake: { debounceMs: 0, ...options.wake },
        })
  return withModelSubstitution(
    driverChild(
      authorized,
      nested,
      journal,
      childExecution.ref,
      () => child.acceptedSubmission,
      env.recoveryFactories.get(child.childFactory),
      () => child.unassessedOutput,
      admitted.seatManagedLeaf ? child.managerDeliverable : undefined,
      ownGraph ? (out) => graphSubtaskOutput(ownGraph, out, ownFlow?.run.failure) : undefined,
    ),
    admitted.modelSubstitution,
  )
}

/** Resolve the driver harness an external manager needs and check the profile contract it runs under. */
function admitDriverSeat(
  env: WorkerTreeEnv,
  seat: ParentSeat,
  admitted: AdmittedSpawn,
  spawnContext: WorkerSpawnContext,
  ownerId: string,
) {
  const { authorized } = admitted
  const { runId, runNamespace, driveHarnessForOwner, driverMaterialization, managerBackend } =
    env.setup
  const driveHarness = isExternalSupervisor(authorized)
    ? driveHarnessForOwner(
        freezeDetached({
          runId,
          runNamespace,
          ownerId,
          depth: seat.depth,
          identity: admitted.childExecution.identity,
          assignmentId: spawnContext.assignmentId,
          profile: authorized,
          task: spawnContext.task,
        }),
      )
    : undefined
  if (isExternalSupervisor(authorized) && !driveHarness) {
    throw new ValidationError(
      `supervise: authored external supervisor profile.harness=${JSON.stringify(authorized.harness)} requires a local bridge, a provider with authenticated coordination.publicUrl and runtime MCP attachments, or an explicit driveHarness with reachable coordination transport`,
    )
  }
  assertProfileContract(
    authorized,
    isExternalSupervisor(authorized)
      ? (driverMaterialization as ProfileMaterializationContract)
      : promptModelProfileMaterialization,
    `supervise driver ${JSON.stringify(spawnContext.label)}`,
    true,
  )
  if (managerBackend) {
    assertBridgeProfileMaterializes(
      providerVisibleProfile(authorized),
      managerBackend,
      `supervise driver ${JSON.stringify(spawnContext.label)}`,
    )
  }
  return driveHarness
}

/** A retained provider run is rebuilt through this factory after a restart. */
function registerRecovery(
  env: WorkerTreeEnv,
  makeRecursiveWorker: (
    ...args: [...Parameters<MakeWorkerAgent>, recovering?: boolean]
  ) => ReturnType<MakeWorkerAgent>,
): void {
  const { options } = env.setup
  if (
    options.makeLeafAgent !== undefined ||
    options.backend?.backend !== 'provider' ||
    options.backend.steering
  ) {
    return
  }
  const factory = registerRetainedExecutorPreparation(
    createExecutor(options.backend),
    ({ spawned, profile, task }) => {
      if (!spawned.parent || !spawned.assignmentId || !spawned.identity) return undefined
      const execution = {
        ...(spawned.identity.candidateDigest
          ? { candidateDigest: spawned.identity.candidateDigest }
          : {}),
        ...(spawned.identity.correlation ? { correlation: spawned.identity.correlation } : {}),
      }
      const reconstructed = makeRecursiveWorker(
        profile,
        {
          assignmentId: spawned.assignmentId,
          parentNodeId: spawned.parent,
          budget: spawned.budget,
          task,
          label: spawned.label,
          ...(spawned.key === undefined ? {} : { key: spawned.key }),
          execution,
        },
        true,
      )
      const spec = (reconstructed as Agent<unknown, unknown> & { executorSpec?: AgentSpec })
        .executorSpec
      if (!spec) return undefined
      const factory = isDriverSpec(spec) ? driverExecutorFactory : spec.executorFactory
      return factory === undefined ? undefined : { spec, factory }
    },
  )
  env.recoveryFactories.set(makeRecursiveWorker, factory)
}
