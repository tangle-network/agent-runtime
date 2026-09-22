import { type AgentProfile, validateAgentProfileSecurity } from '@tangle-network/agent-interface'
import {
  type ProfileMaterializationContract,
  promptModelProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AuthorizeDownMessage,
  MakeWorkerAgent,
} from '../../mcp/tools/coordination-types'
import type { DeliverableSpec } from './completion-gate'
import type { CoordinationLog } from './coordination-log'
import { driverChild } from './driver-executor'
import type { SupervisorFinalizer } from './finalizer'
import { assertProfileModelsAllowed } from './model-policy'
import type { ExecutorConfig } from './runtime'
import {
  assertProfileContract,
  DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
  isExternalSupervisor,
  workerFromBackend,
} from './supervise-backend'
import {
  canonicalExecution,
  captureDeliverable,
  childCoordinationOwner,
  defaultPerWorker,
  freezeDetached,
  freezeDetachedProfile,
  workerAssignmentNamespace,
} from './supervise-options'
import type { SuperviseOptions } from './supervise-options-types'
import type {
  DriveHarness,
  DriveHarnessOwnerContext,
  ObserveSupervisorNodeEvent,
} from './supervisor-agent'
import { supervisorAgent } from './supervisor-agent'
import type {
  AgentExecutionRef,
  NodeExecutionIdentity,
  ResultBlobStore,
  SpawnJournal,
} from './types'

export interface RecursiveWorkerFactoryArgs {
  readonly options: SuperviseOptions
  readonly backend: ExecutorConfig
  readonly canonicalProfile: AgentProfile
  readonly rootIdentity: NodeExecutionIdentity
  readonly runId: string
  readonly runNamespace: string
  readonly rootOwnerId: string
  readonly deliverable?: DeliverableSpec<unknown>
  readonly blobs: ResultBlobStore
  readonly journal: SpawnJournal
  readonly finalizer?: SupervisorFinalizer
  readonly analysts?: AnalystRegistry
  readonly log?: CoordinationLog
  readonly observeNodeEvent?: ObserveSupervisorNodeEvent
  readonly driverMaterialization?: ProfileMaterializationContract
  readonly driveHarnessForOwner: (context: DriveHarnessOwnerContext) => DriveHarness | undefined
  readonly authorizeDownFor: (
    parent: AgentProfile,
    depth: number,
  ) => AuthorizeDownMessage | undefined
}

export function createBackendWorkerFactory(args: RecursiveWorkerFactoryArgs): MakeWorkerAgent {
  const securityPolicy = args.options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY
  const makeLeaf = workerFromBackend(args.backend, args.deliverable)
  const makeRecursiveWorkerFor = (
    parent: AgentProfile,
    parentIdentity: NodeExecutionIdentity,
    depth: number,
    parentOwnerId: string,
  ): MakeWorkerAgent => {
    return (authoredProfile, spawnContext) => {
      if (!spawnContext) {
        throw new ValidationError('supervise: backend-derived workers require spawn context')
      }
      const input = freezeDetachedProfile(authoredProfile)
      const authorizationInput = Object.freeze({
        profile: input,
        parent,
        parentIdentity,
        parentNodeId: spawnContext.parentNodeId,
        assignmentId: spawnContext.assignmentId,
        task: spawnContext.task,
        budget: spawnContext.budget,
        label: spawnContext.label,
        ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
        depth,
      })
      const decision = args.options.authorizeSpawn
        ? freezeDetached(args.options.authorizeSpawn(authorizationInput))
        : Object.freeze({
            profile: input,
            ...(spawnContext.execution ? { execution: spawnContext.execution } : {}),
          })
      if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
        throw new ValidationError('supervise: authorizeSpawn must return an AuthorizedSpawn')
      }
      const authorized = freezeDetachedProfile(decision.profile)
      const childExecution = canonicalExecution(
        authorized,
        spawnContext.task,
        decision.execution as AgentExecutionRef | undefined,
        `supervise spawn ${JSON.stringify(spawnContext.label)}`,
      )
      const authorizedContext = Object.freeze({
        ...spawnContext,
        ...(childExecution.ref ? { execution: childExecution.ref } : {}),
      })
      const postAuthorizationContext = freezeDetached({
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
      const security = validateAgentProfileSecurity(authorized, securityPolicy)
      if (!security.ok) {
        const details = security.issues
          .filter((issue) => issue.level === 'error')
          .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
          .join(', ')
        throw new ValidationError(`supervise: spawned AgentProfile refused: ${details}`)
      }
      assertProfileModelsAllowed(authorized, args.options.allowedModels)
      const isDriver = args.options.isDriverProfile
        ? args.options.isDriverProfile(postAuthorizationContext)
        : authorized.metadata?.role === 'driver'
      if (typeof isDriver !== 'boolean') {
        throw new ValidationError('supervise: isDriverProfile must return a boolean')
      }
      if (!isDriver) {
        const selectedDeliverable = args.options.resolveDeliverable?.(postAuthorizationContext)
        const leafDeliverable =
          selectedDeliverable === undefined
            ? args.deliverable
            : captureDeliverable(
                selectedDeliverable,
                `supervise deliverable for ${JSON.stringify(spawnContext.label)}`,
              )
        const makeSelectedLeaf =
          leafDeliverable === args.deliverable
            ? makeLeaf
            : workerFromBackend(args.backend, leafDeliverable)
        return makeSelectedLeaf(
          authorized,
          Object.freeze({
            ...authorizedContext,
            assignmentId: workerAssignmentNamespace(
              args.runNamespace,
              parentOwnerId,
              spawnContext.assignmentId,
            ),
          }),
        )
      }
      const ownerId = childCoordinationOwner(
        parentOwnerId,
        childExecution.identity,
        spawnContext,
        depth,
      )
      const nestedDriveHarness = isExternalSupervisor(authorized)
        ? args.driveHarnessForOwner(
            freezeDetached({
              runId: args.runId,
              runNamespace: args.runNamespace,
              ownerId,
              depth,
              identity: childExecution.identity,
              assignmentId: spawnContext.assignmentId,
              profile: authorized,
              task: spawnContext.task,
            }),
          )
        : undefined
      if (isExternalSupervisor(authorized) && !nestedDriveHarness) {
        throw new ValidationError(
          `supervise: authored external supervisor profile.harness=${JSON.stringify(authorized.harness)} requires a local bridge driverBackend, an explicit driveHarness, or resolveDriveHarness with reachable coordination transport`,
        )
      }
      assertProfileContract(
        authorized,
        isExternalSupervisor(authorized)
          ? (args.driverMaterialization as ProfileMaterializationContract)
          : promptModelProfileMaterialization,
        `supervise driver ${JSON.stringify(spawnContext.label)}`,
      )
      const childFactory = makeRecursiveWorkerFor(
        authorized,
        childExecution.identity,
        depth + 1,
        ownerId,
      )
      const authorizeNestedMessage = args.authorizeDownFor(authorized, depth + 1)
      const nested = supervisorAgent(authorized, {
        blobs: args.blobs,
        makeWorkerAgent: childFactory,
        ...(authorizeNestedMessage ? { authorizeDownMessage: authorizeNestedMessage } : {}),
        perWorker: defaultPerWorker(spawnContext.budget),
        ...(args.options.router ? { router: args.options.router } : {}),
        ...(nestedDriveHarness ? { driveHarness: nestedDriveHarness } : {}),
        nodeContext: {
          runId: args.runId,
          runNamespace: args.runNamespace,
          ownerId,
          depth,
          identity: childExecution.identity,
          assignmentId: spawnContext.assignmentId,
        },
        ...(args.options.resolveSupervisorTools
          ? { resolveSupervisorTools: args.options.resolveSupervisorTools }
          : {}),
        ...(args.observeNodeEvent
          ? { observeNodeEvent: args.observeNodeEvent, replaySettlements: true }
          : {}),
        ...(args.analysts ? { analysts: args.analysts } : {}),
        ...(args.options.analyzeOnSettle ? { analyzeOnSettle: args.options.analyzeOnSettle } : {}),
        ...(args.options.watchWorkers ? { watchWorkers: args.options.watchWorkers } : {}),
        ...(args.options.stallAfterMs !== undefined
          ? { stallAfterMs: args.options.stallAfterMs }
          : {}),
        ...(args.options.stopRule ? { stopRule: args.options.stopRule } : {}),
        ...(args.options.onProgressStop ? { onProgressStop: args.options.onProgressStop } : {}),
        ...(args.options.maxTurns !== undefined ? { maxTurns: args.options.maxTurns } : {}),
        ...(args.options.compaction ? { compaction: args.options.compaction } : {}),
        ...(args.log
          ? {
              onEvent: (_event, record) => args.log!.append(args.runId, record, ownerId),
              loadPriorCoordination: () => args.log!.load(args.runId, ownerId),
            }
          : {}),
        ...(args.finalizer ? { finalizer: args.finalizer } : {}),
      })
      return driverChild(authorized, nested, args.journal, childExecution.ref)
    }
  }
  return makeRecursiveWorkerFor(args.canonicalProfile, args.rootIdentity, 1, args.rootOwnerId)
}
