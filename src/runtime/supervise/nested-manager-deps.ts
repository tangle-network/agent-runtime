import { resolve } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import type { ChildQuestionInbox, QuestionRecord } from '../../mcp/tools/coordination-questions'
import { CONTINUATIONS_DIR } from './continuation'
import type { runtimeFlowBrain } from './flow-brain'
import type { createFlowRun, flowOfSubtask } from './graph-flow'
import type { GraphOverlay } from './graph-overlay'
import type { AdmittedSpawn, ParentSeat, WorkerTreeEnv } from './spawn-admission'
import { supervisorTurnOptions } from './supervise-agent-options'
import { defaultPerWorker } from './supervise-budget'
import { isExternalSupervisor } from './supervise-profile-admission'
import type { DriveHarness, SupervisorAgentDeps } from './supervisor-agent-contracts'

/** The flow a flow-subtask root runs under: its run record and the routes that decide every spawn. */
export interface OwnFlow {
  readonly brain: ReturnType<typeof runtimeFlowBrain>
  readonly run: ReturnType<typeof createFlowRun>
  readonly route: ReturnType<typeof flowOfSubtask>
}

/** Everything one managed (coordinating) child is assembled from, and the two flags it raises. */
export interface ManagedChild {
  readonly env: WorkerTreeEnv
  readonly seat: ParentSeat
  readonly admitted: AdmittedSpawn
  readonly spawnContext: WorkerSpawnContext
  readonly ownerId: string
  readonly rootPeerOwner: string | undefined
  readonly childFactory: MakeWorkerAgent
  readonly driveHarness: DriveHarness | undefined
  readonly subtreeGraph: GraphOverlay | undefined
  readonly ownFlow: OwnFlow | undefined
  readonly managerDeliverable: AdmittedSpawn['childDeliverable']
  readonly ownSubmission: boolean
  /** Raised by the nested manager; read by the driver child when the node settles. */
  acceptedSubmission: boolean
  unassessedOutput: boolean
}

/** Deps for the nested manager of a managed child: coordination wiring, policy and controls. */
export function buildNestedManagerDeps(child: ManagedChild): SupervisorAgentDeps {
  const { env, seat, admitted, spawnContext } = child
  const { options, ownerShare, authorizeDownFor, peerAuditFor } = env.setup
  const nestedPerWorker = defaultPerWorker(spawnContext.budget, ownerShare)
  const runMessageAuthority = authorizeDownFor(admitted.authorized, seat.depth + 1)
  // A graph observes what the run's authority changes: a narrowed steer ledgers `stripped`.
  const authorizeNestedMessage =
    child.subtreeGraph && runMessageAuthority
      ? child.subtreeGraph.observeMessages(runMessageAuthority)
      : runMessageAuthority
  const policy = nestedSettlementPolicy(child)
  const peerAudit = seat.depth === 1 ? peerAuditFor(spawnContext.parentNodeId) : undefined
  return {
    ...(spawnContext.peerMailUrl ? { peerMailUrl: spawnContext.peerMailUrl } : {}),
    ...(peerAudit ? { peerAudit } : {}),
    ...nestedTransportDeps(child, nestedPerWorker, authorizeNestedMessage),
    ...policy,
    ...(env.setup.profileTable ? { profiles: env.setup.profileTable } : {}),
    ...(options.peerMail ? { peerMail: options.peerMail } : {}),
    ...supervisorTurnOptions(options),
    ...nestedDeliverableDeps(child),
    ...nestedLogAndControlDeps(child),
  }
}

/** Blobs, spawn seams, the node context, and the question channel to the spawning manager. */
function nestedTransportDeps(
  child: ManagedChild,
  perWorker: SupervisorAgentDeps['perWorker'],
  authorizeDownMessage: SupervisorAgentDeps['authorizeDownMessage'],
): Pick<SupervisorAgentDeps, 'blobs' | 'makeWorkerAgent' | 'perWorker'> &
  Partial<SupervisorAgentDeps> {
  const { env, seat, admitted, spawnContext, ownerId } = child
  const { authorized } = admitted
  const { options, ownerShare, runId, runNamespace } = env.setup
  return {
    blobs: env.setup.blobs,
    onUnassessedOutput: () => {
      child.unassessedOutput = true
    },
    ...(env.setup.spawnResourceRoot === undefined
      ? {}
      : { spawnResourceRoot: env.setup.spawnResourceRoot }),
    makeWorkerAgent: child.childFactory,
    ...(env.graphSubtasks ? { graphs: env.graphSubtasks } : {}),
    ...(spawnContext.sourceEvidenceRefs
      ? { sourceEvidenceRefs: spawnContext.sourceEvidenceRefs }
      : {}),
    ...(authorizeDownMessage ? { authorizeDownMessage } : {}),
    perWorker,
    ...(ownerShare > 0 ? { preserveOwnerTurns: true } : {}),
    ...(options.router ? { router: options.router } : {}),
    ...(child.driveHarness ? { driveHarness: child.driveHarness } : {}),
    ...(options.coordination && isExternalSupervisor(authorized)
      ? { coordination: options.coordination }
      : {}),
    nodeContext: {
      runId,
      runNamespace,
      ownerId,
      depth: seat.depth,
      identity: admitted.childExecution.identity,
      assignmentId: spawnContext.assignmentId,
      ...(child.rootPeerOwner ? { peerRootOwnerId: child.rootPeerOwner } : {}),
    },
    ...(options.resolveSupervisorTools
      ? { resolveSupervisorTools: options.resolveSupervisorTools }
      : {}),
  }
}

/**
 * Inside a graph, its layer decides what `runGraph` decides for a root graph: the analyst
 * routes, edge continuity, the pre-flight's pinned profile, and that a node gains no spawn
 * rights it lacks. It also ledgers the steers and findings each of its managers publishes.
 */
function nestedSettlementPolicy(child: ManagedChild): Partial<SupervisorAgentDeps> {
  const { env, seat, admitted, spawnContext, ownerId, subtreeGraph, ownFlow } = child
  const { options, composeSpawnProfile, composeSpawnProfileFor, observeNodeEvent } = env.setup
  const analyzeOnSettle = subtreeGraph
    ? subtreeGraph.routes.length > 0
      ? subtreeGraph.routes
      : undefined
    : options.analyzeOnSettle
  const mapOnSettle = subtreeGraph
    ? subtreeGraph.maps.length > 0
      ? subtreeGraph.maps
      : undefined
    : options.mapOnSettle
  const continuity = subtreeGraph
    ? Object.keys(subtreeGraph.continuityByProfile).length > 0
      ? subtreeGraph.continuityByProfile
      : undefined
    : options.continuityByProfile
  // The graph resolves which node a spawn names; the run's own resolver then judges that
  // node. A name that is no node passes through, and pinning refuses it with its reason.
  const runResolveSpawnProfile = options.resolveSpawnProfile
  const resolveSpawnProfile = subtreeGraph
    ? (authored: AgentProfile): AgentProfile => {
        const pinned = subtreeGraph.resolveSpawnProfile(authored)
        return runResolveSpawnProfile && pinned !== authored
          ? runResolveSpawnProfile(pinned)
          : pinned
      }
    : runResolveSpawnProfile
  const compose = subtreeGraph ? composeSpawnProfile : composeSpawnProfileFor(admitted.authorized)
  const observe: typeof observeNodeEvent = subtreeGraph
    ? async (context, event, record) => {
        await observeNodeEvent?.(context, event, record)
        subtreeGraph.onCoordinationEvent(event)
        if (context.ownerId === ownerId) ownFlow?.run.observe(event)
      }
    : observeNodeEvent
  const { assignmentId } = spawnContext
  return {
    ...(observe ? { observeNodeEvent: observe, replaySettlements: true } : {}),
    ...(env.setup.analysts ? { analysts: env.setup.analysts } : {}),
    // A nested manager's question goes to the manager that spawned it, unless the product
    // installed its own parent channel.
    escalateQuestion:
      options.escalateQuestion ??
      ((question: QuestionRecord) =>
        env.setup.askParentManager(seat.parentOwnerId, assignmentId, question)),
    onChildQuestionInbox: (inbox: ChildQuestionInbox) => {
      env.setup.childQuestionInboxes.set(ownerId, inbox)
    },
    ...(!seat.analystLineage &&
    spawnContext.analyst === undefined &&
    !assignmentId.startsWith('analyst:') &&
    analyzeOnSettle
      ? { analyzeOnSettle }
      : {}),
    ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
    ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
    ...(options.wake !== undefined ? { wake: options.wake } : {}),
    ...(mapOnSettle ? { mapOnSettle } : {}),
    ...(continuity ? { continuityByProfile: continuity } : {}),
    ...(env.setup.spawnPreflight ? { preflightSpawn: env.setup.spawnPreflight } : {}),
    ...(resolveSpawnProfile ? { resolveSpawnProfile } : {}),
    ...(compose ? { composeSpawnProfile: compose } : {}),
  }
}

/**
 * A managed child receives its assignment's independent completion check. It can submit work
 * itself, delegate, or do both under the same profile contract.
 */
function nestedDeliverableDeps(child: ManagedChild): Partial<SupervisorAgentDeps> {
  const { env, admitted, ownerId, managerDeliverable } = child
  const { options } = env.setup
  const checked = managerDeliverable && !admitted.seatManagedLeaf
  return {
    ...(checked ? { deliverable: managerDeliverable } : {}),
    ...(checked
      ? {
          onAcceptedSubmission: () => {
            child.acceptedSubmission = true
          },
        }
      : {}),
    // Every external manager with a check in the tree re-enters under the run's one continuation
    // policy, its files beside the root's under its own owner id; a child that settles on its own
    // submission has no part in it: it states what the run still owes.
    ...(checked &&
    !child.ownSubmission &&
    options.continuation &&
    isExternalSupervisor(admitted.authorized)
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
  }
}

function nestedLogAndControlDeps(child: ManagedChild): Partial<SupervisorAgentDeps> {
  const { env, ownerId } = child
  const { options, log, runId, finalizer } = env.setup
  return {
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
          abortRun: env.cancelDurableRun,
        }),
    ...(options.steerDir === undefined ? {} : { steerDir: resolve(options.steerDir) }),
    ...(options.runDir === undefined && options.steerDir === undefined
      ? {}
      : { controlScope: 'subtree' as const }),
  }
}
