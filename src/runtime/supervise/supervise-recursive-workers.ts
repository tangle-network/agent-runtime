import { resolve } from 'node:path'
import { type AgentProfile, validateAgentProfileSecurity } from '@tangle-network/agent-interface'
import {
  type ProfileMaterializationContract,
  promptModelProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type {
  GraphSubtasks,
  MakeWorkerAgent,
  WorkerSpawnContext,
} from '../../mcp/tools/coordination-contracts'
import type { ChildQuestionInbox, QuestionRecord } from '../../mcp/tools/coordination-questions'
import { CONTINUATIONS_DIR } from './continuation'
import { driverChild, driverExecutorFactory, isDriverSpec } from './driver-executor'
import { errMessage } from './error-message'
import { runtimeFlowBrain } from './flow-brain'
import { createFlowRun, flowOfSubtask, routeFlowOf } from './graph-flow'
import { createGraphOverlay, type GraphOverlay, productSpawnAuthority } from './graph-overlay'
import {
  type GraphSubtaskTopology,
  graphSubtaskOf,
  parseGraphSubtaskTopology,
  prepareGraphSubtask,
  validateGraphSubtask,
} from './graph-topology'
import { assertProfileModelsAllowed } from './model-policy'
import { kernelPromptRegistry } from './prompt-registry'
import { registerRetainedExecutorPreparation } from './retained-executor'
import type { RunCancelRequest } from './run-cancellation'
import { createExecutor, type ExecutorConfig } from './runtime'
import { authoredSeatStages } from './seat-chain'
import { supervisorTurnOptions } from './supervise-agent-options'
import { defaultPerWorker } from './supervise-budget'
import { graphSubtaskOutput, storedGraphTopology } from './supervise-graph-subtasks'
import {
  canonicalExecution,
  childCoordinationOwner,
  freezeDetached,
  freezeDetachedProfile,
  workerAssignmentNamespace,
} from './supervise-identity'
import { captureDeliverable } from './supervise-option-capture'
import type { AuthorizedSpawnContext } from './supervise-options'
import {
  assertBridgeProfileMaterializes,
  assertProfileContract,
  DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
  isExternalSupervisor,
} from './supervise-profile-admission'
import type { prepareSuperviseRun } from './supervise-run-setup'
import {
  spawnModelSubstitution,
  withModelSubstitution,
  workerFromBackend,
} from './supervise-worker-backend'
import {
  declaredRuntimeToolNames,
  ownSubmissionDeliverable,
  providerVisibleProfile,
  supervisorAgent,
  supervisorAgentWithTestBrain,
} from './supervisor-agent'
import type { Agent, AgentSpec, ExecutorFactory, NodeExecutionIdentity } from './types'
import { withWorkerSpawnRetry } from './worker-retry'

export function createSuperviseWorkers(
  setup: ReturnType<typeof prepareSuperviseRun>,
  cancelDurableRun: (reason: string, request?: RunCancelRequest) => void,
) {
  const {
    options,
    canonicalProfile,
    rootExecution,
    guidanceComposer,
    composeSpawnProfile,
    applyTraceTools,
    peerAuditFor,
    authorizeDownFor,
    deliverable,
    finalizer,
    analysts,
    profileTable,
    blobs,
    ownerShare,
    journal,
    runId,
    runNamespace,
    log,
    rootOwnerId,
    childQuestionInboxes,
    askParentManager,
    observeNodeEvent,
    managerBackend,
    spawnResourceRoot,
    spawnPreflight,
    driverMaterialization,
    composeSpawnProfileFor,
    driveHarnessForOwner,
    now,
  } = setup
  const recoveryFactories = new WeakMap<MakeWorkerAgent, ExecutorFactory<unknown>>()
  // `run_graph`: a manager starts an agent graph as ONE subtask. The graph's root node runs as a
  // nested manager of the caller, inside the caller's reservation, with the graph layer composed
  // around it (`graph-overlay`). Served only where this run builds the worker path, because that
  // path is what pins the graph's nodes; a caller-owned `makeWorkerAgent` decides its own children.
  const graphOverlays = new Set<GraphOverlay>()
  const graphSubtasks: GraphSubtasks | undefined =
    options.makeWorkerAgent === undefined
      ? {
          prepare: async (input) => {
            try {
              const topology =
                input.graphDigest === undefined
                  ? parseGraphSubtaskTopology(input.graph)
                  : await storedGraphTopology(options.graphRegistry, input.graphDigest)
              const prepared = prepareGraphSubtask(topology, {
                registry: kernelPromptRegistry(),
                ...(analysts ? { analysts } : {}),
                ...(guidanceComposer ? { guidance: guidanceComposer } : {}),
              })
              // Every node is pinned, so a node the run would refuse at its spawn cannot be fixed
              // by the graph's driver. The run's model policy and pre-flight resolver judge every
              // node now, while the graph's author can still change it.
              for (const profile of [
                prepared.profile,
                ...topology.nodes
                  .filter((node) => node.id !== prepared.root)
                  .map((node) => guidanceComposer?.(node.profile) ?? node.profile),
              ]) {
                assertProfileModelsAllowed(profile, options.allowedModels)
                options.resolveSpawnProfile?.(profile)
              }
              return { ok: true as const, ...prepared }
            } catch (error) {
              return { ok: false as const, reason: errMessage(error) }
            }
          },
        }
      : undefined
  // The graph layer for the root of a `run_graph` subtask, rebuilt from the topology its admitted
  // profile carries — on a fresh spawn and on recovery alike.
  const productAuthority = productSpawnAuthority(options.authorizeSpawn)
  const graphOverlayFor = (topology: GraphSubtaskTopology) => {
    const registry = kernelPromptRegistry()
    const validated = validateGraphSubtask(topology, registry, analysts)
    const overlay = createGraphOverlay(validated, {
      registry,
      journal,
      runId,
      now,
      ...(guidanceComposer ? { guidance: guidanceComposer } : {}),
      ...(productAuthority ? { authorizeSpawn: productAuthority } : {}),
      subtask: true,
    })
    graphOverlays.add(overlay)
    return { overlay, validated }
  }
  let makeWorkerAgent = options.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!options.backend && !options.makeLeafAgent) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run), opts.makeLeafAgent, or opts.makeWorkerAgent',
      )
    }
    // A caller-owned leaf factory slots in here, under the same authorization and classification
    // every backend-derived leaf gets; `backend` is then only needed for a per-spawn deliverable.
    //
    // The retry seam wraps the leaf factory, so a spawn refused BEFORE the worker ran is
    // re-entered rather than settled dead. It sits inside the authorized path: the profile is
    // already decided, and a re-entry runs the same executor object the kernel admitted.
    const withRetry = (make: MakeWorkerAgent): MakeWorkerAgent =>
      withWorkerSpawnRetry(make, options.workerRetry, {
        ...(options.onWorkerRetry ? { onRetry: options.onWorkerRetry } : {}),
      })
    const makeLeaf = withRetry(
      options.makeLeafAgent ?? workerFromBackend(options.backend as ExecutorConfig, deliverable),
    )
    const securityPolicy = options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY

    const makeRecursiveWorkerFor = (
      parent: AgentProfile,
      parentIdentity: NodeExecutionIdentity,
      depth: number,
      parentOwnerId: string,
      analystLineage = false,
      peerRootOwnerId?: string,
      // The graph this parent's subtree belongs to, when it is part of a `run_graph` subtask.
      graph?: GraphOverlay,
    ): MakeWorkerAgent => {
      const makeRecursiveWorker = (
        authoredProfile: AgentProfile,
        spawnContext: WorkerSpawnContext | undefined,
        recovering = false,
      ): ReturnType<MakeWorkerAgent> => {
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
          ...(spawnContext.analyst !== undefined ? { analyst: spawnContext.analyst } : {}),
          ...(spawnContext.map !== undefined ? { map: spawnContext.map } : {}),
          ...(spawnContext.route !== undefined ? { route: spawnContext.route } : {}),
          ...(spawnContext.continuity !== undefined ? { continuity: spawnContext.continuity } : {}),
        })
        // Recovery reconstructs the admitted authority; authorization cannot replace it. Inside a
        // graph subtask the graph pins each spawn first and hands the pinned profile to the run's
        // own authority, as `runGraph` does for a run's root graph.
        const authorize = graph?.authorizeSpawn ?? options.authorizeSpawn
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
        const security = validateAgentProfileSecurity(authorized, securityPolicy)
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
        // A Runtime tool grant makes this a managed persistent node. `spawn_worker` is one
        // capability on that node, not a hidden role bit: an IC can submit a result, ask a parent,
        // or call a product tool without also being allowed to delegate.
        const seatManagedLeaf =
          authoredSeatStages(authorized) !== undefined &&
          declaredRuntimeToolNames(authorized).length === 0 &&
          isExternalSupervisor(authorized)
        const usesRuntimeCoordination =
          declaredRuntimeToolNames(authorized).length > 0 || seatManagedLeaf
        if (!usesRuntimeCoordination) {
          if (childDeliverable !== deliverable && !options.backend) {
            throw new ValidationError(
              'supervise: resolveDeliverable selected a per-spawn deliverable but there is no backend to derive that leaf from; makeLeafAgent owns its own completion check',
            )
          }
          const makeSelectedLeaf =
            childDeliverable === deliverable
              ? makeLeaf
              : withRetry(workerFromBackend(options.backend as ExecutorConfig, childDeliverable))
          return withModelSubstitution(
            makeSelectedLeaf(
              authorized,
              Object.freeze({
                ...authorizedContext,
                assignmentId: workerAssignmentNamespace(
                  runNamespace,
                  parentOwnerId,
                  spawnContext.assignmentId,
                ),
              }),
            ),
            modelSubstitution,
          )
        }
        const ownerId = childCoordinationOwner(
          parentOwnerId,
          childExecution.identity,
          spawnContext,
          depth,
        )
        // The root of a `run_graph` subtask carries its graph's topology, and its whole subtree
        // runs under that graph's layer. A node already inside a graph cannot start another: the
        // graph's pinning refuses that spawn before it reaches here, and recovery cannot add one.
        // A `maps` edge whose item is a graph is the one exception: the graph authored it, and its
        // pinning admitted exactly that topology for this item.
        const subtask = graphSubtaskOf(authorized)
        if (subtask !== undefined && graph !== undefined && spawnContext.map === undefined) {
          throw new ValidationError(
            'supervise: a node of a graph cannot start another graph; add the work as nodes',
          )
        }
        const own = subtask === undefined ? undefined : graphOverlayFor(subtask)
        const ownGraph = own?.overlay
        const subtreeGraph = ownGraph ?? graph
        // A flow subtask runs under Runtime's flow root, as `runGraph` runs a flow: its brain makes
        // no model call, and its routes decide every spawn. Inside a maps item the item value is
        // the task of every `{ item: true }` entry.
        const ownFlow =
          own?.validated.flow === undefined
            ? undefined
            : {
                run: createFlowRun(),
                route: flowOfSubtask(
                  routeFlowOf(own.validated),
                  spawnContext.map === undefined ? undefined : { item: spawnContext.task },
                ),
              }
        // A managed child, a graph node included, settles on its own accepted submission. Its result
        // goes to the manager that assigned it, and the run's check judges the run's result, never
        // a child's narrower assignment. A deliverable `resolveDeliverable` chose for this spawn
        // still applies; a run with no check gives its non-graph children none.
        const ownSubmission =
          selectedDeliverable === undefined &&
          (subtreeGraph !== undefined || deliverable !== undefined)
        const managerDeliverable = ownSubmission ? ownSubmissionDeliverable : childDeliverable
        const nestedDriveHarness = isExternalSupervisor(authorized)
          ? driveHarnessForOwner(
              freezeDetached({
                runId,
                runNamespace,
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

        const rootPeerOwner = options.peerAudit
          ? depth === 1
            ? ownerId
            : peerRootOwnerId
          : undefined
        const childFactory = makeRecursiveWorkerFor(
          authorized,
          childExecution.identity,
          depth + 1,
          ownerId,
          analystLineage ||
            spawnContext.analyst !== undefined ||
            spawnContext.assignmentId.startsWith('analyst:'),
          rootPeerOwner,
          subtreeGraph,
        )
        const nestedPerWorker = defaultPerWorker(spawnContext.budget, ownerShare)
        const runMessageAuthority = authorizeDownFor(authorized, depth + 1)
        // A graph observes what the run's authority changes: a narrowed steer ledgers `stripped`.
        const authorizeNestedMessage =
          subtreeGraph && runMessageAuthority
            ? subtreeGraph.observeMessages(runMessageAuthority)
            : runMessageAuthority
        // Inside a graph, its layer decides what `runGraph` decides for a root graph: the analyst
        // routes, edge continuity, the pre-flight's pinned profile, and that a node gains no spawn
        // rights it lacks. It also ledgers the steers and findings each of its managers publishes.
        const nestedAnalyzeOnSettle = subtreeGraph
          ? subtreeGraph.routes.length > 0
            ? subtreeGraph.routes
            : undefined
          : options.analyzeOnSettle
        const nestedMapOnSettle = subtreeGraph
          ? subtreeGraph.maps.length > 0
            ? subtreeGraph.maps
            : undefined
          : options.mapOnSettle
        const nestedContinuity = subtreeGraph
          ? Object.keys(subtreeGraph.continuityByProfile).length > 0
            ? subtreeGraph.continuityByProfile
            : undefined
          : options.continuityByProfile
        // The graph resolves which node a spawn names; the run's own resolver then judges that
        // node. A name that is no node passes through, and pinning refuses it with its reason.
        const runResolveSpawnProfile = options.resolveSpawnProfile
        const nestedResolveSpawnProfile = subtreeGraph
          ? (authored: AgentProfile): AgentProfile => {
              const pinned = subtreeGraph.resolveSpawnProfile(authored)
              return runResolveSpawnProfile && pinned !== authored
                ? runResolveSpawnProfile(pinned)
                : pinned
            }
          : runResolveSpawnProfile
        const nestedComposeSpawnProfile = subtreeGraph
          ? composeSpawnProfile
          : composeSpawnProfileFor(authorized)
        const nestedObserveNodeEvent: typeof observeNodeEvent = subtreeGraph
          ? async (context, event, record) => {
              await observeNodeEvent?.(context, event, record)
              subtreeGraph.onCoordinationEvent(event)
              if (context.ownerId === ownerId) ownFlow?.run.observe(event)
            }
          : observeNodeEvent
        let acceptedSubmission = false
        let unassessedOutput = false
        const peerAudit = depth === 1 ? peerAuditFor(spawnContext.parentNodeId) : undefined
        const nestedDeps: Parameters<typeof supervisorAgent>[1] = {
          ...(spawnContext.peerMailUrl ? { peerMailUrl: spawnContext.peerMailUrl } : {}),
          ...(peerAudit ? { peerAudit } : {}),
          blobs,
          onUnassessedOutput: () => {
            unassessedOutput = true
          },
          ...(spawnResourceRoot === undefined ? {} : { spawnResourceRoot }),
          makeWorkerAgent: childFactory,
          ...(graphSubtasks ? { graphs: graphSubtasks } : {}),
          ...(spawnContext.sourceEvidenceRefs
            ? { sourceEvidenceRefs: spawnContext.sourceEvidenceRefs }
            : {}),
          ...(authorizeNestedMessage ? { authorizeDownMessage: authorizeNestedMessage } : {}),
          perWorker: nestedPerWorker,
          ...(ownerShare > 0 ? { preserveOwnerTurns: true } : {}),
          ...(options.router ? { router: options.router } : {}),
          ...(nestedDriveHarness ? { driveHarness: nestedDriveHarness } : {}),
          ...(options.coordination && isExternalSupervisor(authorized)
            ? { coordination: options.coordination }
            : {}),
          nodeContext: {
            runId,
            runNamespace,
            ownerId,
            depth,
            identity: childExecution.identity,
            assignmentId: spawnContext.assignmentId,
            ...(rootPeerOwner ? { peerRootOwnerId: rootPeerOwner } : {}),
          },
          ...(options.resolveSupervisorTools
            ? { resolveSupervisorTools: options.resolveSupervisorTools }
            : {}),
          ...(nestedObserveNodeEvent
            ? { observeNodeEvent: nestedObserveNodeEvent, replaySettlements: true }
            : {}),
          ...(analysts ? { analysts } : {}),
          // A nested manager's question goes to the manager that spawned it, unless the product
          // installed its own parent channel.
          escalateQuestion:
            options.escalateQuestion ??
            ((question: QuestionRecord) =>
              askParentManager(parentOwnerId, spawnContext.assignmentId, question)),
          onChildQuestionInbox: (inbox: ChildQuestionInbox) => {
            childQuestionInboxes.set(ownerId, inbox)
          },
          ...(!analystLineage &&
          spawnContext.analyst === undefined &&
          !spawnContext.assignmentId.startsWith('analyst:') &&
          nestedAnalyzeOnSettle
            ? { analyzeOnSettle: nestedAnalyzeOnSettle }
            : {}),
          ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
          ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
          ...(options.wake !== undefined ? { wake: options.wake } : {}),
          ...(nestedMapOnSettle ? { mapOnSettle: nestedMapOnSettle } : {}),
          ...(nestedContinuity ? { continuityByProfile: nestedContinuity } : {}),
          ...(spawnPreflight ? { preflightSpawn: spawnPreflight } : {}),
          ...(nestedResolveSpawnProfile ? { resolveSpawnProfile: nestedResolveSpawnProfile } : {}),
          ...(nestedComposeSpawnProfile ? { composeSpawnProfile: nestedComposeSpawnProfile } : {}),
          ...(profileTable ? { profiles: profileTable } : {}),
          ...(options.peerMail ? { peerMail: options.peerMail } : {}),
          ...supervisorTurnOptions(options),
          // A managed child receives its assignment's independent completion check. It can submit
          // work itself, delegate, or do both under the same profile contract.
          ...(managerDeliverable && !seatManagedLeaf ? { deliverable: managerDeliverable } : {}),
          ...(managerDeliverable && !seatManagedLeaf
            ? {
                onAcceptedSubmission: () => {
                  acceptedSubmission = true
                },
              }
            : {}),
          // Every external manager with a check in the tree is sent back under the run's one
          // continuation policy. Its files sit beside the root's, under its own owner id. A child
          // that settles on its own submission has no part in that policy: it states what the run
          // still owes.
          ...(managerDeliverable &&
          !ownSubmission &&
          !seatManagedLeaf &&
          options.continuation &&
          isExternalSupervisor(authorized)
            ? {
                continuation: options.continuation,
                ...(options.runDir === undefined
                  ? {}
                  : {
                      continuationDir: resolve(
                        options.runDir,
                        CONTINUATIONS_DIR,
                        'managers',
                        encodeURIComponent(ownerId),
                      ),
                    }),
              }
            : {}),
          ...(log
            ? {
                onEvent: (_event, record) => log.append(runId, record, ownerId),
                loadPriorCoordination: () => log.load(runId, ownerId),
              }
            : {}),
          ...(finalizer ? { finalizer } : {}),
          // A nested manager owns only its subtree's durable controls. Root-level labels remain
          // the root's even when steering uses a separate directory from cancellation.
          ...(options.runDir === undefined
            ? {}
            : {
                controlDir: resolve(options.runDir),
                abortRun: cancelDurableRun,
              }),
          ...(options.steerDir === undefined ? {} : { steerDir: resolve(options.steerDir) }),
          ...(options.runDir === undefined && options.steerDir === undefined
            ? {}
            : { controlScope: 'subtree' as const }),
        }
        const nested =
          ownFlow === undefined
            ? supervisorAgent(authorized, nestedDeps)
            : supervisorAgentWithTestBrain(authorized, {
                ...nestedDeps,
                brain: runtimeFlowBrain(),
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
            () => acceptedSubmission,
            recoveryFactories.get(childFactory),
            () => unassessedOutput,
            seatManagedLeaf ? managerDeliverable : undefined,
            ownGraph ? (out) => graphSubtaskOutput(ownGraph, out, ownFlow?.run.failure) : undefined,
          ),
          modelSubstitution,
        )
      }
      if (
        options.makeLeafAgent === undefined &&
        options.backend?.backend === 'provider' &&
        !options.backend.steering
      ) {
        const factory = registerRetainedExecutorPreparation(
          createExecutor(options.backend),
          ({ spawned, profile, task }) => {
            if (
              !spawned.ownedTreeRoot ||
              !spawned.parent ||
              !spawned.assignmentId ||
              !spawned.identity
            )
              return undefined
            const execution = {
              ...(spawned.identity.candidateDigest
                ? { candidateDigest: spawned.identity.candidateDigest }
                : {}),
              ...(spawned.identity.correlation
                ? { correlation: spawned.identity.correlation }
                : {}),
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
            if (!spec || !isDriverSpec(spec)) return undefined
            return { spec, factory: driverExecutorFactory }
          },
        )
        recoveryFactories.set(makeRecursiveWorker, factory)
      }
      return makeRecursiveWorker
    }

    makeWorkerAgent = makeRecursiveWorkerFor(
      canonicalProfile,
      rootExecution.identity,
      1,
      rootOwnerId,
    )
  }
  return { workerFactory: makeWorkerAgent, recoveryFactories, graphSubtasks, graphOverlays }
}
