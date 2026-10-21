import { ValidationError } from '../../errors'
import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import { linkAbort, runAbortable } from './abortable'
import type { ContinuationKeeper } from './continuation'
import type { PriorCoordination } from './coordination-log'
import { type CoordinationMcpHandle, serveCoordinationMcpForManager } from './coordination-mcp'
import type { RootSteer } from './driver-control-acknowledgers'
import { createInbox, INBOX_RECEIPT_KEY, type Inbox, type InboxReceipt } from './inbox'
import { isPeerMailEnvelope, PEER_MAIL_WIRE_KEY } from './peer-mail'
import { createProgressTracker, progressStop, type SettledLedger } from './stop-rules'
import type {
  CoordinationBinding,
  DriveHarness,
  ObserveSupervisorNodeEvent,
  ResolveSupervisorTools,
  SupervisorAgentDeps,
  SupervisorNodeContext,
  SupervisorNodeContextSeed,
} from './supervisor-agent-contracts'
import type { SupervisorProfile } from './supervisor-agent-profile'
import { supervisorCoordinationObservers } from './supervisor-coordination-observers'
import {
  bindSupervisorNodeObserver,
  bindSupervisorTools,
  createVerbSlot,
  supervisorNodeContext,
  type VerbSlot,
} from './supervisor-tool-binding'
import type { Scope } from './types'
import type { resolveWakePolicy } from './wake'
import { observeWorkerControls } from './worker-control-observer'

/** What an external-harness manager's Agent face reads, during an `act` and between acts. */
export interface ExternalManagerLive {
  /** Set while `act` runs: where a message from this manager's lead goes (inside the running turn
   *  for a harness with a live inbox, else the input of the next wake). */
  inbox: ((message: unknown) => boolean) | undefined
  /** The workers this manager is waiting on, while it waits between turns. */
  waitingOn: number | undefined
  /** The coordinator of the running `act`. Its submission is set only once the accepted result is
   *  durable, so it is what `resultAccepted` reads. */
  coordinator: { submittedResult(): unknown } | undefined
}

/** The build-time values of an external-harness manager, fixed before its first `act`. */
export interface ExternalManagerConfig {
  readonly name: string
  readonly deps: SupervisorAgentDeps
  readonly profile: SupervisorProfile
  readonly registeredProfile: SupervisorProfile
  readonly profilePrompt: string | undefined
  readonly runtimeToolNames: ReadonlyArray<string>
  readonly nodeContextSeed: SupervisorNodeContextSeed | undefined
  readonly coordination: CoordinationBinding | undefined
  readonly continuationDeadlineMs: number | undefined
  readonly resolveTools: ResolveSupervisorTools | undefined
  readonly observeNodeEvent: ObserveSupervisorNodeEvent | undefined
  readonly driveHarness: DriveHarness
  readonly deliver: ((message: unknown) => boolean) | undefined
  readonly deliverReady: (() => boolean) | undefined
  readonly wakePolicy: ReturnType<typeof resolveWakePolicy>
  readonly live: ExternalManagerLive
}

/** The state one `act` shares between its coordination server, its turns and its settlement. */
export interface ManagerActState {
  readonly task: unknown
  readonly scope: Scope<unknown>
  /** Filled by `serveCoordinationMcp` right after it builds this manager's coordination tools
   *  and before it listens, so a product tool can compose from its first invocation. */
  readonly slot: VerbSlot
  /** What the manager's next harness invocation must read: sibling peer mail, and any steer or
   *  answer an ended invocation's executor still held. Folded into the next drive's task. */
  readonly nextTurnInbox: Inbox
  readonly stopController: AbortController
  readonly coordinationLifetime: ReturnType<typeof linkAbort>
  harnessInvocationActive: boolean
  progressStopReason: string | undefined
  ledger: SettledLedger | undefined
  /** Built once the coordinator exists, because it reads the check's reads from it. */
  keeper: ContinuationKeeper | undefined
}

export interface ManagerSession {
  readonly state: ManagerActState
  readonly mcp: CoordinationMcpHandle
  readonly controls: CoordinationTools
}

/** Bind this act's node tools and serve its coordination server, then route the lead's messages. */
export async function openManagerSession(
  config: ExternalManagerConfig,
  task: unknown,
  scope: Scope<unknown>,
): Promise<ManagerSession> {
  const { deps } = config
  const context = config.nodeContextSeed
    ? supervisorNodeContext(config.nodeContextSeed, config.profile, task, scope)
    : undefined
  const priorCoordination = deps.loadPriorCoordination
    ? await deps.loadPriorCoordination()
    : deps.priorCoordination
  const slot = createVerbSlot()
  const nextTurnInbox = createInbox()
  const nodeTools =
    config.resolveTools && context
      ? await bindSupervisorTools(config.resolveTools, context, scope.signal, slot)
      : undefined
  const nodeObserver = bindSupervisorNodeObserver(context, config.observeNodeEvent, deps.onEvent)
  const state: ManagerActState = {
    task,
    scope,
    slot,
    nextTurnInbox,
    stopController: new AbortController(),
    coordinationLifetime: linkAbort(scope.signal),
    harnessInvocationActive: false,
    progressStopReason: undefined,
    ledger: undefined,
    keeper: undefined,
  }
  const { handle: mcp, controls } = await serveManagerCoordination(
    config,
    state,
    context,
    priorCoordination,
    nodeTools,
    progressStopObserver(deps, state, nodeObserver),
  )
  state.ledger = mcp
  config.live.coordinator = mcp
  config.live.inbox = managerInboxRoute(config, state, controls)
  return { state, mcp, controls }
}

/**
 * PROGRESS-derived stop on this arm. The harness owns its turn loop, so a worker settle is the
 * evaluation boundary: the same ledger and `progressStop` evaluator the router arm consults, with
 * the stop delivered through `stopController`, which the harness honours at its next turn boundary.
 */
function progressStopObserver(
  deps: SupervisorAgentDeps,
  state: ManagerActState,
  nodeObserver: SupervisorAgentDeps['onEvent'],
): SupervisorAgentDeps['onEvent'] {
  const tracker = deps.stopRule ? createProgressTracker({ now: Date.now }) : undefined
  const rule = deps.stopRule
  if (!tracker || !rule) return nodeObserver
  return async (event, record) => {
    await nodeObserver?.(event, record)
    if (event.type !== 'settled') return
    if (state.ledger === undefined) {
      throw new ValidationError(
        'supervisorAgent: a worker settled before the coordination server was bound',
      )
    }
    const decision = progressStop(
      tracker,
      rule,
      state.ledger,
      state.scope,
      Date.now,
      deps.stallAfterMs,
    )
    if (!decision.stop || state.progressStopReason !== undefined) return
    state.progressStopReason = decision.reason
    deps.onProgressStop?.(decision.reason)
    if (!state.stopController.signal.aborted) state.stopController.abort(decision.reason)
  }
}

function serveManagerCoordination(
  config: ExternalManagerConfig,
  state: ManagerActState,
  context: SupervisorNodeContext | undefined,
  priorCoordination: PriorCoordination | undefined,
  nodeTools: Awaited<ReturnType<typeof bindSupervisorTools>> | undefined,
  onEvent: SupervisorAgentDeps['onEvent'],
): ReturnType<typeof serveCoordinationMcpForManager> {
  const { deps } = config
  const { scope, stopController, coordinationLifetime } = state
  return serveCoordinationMcpForManager(
    {
      scope,
      blobs: deps.blobs,
      makeWorkerAgent: deps.makeWorkerAgent,
      ...(deps.graphs ? { graphs: deps.graphs } : {}),
      ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
      perWorker: deps.perWorker,
      ...(config.coordination ?? {}),
      ...(context ? { identity: { runId: context.runNamespace, actorId: context.ownerId } } : {}),
      // Forward the policy so direct server construction and manager preflight enforce the same
      // authentication and request limits.
      ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
      ...(deps.continuation
        ? {
            readContinuation: (n: number | undefined) =>
              state.keeper?.read(n) ?? { found: false, reason: 'no continuation has been sent' },
          }
        : {}),
      onStop: (reason) => {
        if (!stopController.signal.aborted) {
          stopController.abort(reason ?? 'coordination stop')
        }
      },
      ...supervisorCoordinationObservers(deps),
      ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
      // Fence the awaited event transaction itself. Racing only the control poll would leave
      // its late continuation able to deliver an instruction after the manager stopped.
      onEvent: async (event, record) => {
        await runAbortable(
          async () => {
            await onEvent?.(event, record)
          },
          coordinationLifetime.signal,
          'supervisor coordination stopped',
        )
      },
      ...(deps.replaySettlements ? { replaySettlements: true } : {}),
      ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
      ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
      ...(deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {}),
      ...(deps.profiles ? { profiles: deps.profiles } : {}),
      ...(deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {}),
      ...(deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {}),
      ...(deps.peerMail ? { peerMail: deps.peerMail } : {}),
      ...(priorCoordination?.questions.length
        ? { priorQuestions: priorCoordination.questions }
        : {}),
      ...(priorCoordination?.escalations?.length
        ? { priorEscalations: priorCoordination.escalations }
        : {}),
      ...(priorCoordination?.records.length ? { priorJournal: priorCoordination.records } : {}),
      ...(priorCoordination?.analystDefinitions?.length
        ? { priorAnalystDefinitions: priorCoordination.analystDefinitions }
        : {}),
      ...(nodeTools?.length ? { nodeTools } : {}),
      toolNames: config.runtimeToolNames,
      onCoordinationTools: (tools, coordination) => state.slot.bind(tools, coordination),
    },
    coordinationLifetime.signal,
  ).catch((error: unknown) => {
    coordinationLifetime.abort(error)
    throw error
  })
}

/**
 * Where a message from this manager's lead goes. A harness invocation's executor ends with its
 * attempt, and its inbox with it, so a message it still held moves to `nextTurnInbox`, which the
 * next drive's prompt carries (run 18b's core-4 lost a director ruling and a failed-check notice
 * this way: "Events waiting for you: none").
 */
function managerInboxRoute(
  config: ExternalManagerConfig,
  state: ManagerActState,
  controls: CoordinationTools,
): (message: unknown) => boolean {
  const { deliver, deliverReady, deps } = config
  const { nextTurnInbox } = state
  const withNextTurnFallback = (message: unknown): unknown => {
    if (message === null || typeof message !== 'object') return message
    const original = (message as Record<string, unknown>)[INBOX_RECEIPT_KEY]
    return {
      ...message,
      [INBOX_RECEIPT_KEY]: (receipt: InboxReceipt) => {
        const queued =
          receipt.status === 'failed' &&
          receipt.cause === 'closed' &&
          nextTurnInbox.deliver(message)
        if (!queued && typeof original === 'function') original(receipt)
      },
    }
  }
  return (message) => {
    if (
      deliver !== undefined &&
      state.harnessInvocationActive &&
      (deliverReady === undefined || deliverReady()) &&
      deliver(withNextTurnFallback(message))
    ) {
      return true
    }
    const envelope =
      message !== null && typeof message === 'object'
        ? (message as Record<string, unknown>)[PEER_MAIL_WIRE_KEY]
        : undefined
    if (deps.peerMailUrl && isPeerMailEnvelope(envelope)) {
      return nextTurnInbox.deliver({ [PEER_MAIL_WIRE_KEY]: envelope })
    }
    return controls.receiveLeadMessage(message)
  }
}

/** Watch the run's control and steer directories for this manager, when either is configured. */
export function observeManagerControls(
  config: ExternalManagerConfig,
  session: ManagerSession,
): ReturnType<typeof observeWorkerControls> | undefined {
  const { deps, live } = config
  const { scope, coordinationLifetime, stopController } = session.state
  if (deps.controlDir === undefined && deps.steerDir === undefined) return undefined
  return observeWorkerControls({
    ...(deps.controlDir === undefined ? {} : { dir: deps.controlDir }),
    ...(deps.steerDir === undefined ? {} : { steerDir: deps.steerDir }),
    coord: session.controls,
    scope,
    signal: coordinationLifetime.signal,
    controlScope: deps.controlScope ?? 'run',
    ...(deps.controlScope === 'subtree'
      ? {}
      : {
          deliverRoot: (message: RootSteer) => live.inbox?.(message) ?? false,
          // Between turns a root steer is the input of the next wake, so it is always
          // deliverable once the coordinator exists.
          deliverRootReady: () => true,
        }),
    onError: (error) => {
      coordinationLifetime.abort(error)
      stopController.abort(error)
    },
  })
}
