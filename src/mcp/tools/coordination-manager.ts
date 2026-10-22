import type { Settled } from '../../runtime'
import { createEventBus, type EventBus } from '../../runtime/supervise/event-bus'
import type { InboxReceipt } from '../../runtime/supervise/inbox'
import { createPeerMailbox, type PeerMailbox } from '../../runtime/supervise/peer-mail'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { McpToolDescriptor } from '../server'
import { createCoordinationAnalysis } from './coordination-analysis'
import { mountAnalystsTools } from './coordination-analyst-tools'
import { canonicalFindingEvent } from './coordination-analysts'
import { createAuditTools } from './coordination-audit-tools'
import type {
  CoordinationTools,
  CoordinationToolsOptions,
  SettledWorker,
} from './coordination-contracts'
import { createDownMessages } from './coordination-down-messages'
import type { CoordinationEvent } from './coordination-events'
import { mountGraphsTools } from './coordination-graph-tools'
import { obj, str } from './coordination-input'
import { createJournalReader } from './coordination-journal-reader'
import { createLeadIntake } from './coordination-lead-intake'
import { managerReentryState } from './coordination-manager-reentry'
import {
  type AcknowledgementEnv,
  acknowledgeDeliveries,
  appendCheckRead,
  createManagerState,
  type ManagerState,
  notifyManagerStop,
} from './coordination-manager-state'
import { createManagerWaiting } from './coordination-manager-waiting'
import { createMapRouting } from './coordination-map-routing'
import { createQuestionLedger } from './coordination-question-ledger'
import { createQuestionTools } from './coordination-question-tools'
import { createResultTools } from './coordination-result-tools'
import { createRouteRouting } from './coordination-route-routing'
import { createSettlementDrain } from './coordination-settlement-drain'
import { createSpawnAdmission } from './coordination-spawn-admission'
import { createWorkerObservation } from './coordination-worker-observation'
import { createWorkerSettlement } from './coordination-worker-settlement'
import { createWorkerTools } from './coordination-worker-tools'
import { createWorkerOutputReader } from './worker-output'

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  return createCoordinationToolsForManager(opts)
}

/** Internal manager binding; its lifetime fences delivery without cancelling the worker scope. */
export function createCoordinationToolsForManager(
  opts: CoordinationToolsOptions,
  lifetime?: AbortSignal,
): CoordinationTools {
  // The one child→parent pipe. Keep the event-first callback and also pass its exact stamp, so a
  // durable subscriber retains causal sequence, original timestamp, and priority.
  const bus = createEventBus<CoordinationEvent>()
  const questionLedger = createQuestionLedger({ opts, bus })
  const profileTable =
    opts.profiles !== undefined && opts.profiles.size > 0 ? opts.profiles : undefined
  // The manager owns one bounded reader so adjacent/concurrent pages share the immutable
  // content-addressed selection without allowing a caller-supplied blob reference to bypass the
  // worker lookup below.
  const readWorkerOutput = createWorkerOutputReader(opts.blobs)
  const state = createManagerState(opts)
  const ledger: SettledWorker[] = []

  const spawnAdmission = createSpawnAdmission({
    opts,
    ledger,
    liveWorkerCount: () => liveWorkerCount(),
    freeWorkerSlots: () => freeWorkerSlots(),
    queuedWorkerCount: () => queuedWorkerCount(),
    watchWorker: (id) => watchWorker(id),
    peerMail: () => peerMail,
    projectSettled: (settled, resumed) => projectSettled(settled, resumed),
  })
  const { profileNameByWorker, workerByAssignment, nodeForWorker, workerRouteNames } =
    spawnAdmission
  const { descendantOutRefs, projectSettled } = createWorkerSettlement({ opts, nodeForWorker })

  const leadReceipts = new Map<string, (receipt: InboxReceipt) => void>()
  const intake = createLeadIntake({ opts, bus, leadReceipts })
  const analysis = createCoordinationAnalysis({
    leadReceipts,
    opts,
    ledger,
    bus,
    profileNameByWorker,
    watchWorker: (id) => watchWorker(id),
    liveWorkerIdNamed: spawnAdmission.liveWorkerIdNamed,
    messages: () => messages,
    ready: () => ready(),
    ensureDrain: () => waiting.ensureDrain(),
  })
  const replayResumeEvents = createResumeReplay({ opts, bus, ledger, analysis, projectSettled })
  if (opts.onEvent) {
    const cb = opts.onEvent
    bus.subscribe((rec) => cb(rec.event, rec))
  }
  // The flow start hook: a flow's entries are spawned once, when the coordination opens and
  // before the manager's first turn, after any replayed settlements are published.
  const ready = async (): Promise<void> => {
    await replayResumeEvents()
    if (opts.routeFlow !== undefined) await routes.start()
  }
  const journal = createJournalReader({ opts, bus })
  const ackEnv: AcknowledgementEnv = { opts, bus, state, leadReceipts }

  const { maps, routes } = createFlowRouting({
    opts,
    bus,
    spawnAdmission,
    settleCommitted: (id) => settlements.settleCommitted(id),
    stop: (why) => {
      state.stopped = true
      state.reason = why
      notifyManagerStop(state, opts)
    },
  })
  const settlements = createSettlementDrain({
    opts,
    ledger,
    unwatchWorker: (id) => unwatchWorker(id),
    bus,
    analysis,
    maps,
    routes,
    workerRouteNames,
    projectSettled,
  })
  const messages = createDownMessages({ opts, bus, lifetime })
  const peerMail = createPeerMail(opts, bus)
  registerChildQuestionInbox(opts, questionLedger, workerByAssignment, nodeForWorker)
  const workers = createWorkerObservation({
    opts,
    ledger,
    flushedAnalystRuns: analysis.flushedAnalystRuns,
    bus,
    deadlineNoticeDelivered: () => state.deadlineNoticeDelivered,
    leadPublishing: () => intake.leadPublishing(),
  })
  const { liveWorkerCount, queuedWorkerCount, freeWorkerSlots, watchWorker, unwatchWorker } =
    workers
  const waiting = createManagerWaiting({
    opts,
    bus,
    state,
    ledger,
    workers,
    settlements,
    ready,
    nodeForWorker,
    leadPublishing: () => intake.leadPublishing(),
    openReceiptCount: () => intake.openReceiptCount(),
  })

  const parts: ManagerParts = {
    opts,
    bus,
    state,
    ledger,
    questionLedger,
    spawnAdmission,
    analysis,
    settlements,
    messages,
    workers,
    waiting,
    intake,
    journal,
    peerMail,
    ackEnv,
    profileTable,
    readWorkerOutput,
    descendantOutRefs,
    ready,
  }
  return managerSurface(parts, assembleTools(parts))
}

/** Everything the wiring of one manager built; the tool list and the surface read from it. */
type ManagerParts = {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly state: ManagerState
  readonly ledger: SettledWorker[]
  readonly questionLedger: ReturnType<typeof createQuestionLedger>
  readonly spawnAdmission: ReturnType<typeof createSpawnAdmission>
  readonly analysis: ReturnType<typeof createCoordinationAnalysis>
  readonly settlements: ReturnType<typeof createSettlementDrain>
  readonly messages: ReturnType<typeof createDownMessages>
  readonly workers: ReturnType<typeof createWorkerObservation>
  readonly waiting: ReturnType<typeof createManagerWaiting>
  readonly intake: ReturnType<typeof createLeadIntake>
  readonly journal: ReturnType<typeof createJournalReader>
  readonly peerMail: PeerMailbox | undefined
  readonly ackEnv: AcknowledgementEnv
  readonly profileTable: CoordinationToolsOptions['profiles']
  readonly readWorkerOutput: ReturnType<typeof createWorkerOutputReader>
  readonly descendantOutRefs: ReadonlySet<string>
  readonly ready: () => Promise<void>
}

/** The manager's tools in registration order, with peer audit and the graph and analyst mounts. */
function assembleTools(parts: ManagerParts): McpToolDescriptor[] {
  const {
    opts,
    bus,
    state,
    ledger,
    questionLedger,
    spawnAdmission,
    analysis,
    messages,
    workers,
    journal,
    ackEnv,
    profileTable,
    readWorkerOutput,
    descendantOutRefs,
  } = parts
  const { admitSpawn, nodeForWorker } = spawnAdmission
  const tools: McpToolDescriptor[] = [
    ...createWorkerTools({
      opts,
      profileTable,
      spawn: spawnAdmission,
      workers,
      descendantOutRefs,
      readWorkerOutput,
      redactJournalEvent: journal.redactJournalEvent,
      steerWorker: messages.steerWorker,
    }),
    ...createQuestionTools({ questionLedger, messages }),
    ...createResultTools({
      opts,
      bus,
      state,
      workers,
      questionLedger,
      acknowledge: (targets, by) => acknowledgeDeliveries(ackEnv, targets, by),
    }),
    ...createAuditTools({
      opts,
      tools: () => tools,
      blockedReports: state.blockedReports,
      readJournal: journal.readJournal,
    }),
  ]

  if (opts.peerAudit) {
    mountPeerAudit({
      opts: { ...opts, peerAudit: opts.peerAudit },
      tools,
      readJournal: journal.readJournal,
    })
  }
  mountGraphsTools({ opts, tools, admitSpawn })
  mountAnalystsTools({
    opts,
    tools,
    ledger,
    nodeForWorker,
    analystMenu: analysis.analystMenu,
    analystRunContext: analysis.analystRunContext,
    defineAnalyst: analysis.defineAnalyst,
  })
  return tools
}

function managerSurface(parts: ManagerParts, tools: McpToolDescriptor[]): CoordinationTools {
  const {
    opts,
    bus,
    state,
    ledger,
    questionLedger,
    spawnAdmission,
    analysis,
    settlements,
    messages,
    workers,
    waiting,
    intake,
    journal,
    peerMail,
    ackEnv,
    ready,
  } = parts
  return {
    tools,
    ready,
    history: () => bus.history(),
    raiseFinding: (finding) =>
      bus
        .publish({ type: 'finding', finding: canonicalFindingEvent(finding) })
        .then(() => undefined),
    steerWorker: messages.steerWorker,
    stats: () =>
      opts.preflightSpawn === undefined
        ? bus.stats()
        : { ...bus.stats(), preflight: { ...spawnAdmission.preflightCounts } },
    isStopped: () => state.stopped,
    stopReason: () => state.reason,
    submittedResult: () => state.submitted,
    settled: () => ledger,
    questions: () => questionLedger.questions,
    escalations: () => questionLedger.escalations,
    definedAnalysts: () => analysis.definedAnalysts,
    drainResolved: settlements.drainResolved,
    finishAnalysis: analysis.finishAnalysis,
    abortWorker: spawnAdmission.abortWorker,
    beginDriverAttempt: (attempt) => {
      state.driverAttempt = attempt
    },
    endDriverAttempt: async (outcome) => {
      const attempt = state.driverAttempt
      if (outcome === 'completed') {
        await acknowledgeDeliveries(
          ackEnv,
          state.deliveries.filter((delivery) => delivery.attempt === attempt),
          'turn-completed',
        )
      }
    },
    hasOpenWork: waiting.hasOpenWork,
    awaitWake: waiting.awaitWake,
    awaitSettlement: waiting.awaitSettlement,
    receiveLeadMessage: intake.receiveLeadMessage,
    openToolReceipt: intake.openToolReceipt,
    settleToolReceipt: intake.settleToolReceipt,
    reentryState: () =>
      managerReentryState({
        opts,
        ledger,
        deliveries: state.deliveries,
        priorJournal: journal.priorJournal,
        bus,
        journal,
        openWork: workers.openWork,
        driverAttempt: state.driverAttempt,
        lastRejection: state.lastRejection,
      }),
    blocked: () => [...state.blockedReports],
    checkReads: () => state.checkReads,
    recordCheckRead: (read) => appendCheckRead(state, read),
    ...(peerMail ? { peerMail } : {}),
  }
}

/** The map and route schedulers of one manager, which share the nodes of a prior process's spawns. */
function createFlowRouting({
  opts,
  bus,
  spawnAdmission,
  settleCommitted,
  stop,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly spawnAdmission: ReturnType<typeof createSpawnAdmission>
  readonly settleCommitted: (id: string) => Promise<void>
  readonly stop: (reason: string) => void
}) {
  const { profileNameByWorker, resolveContinuity, admitSpawn } = spawnAdmission
  // Committed runtime spawns of a prior process, by node. They stay out of `profileNameByWorker`,
  // so they are never resume targets, but their replayed settles route and expand as live ones do.
  const committedNodes = new Map<string, string>()
  const nodeOf = (id: string) => profileNameByWorker.get(id) ?? committedNodes.get(id)
  const settleNode = (id: string, node: string): Promise<void> => {
    committedNodes.set(id, node)
    return settleCommitted(id)
  }
  const maps = createMapRouting({
    opts,
    bus,
    admitSpawn: (input) => admitSpawn(input),
    nodeOf,
    settleCommitted: settleNode,
    endInDoubt: (node, source) => routes.endInDoubt(node, source),
  })
  const routes = createRouteRouting({
    opts,
    bus,
    admitSpawn: (input) => admitSpawn(input),
    resolveContinuity,
    nodeOf,
    settleCommitted: settleNode,
    stop,
  })
  return { maps, routes }
}

// The sibling channel, when this run enabled it. Publishing is record-only (`queue: false`) for
// the same reason a steer is: the parent audits and can stop a thread, but peer traffic must not
// enter the queue a wake delivers — a busy channel would otherwise bury the settlements and
// questions a wake exists to deliver.
function createPeerMail(
  opts: CoordinationToolsOptions,
  bus: ReturnType<typeof createEventBus<CoordinationEvent>>,
): PeerMailbox | undefined {
  return opts.peerMail
    ? createPeerMailbox({
        scope: opts.scope,
        publish: (mail) =>
          bus.publish({ type: 'mail', mail }, { queue: false }).then(() => undefined),
        ...(opts.peerMail.limits ? { limits: opts.peerMail.limits } : {}),
      })
    : undefined
}

// magnetar-rust-20261017c dropped 8 escalations from nested leads with 'no parent inbox': no path
// carried a child manager's question to the manager that spawned it.
function registerChildQuestionInbox(
  opts: CoordinationToolsOptions,
  { addQuestion, emitNewQuestion }: ReturnType<typeof createQuestionLedger>,
  workerByAssignment: ReadonlyMap<string, string>,
  nodeForWorker: (id: string) => unknown,
): void {
  opts.onChildQuestionInbox?.(async (assignmentId, asked) => {
    const workerId = workerByAssignment.get(assignmentId)
    if (workerId === undefined || nodeForWorker(workerId) === undefined) {
      return {
        delivered: false,
        reason: `the parent manager has no worker for assignment ${JSON.stringify(assignmentId)}`,
      }
    }
    const record = await emitNewQuestion(
      addQuestion(
        {
          from: workerId,
          level: asked.level,
          question: asked.question,
          reason: asked.reason,
          ...(asked.options ? { options: asked.options } : {}),
          urgency: asked.urgency,
        },
        workerId,
      ),
    )
    return { delivered: true, to: `parent manager question ${record.id}` }
  })
}

/**
 * Let `observe_agent` and `read_journal` read a peer root's own record when the run enables peer
 * audit, then register this manager's tools with the peer registry. Mutates the two tools in place.
 */
function mountPeerAudit({
  opts,
  tools,
  readJournal,
}: {
  readonly opts: CoordinationToolsOptions & {
    readonly peerAudit: NonNullable<CoordinationToolsOptions['peerAudit']>
  }
  readonly tools: McpToolDescriptor[]
  readonly readJournal: (raw: unknown, trackOwnRead?: boolean) => unknown
}): void {
  for (const tool of tools) {
    if (tool.name !== 'observe_agent' && tool.name !== 'read_journal') continue
    const ownHandler = tool.handler
    const name = tool.name
    const schema = tool.inputSchema as { properties?: Record<string, unknown> }
    schema.properties = {
      ...schema.properties,
      peerId: {
        type: 'string',
        description:
          "Read a peer root's own record, using its workerId from read_mail.peers. Read-only; omit for your own tree.",
      },
    }
    tool.handler = async (raw) => {
      const args = obj(raw)
      if (args.peerId === undefined) return ownHandler(raw)
      const peerId = str(args.peerId, 'peerId')
      const { peerId: _peerId, ...readArgs } = args
      return opts.peerAudit?.read(peerId, name, readArgs)
    }
  }
  // A peer read must not claim that this manager has consumed its own journal.
  opts.peerAudit.register(
    opts.scope.view.root,
    tools.map((tool) =>
      tool.name === 'read_journal'
        ? { ...tool, handler: async (raw) => readJournal(raw, false) }
        : tool,
    ),
  )
}

/**
 * Seed the settled ledger from a resumed scope and own the replay of its events onto the bus.
 * Replayed reviews remain findings. They cannot enter the completion pool or recursively
 * trigger another analyst, even when the resumed configuration changes its analyst routes.
 */
function createResumeReplay({
  opts,
  bus,
  ledger,
  analysis,
  projectSettled,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly ledger: SettledWorker[]
  readonly analysis: ReturnType<typeof createCoordinationAnalysis>
  readonly projectSettled: (settled: Settled<unknown>, resumed?: boolean) => SettledWorker
}): () => Promise<void> {
  const { analystRuns, flushedAnalystRuns, analystRunFinding } = analysis
  const resumedWorkers: SettledWorker[] = []
  const resumedFindings: CoordinationEvent[] = []
  for (const s of opts.scope.resume?.settled ?? []) {
    const analyst = analystRuns.get(s.handle.id)
    if (analyst) {
      resumedFindings.push(analystRunFinding(analyst, s))
      analystRuns.delete(s.handle.id)
      flushedAnalystRuns.add(s.handle.id)
      continue
    }
    const worker = projectSettled(s, true)
    resumedWorkers.push(worker)
    ledger.push(worker)
  }
  // A settlement can be durable in the spawn journal while the process dies before the product
  // observer acknowledges it. Opted-in high-level callers replay those events at least once. Keep
  // each frozen event object across an in-process retry so EventBus reuses its exact BusRecord.
  const resumeEvents = opts.replaySettlements
    ? [
        ...resumedWorkers.map((worker) =>
          detachedFrozen<CoordinationEvent>({ type: 'settled', worker }),
        ),
        ...resumedFindings,
      ]
    : []
  let resumeEventIndex = 0
  let readyInFlight: Promise<void> | undefined
  return (): Promise<void> => {
    if (resumeEventIndex >= resumeEvents.length) return Promise.resolve()
    if (readyInFlight) return readyInFlight
    readyInFlight = (async () => {
      while (resumeEventIndex < resumeEvents.length) {
        const event = resumeEvents[resumeEventIndex]
        if (!event) break
        await bus.publish(event)
        resumeEventIndex += 1
      }
    })().finally(() => {
      readyInFlight = undefined
    })
    return readyInFlight
  }
}
