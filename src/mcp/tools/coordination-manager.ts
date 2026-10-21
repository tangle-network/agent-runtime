import type { Scope } from '../../runtime'
import {
  type CheckRead,
  CheckUnavailableError,
  type CheckVerdict,
  checkVerdictOf,
} from '../../runtime/supervise/continuation'
import { type BusRecord, createEventBus } from '../../runtime/supervise/event-bus'
import { INBOX_RECEIPT_KEY, type InboxReceipt } from '../../runtime/supervise/inbox'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { createPeerMailbox, type PeerMailbox } from '../../runtime/supervise/peer-mail'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { McpToolDescriptor } from '../server'
import { createCoordinationAnalysis } from './coordination-analysis'
import { mountAnalystsTools } from './coordination-analyst-tools'
import { canonicalFindingEvent } from './coordination-analysts'
import { createAuditTools } from './coordination-audit-tools'
import { refusalText } from './coordination-completion-refusal'
import type {
  BlockedToolReport,
  CoordinationTools,
  CoordinationToolsOptions,
  SettledWorker,
} from './coordination-contracts'
import { createDownMessages } from './coordination-down-messages'
import { projectEvent } from './coordination-event-projection'
import type { Delivery } from './coordination-events'
import {
  type AwaitWakeInput,
  type CoordinationEvent,
  type EventAcknowledgement,
  type ManagerWake,
  type ToolOutcomeEvent,
  wakeEventKinds,
} from './coordination-events'
import { mountGraphsTools } from './coordination-graph-tools'
import { obj, str } from './coordination-input'
import { createJournalReader } from './coordination-journal-reader'
import { managerReentryState } from './coordination-manager-reentry'
import { createMapRouting } from './coordination-map-routing'
import { createQuestionLedger } from './coordination-question-ledger'
import { createQuestionTools } from './coordination-question-tools'
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
  const { questions, addQuestion, emitNewQuestion, escalations, blockingQuestionsForStop } =
    questionLedger

  const deliverable = opts.deliverable
  const profileTable =
    opts.profiles !== undefined && opts.profiles.size > 0 ? opts.profiles : undefined
  // The manager owns one bounded reader so adjacent/concurrent pages share the immutable
  // content-addressed selection without allowing a caller-supplied blob reference to bypass the
  // worker lookup below.
  const readWorkerOutput = createWorkerOutputReader(opts.blobs)
  // An accepted direct result is a terminal fact, not an in-process callback. A durable observer
  // appends the `submission` record before the tool responds, so a fresh manager can restore it
  // after a crash in the response-to-driver window.
  const priorSubmission =
    deliverable === undefined
      ? undefined
      : opts.priorJournal?.find(
          (
            record,
          ): record is BusRecord<Extract<CoordinationEvent, { readonly type: 'submission' }>> =>
            record.event.type === 'submission',
        )
  let stopped = priorSubmission !== undefined
  let reason: string | undefined = priorSubmission === undefined ? undefined : 'result-accepted'
  let stopNotified = false
  let submitted: { readonly result: unknown } | undefined =
    priorSubmission === undefined
      ? undefined
      : detachedFrozen({ result: priorSubmission.event.result })
  let submissionInFlight: Promise<void> | undefined
  // Every `report_blocked` whose probe failed too.
  const blockedReports: BlockedToolReport[] = []

  const ledger: SettledWorker[] = []

  const notifyStop = (): void => {
    if (stopNotified) return
    stopNotified = true
    opts.onStop?.(reason)
  }
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
  const {
    profileNameByWorker,
    workerByAssignment,
    preflightCounts,
    nodeForWorker,
    workerRouteNames,
    liveWorkerIdNamed,
    resolveContinuity,
    admitSpawn,
    abortWorker,
  } = spawnAdmission
  const { descendantOutRefs, projectSettled } = createWorkerSettlement({ opts, nodeForWorker })

  const leadReceipts = new Map<string, (receipt: InboxReceipt) => void>()
  const analysis = createCoordinationAnalysis({
    leadReceipts,
    opts,
    ledger,
    bus,
    profileNameByWorker,
    watchWorker: (id) => watchWorker(id),
    liveWorkerIdNamed,
    messages: () => messages,
    ready: () => ready(),
    ensureDrain: () => ensureDrain(),
  })
  const {
    analystRuns,
    flushedAnalystRuns,
    analystRunFinding,
    analystRunContext,
    finishAnalysis,
    definedAnalysts,
    analystMenu,
    defineAnalyst,
  } = analysis

  // Replayed reviews remain findings. They cannot enter the completion pool or recursively
  // trigger another analyst, even when the resumed configuration changes its analyst routes.
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
  if (opts.onEvent) {
    const cb = opts.onEvent
    bus.subscribe((rec) => cb(rec.event, rec))
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
  // The flow start hook: a flow's entries are spawned once, when the coordination opens and
  // before the manager's first turn, after any replayed settlements are published.
  const ready = async (): Promise<void> => {
    await replayResumeEvents()
    if (opts.routeFlow !== undefined) await routes.start()
  }
  const replayResumeEvents = (): Promise<void> => {
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
  const deliveries: Delivery[] = []
  // Tool calls that outlived their response fence, by receipt. Each is open work: its outcome
  // reaches the manager as a `tool-outcome` event on the next wake.
  const openReceipts = new Map<string, { readonly tool: string; readonly startedAt: number }>()
  let receiptSeq = 0
  // Lead messages accepted and still being published. The sender is told `delivered` the moment the
  // message is accepted, so a manager that ends its turn then must still count it as open work.
  let leadPublishing = 0
  // Set once a wake has told this manager the deadline is near. From then on open work does not
  // refuse its `submit_result` or `stop`: the notice asks for the best result now, and the workers
  // still running are torn down when the manager settles.
  let deadlineNoticeDelivered = false
  let driverAttempt: number | undefined
  const journal = createJournalReader({ opts, bus })
  const { readJournal, priorJournal } = journal

  let lastRejection: { readonly at: number; readonly reason: string } | undefined
  const checkReads: CheckRead[] = []
  const recordCheckRead = (read: {
    readonly source: CheckRead['source']
    readonly verdict?: CheckVerdict
    readonly unavailable?: string
  }): CheckRead => {
    const entry = detachedFrozen<CheckRead>({
      read: checkReads.length + 1,
      attempt: driverAttempt ?? 1,
      at: Date.now(),
      source: read.source,
      ...(read.verdict === undefined ? {} : { verdict: read.verdict }),
      ...(read.unavailable === undefined ? {} : { unavailable: read.unavailable }),
    })
    checkReads.push(entry)
    return entry
  }
  const acknowledge = async (
    targets: ReadonlyArray<Delivery>,
    by: EventAcknowledgement['by'],
  ): Promise<number[]> => {
    const fresh = targets.filter((delivery) => !delivery.acknowledged)
    if (fresh.length === 0) return []
    // A lead's steer or answer was read by the turn that processed it: answer its sender.
    for (const delivery of fresh) {
      const event = delivery.record.event
      const messageId = event.type === 'lead-message' ? event.message.messageId : undefined
      const receipt = messageId === undefined ? undefined : leadReceipts.get(messageId)
      if (messageId === undefined || receipt === undefined) continue
      leadReceipts.delete(messageId)
      try {
        receipt({
          status: 'consumed',
          messageId,
          attemptId: `${opts.scope.view.root}#attempt-${delivery.attempt ?? driverAttempt ?? 1}`,
        })
      } catch {
        // A sender's receipt handler cannot change what this manager processed.
      }
    }
    const seqs = fresh.map((delivery) => delivery.record.seq)
    await bus.publish(
      {
        type: 'acknowledgement',
        acknowledgement: detachedFrozen<EventAcknowledgement>({
          seqs,
          by,
          ...(driverAttempt === undefined ? {} : { attempt: driverAttempt }),
        }),
      },
      { queue: false },
    )
    for (const delivery of fresh) delivery.acknowledged = true
    return seqs
  }

  const maps = createMapRouting({
    opts,
    bus,
    admitSpawn: (input) => admitSpawn(input),
    profileNameByWorker,
  })
  const routes = createRouteRouting({
    opts,
    bus,
    admitSpawn: (input) => admitSpawn(input),
    resolveContinuity,
    profileNameByWorker,
    stop: (why) => {
      stopped = true
      reason = why
      notifyStop()
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
  const { drainSettlement, drainResolved } = settlements
  const messages = createDownMessages({ opts, bus, lifetime })
  const { steerWorker } = messages

  // The sibling channel, when this run enabled it. Publishing is record-only (`queue: false`) for
  // the same reason a steer is: the parent audits and can stop a thread, but peer traffic must not
  // enter the queue a wake delivers — a busy channel would otherwise bury the settlements and
  // questions a wake exists to deliver.
  const peerMail: PeerMailbox | undefined = opts.peerMail
    ? createPeerMailbox({
        scope: opts.scope,
        publish: (mail) =>
          bus.publish({ type: 'mail', mail }, { queue: false }).then(() => undefined),
        ...(opts.peerMail.limits ? { limits: opts.peerMail.limits } : {}),
      })
    : undefined
  // magnetar-rust-20261017c dropped 8 escalations from nested leads with 'no parent inbox': no path
  // carried a child manager's question to the manager that spawned it.
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
  const workers = createWorkerObservation({
    opts,
    ledger,
    flushedAnalystRuns,
    bus,
    deadlineNoticeDelivered: () => deadlineNoticeDelivered,
    leadPublishing: () => leadPublishing,
  })
  const {
    liveWorkerCount,
    queuedWorkerCount,
    liveSnapshot,
    openWork,
    openWorkRefusal,
    freeWorkerSlots,
    readProgress,
    watchWorker,
    unwatchWorker,
  } = workers

  // The blocking `scope.next()` (via `drainSettlement`) waits on a LIVE worker for its whole run.
  // Keep at most ONE such drain in flight, so a wake that ends on its heartbeat never starts a
  // second block, and the one drain still delivers the settlement (exactly-once via the scope
  // cursor) whenever it lands.
  let inFlightDrain: Promise<boolean> | null = null
  const ensureDrain = (): Promise<boolean> => {
    if (!inFlightDrain)
      inFlightDrain = drainSettlement().finally(() => {
        inFlightDrain = null
      })
    return inFlightDrain
  }

  // ── waiting ─────────────────────────────────────────────────────────────────────
  //
  // A manager with nothing to do ends its turn, and Runtime waits for it. Measured 2026-10-05 on
  // two Discovery roots: when the manager did the waiting through a bounded poll, 18 of 88 model
  // turns did nothing but wait, each re-reading the whole cached context. The wait below spends
  // no model turn: it blocks on the bus, and its result becomes the input of the next turn.
  const settledWithoutDrain = async (): Promise<void> => {
    // Move children that already settled onto the bus. Only when no blocking drain holds the
    // cursor: that drain publishes whatever it takes itself.
    if (inFlightDrain) return
    inFlightDrain = (async () => {
      let drained = false
      while (await drainSettlement('nextResolved')) drained = true
      return drained
    })().finally(() => {
      inFlightDrain = null
    })
    await inFlightDrain
  }
  const hasOpenWork = (): boolean => {
    const { running, unqueued, queued } = openWork()
    return (
      running.length > 0 ||
      unqueued.length > 0 ||
      queued.length > 0 ||
      bus.pending(wakeEventKinds) > 0 ||
      openReceipts.size > 0 ||
      leadPublishing > 0 ||
      // A settlement taken from the cursor and still being published, with its analysis.
      settlements.isBusy()
    )
  }
  // Every live worker reports progress and none is stalled; unknown progress counts as stalled.
  const liveWorkersProgressing = (): boolean => {
    const running = openWork().running
    return running.length > 0 && running.every((node) => readProgress(node.id)?.stalled === false)
  }
  // A question one of this manager's workers raised wakes it: a child manager still working would
  // otherwise wait for the heartbeat, or for that child to settle and so never need the answer.
  // The manager's own ask_parent is recorded on the same bus and wakes nothing.
  const isWorkerQuestion = (event: CoordinationEvent): boolean =>
    event.type === 'question' && nodeForWorker(event.question.from) !== undefined
  const workerQuestionPending = (): boolean =>
    bus.queued(['question']).some((record) => isWorkerQuestion(record.event))
  const awaitWake = async (input: AwaitWakeInput): Promise<ManagerWake | undefined> => {
    const startedAt = Date.now()
    let quietHeartbeats = 0
    await ready()
    await settledWithoutDrain()
    if (!hasOpenWork() || input.signal.aborted) return undefined
    let heartbeatAt = startedAt + Math.max(0, input.heartbeatMs)
    const deadlineAt = input.deadlineAt ?? Number.POSITIVE_INFINITY
    let wakeAt = Math.min(heartbeatAt, deadlineAt)
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    let outsideWake = false
    try {
      const queuedEvent = new Promise<void>((resolve) => {
        // Once the record is pull-visible: a subscriber runs before the record is queued.
        unsubscribe = bus.onQueued((record) => {
          if (
            (wakeEventKinds as ReadonlyArray<string>).includes(record.event.type) ||
            isWorkerQuestion(record.event)
          )
            resolve()
        })
      })
      let elapsed: Promise<void> = Promise.resolve()
      const armTimer = (): void => {
        if (timer) clearTimeout(timer)
        elapsed = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, wakeAt - Date.now()))
          // Held: a manager waiting for its workers is live work, and must keep its process up.
        })
      }
      armTimer()
      const aborted = new Promise<void>((resolve) => {
        onAbort = () => resolve()
        input.signal.addEventListener('abort', onAbort, { once: true })
      })
      const outside = (input.alsoWakeOn ?? new Promise<never>(() => undefined)).then(() => {
        outsideWake = true
      })
      // Set once the cursor reports no child it can wait on, so a node it does not drain cannot
      // turn this loop into a spin.
      let cursorIdle = false
      for (;;) {
        while (
          bus.pending(wakeEventKinds) === 0 &&
          !workerQuestionPending() &&
          !outsideWake &&
          !input.signal.aborted &&
          Date.now() < wakeAt
        ) {
          const running = !cursorIdle && openWork().running.length > 0
          // A live worker can only reach the bus through the blocking drain. With none live, the
          // open work is a question or a tool outcome, which publishes itself.
          const drained = running ? ensureDrain() : new Promise<boolean>(() => undefined)
          const done = await Promise.race([
            drained.then((value) => (value ? 'drained' : 'idle')),
            queuedEvent.then(() => 'queued' as const),
            elapsed.then(() => 'elapsed' as const),
            aborted.then(() => 'aborted' as const),
            outside.then(() => 'outside' as const),
          ])
          if (done === 'idle') {
            cursorIdle = true
            if (!hasOpenWork()) break
          }
        }
        // A heartbeat with nothing new costs no model turn while every live worker is still making
        // progress: Runtime re-arms it and keeps waiting. magnetar-rust-20261018b spent 58 of its
        // root's 79 turns, about 37% of root spend, on 15-minute wakes that changed nothing. A
        // stalled worker, no live worker, or the deadline still wakes the manager.
        if (
          input.quietWhileProgressing === true &&
          input.heartbeatMs > 0 &&
          bus.pending(wakeEventKinds) === 0 &&
          !workerQuestionPending() &&
          !outsideWake &&
          !input.signal.aborted &&
          Date.now() >= heartbeatAt &&
          Date.now() < deadlineAt &&
          liveWorkersProgressing()
        ) {
          quietHeartbeats += 1
          heartbeatAt = Date.now() + input.heartbeatMs
          wakeAt = Math.min(heartbeatAt, deadlineAt)
          armTimer()
          continue
        }
        break
      }
      if (input.signal.aborted) return undefined
      // A settlement queued mid-flush still has its analysis to publish: let that bounded flush
      // finish, so the settlement and the finding it triggers ride one wake.
      if (settlements.isFlushing() && inFlightDrain !== null) await inFlightDrain.catch(() => false)
      // Coalesce: whatever else lands within the debounce rides the same wake. Only while other
      // workers still run: with none, nothing else is coming.
      if (
        bus.pending(wakeEventKinds) > 0 &&
        input.debounceMs > 0 &&
        openWork().running.length > 0
      ) {
        await Promise.race([
          new Promise<void>((resolve) => {
            setTimeout(resolve, input.debounceMs)
          }),
          aborted,
        ])
        if (input.signal.aborted) return undefined
        await settledWithoutDrain()
      }
    } finally {
      unsubscribe?.()
      if (timer) clearTimeout(timer)
      if (onAbort) input.signal.removeEventListener('abort', onAbort)
    }
    const events: Array<Record<string, unknown> & { readonly eventSeq: number }> = []
    const pulledKinds: ReadonlyArray<CoordinationEvent['type']> = workerQuestionPending()
      ? [...wakeEventKinds, 'question']
      : wakeEventKinds
    for (let next = bus.pullRecord(pulledKinds); next; next = bus.pullRecord(pulledKinds)) {
      deliveries.push({
        record: next,
        attempt: input.attempt ?? driverAttempt,
        acknowledged: false,
      })
      events.push({ ...projectEvent(next.event), eventSeq: next.seq })
    }
    if (events.length === 0 && !outsideWake && !hasOpenWork()) return undefined
    const reason =
      events.length > 0 || outsideWake
        ? 'events'
        : Date.now() >= deadlineAt
          ? 'deadline'
          : 'heartbeat'
    if (reason === 'deadline') deadlineNoticeDelivered = true
    return detachedFrozen<ManagerWake>({
      reason,
      events,
      live: liveSnapshot(),
      freeSlots: freeWorkerSlots(),
      idleMs: Date.now() - startedAt,
      ...(quietHeartbeats === 0 ? {} : { quietHeartbeats }),
    })
  }

  const tools: McpToolDescriptor[] = [
    ...createWorkerTools({
      opts: opts,
      profileTable: profileTable,
      spawn: spawnAdmission,
      workers: workers,
      descendantOutRefs: descendantOutRefs,
      readWorkerOutput: readWorkerOutput,
      redactJournalEvent: journal.redactJournalEvent,
      steerWorker: steerWorker,
    }),

    ...createQuestionTools({ questionLedger: questionLedger, messages: messages }),

    ...(deliverable
      ? [
          {
            name: 'submit_result',
            description: [
              'Submit the complete result to the injected independent check.',
              'The first passing result is retained; stop work when accepted.',
              ...(deliverable.describe ? [`Expected result: ${deliverable.describe}`] : []),
            ].join(' '),
            inputSchema: {
              type: 'object',
              properties: {
                result: {
                  description: 'The complete result in the form requested by the task.',
                },
              },
              required: ['result'],
              additionalProperties: false,
            },
            handler: async (raw: unknown) => {
              if (submitted) {
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }
              const a = obj(raw)
              if (!Object.hasOwn(a, 'result')) {
                throw new Error('submit_result: "result" is required')
              }
              const open = openWorkRefusal('submit_result')
              if (open !== undefined) {
                lastRejection = { at: Date.now(), reason: String(open.reason) }
                return { accepted: false, stop: false, ...open }
              }

              // Copy once at intake so the value checked below is the exact value retained after
              // acceptance, even when this handler is called directly rather than through JSON-RPC.
              const result = structuredClone(a.result)
              // A check that COULD NOT RUN and a check that FAILED are both "not delivered" —
              // fail-closed is unchanged — but they need opposite moves from the manager. A check
              // that could not run is not a verdict, and the refusal says so.
              let verdict: CheckVerdict | undefined
              let fault: { readonly unavailable: boolean; readonly message: string } | undefined
              try {
                verdict = checkVerdictOf(await deliverable.check(result))
              } catch (error) {
                fault = {
                  unavailable: error instanceof CheckUnavailableError,
                  message: error instanceof Error ? error.message : String(error),
                }
              }
              const read = recordCheckRead({
                source: 'submit',
                ...(verdict === undefined ? {} : { verdict }),
                ...(fault === undefined ? {} : { unavailable: fault.message }),
              })
              if (verdict === undefined || !verdict.pass) {
                const refusal =
                  verdict !== undefined
                    ? refusalText(verdict, deliverable, read.read)
                    : fault?.unavailable === true
                      ? `the check could not run, so this result was not judged (check read ${read.read}): ${fault.message}`
                      : `the independent check THREW, so nothing was accepted (check read ${read.read}): ${fault?.message}. This is a fault in the check, not necessarily in your result — report it rather than resubmitting unchanged`
                lastRejection = { at: Date.now(), reason: refusal }
                return {
                  accepted: false,
                  stop: false,
                  reason: refusal,
                  checkRead: read.read,
                }
              }
              // Two remote callers may submit concurrently. Whichever passing check completes
              // first owns the retained result; a later completion must never overwrite it.
              if (submitted) {
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }

              // Persist before acknowledging. The first caller that reaches this point owns the
              // result while the append is in flight; a concurrent caller waits for the same
              // durable fact instead of appending a second passing result.
              if (submissionInFlight) {
                await submissionInFlight
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }
              const acceptedSubmission = detachedFrozen({ result })
              const commit = bus
                .publish(
                  { type: 'submission', result: acceptedSubmission.result },
                  { queue: false },
                )
                .then(() => {
                  submitted = acceptedSubmission
                  stopped = true
                  reason = 'result-accepted'
                  notifyStop()
                })
              submissionInFlight = commit
              try {
                await commit
              } finally {
                if (submissionInFlight === commit) submissionInFlight = undefined
              }
              // An accepted result is the manager's processing of everything it had received.
              await acknowledge(deliveries, 'result-accepted')
              return { accepted: true, retained: 'this-result', stop: true }
            },
          } satisfies McpToolDescriptor,
        ]
      : []),

    // A manager with a check ends only when the check passes or when a bound ends the run.
    // Measured before this rule (2026-09-24): 389 of 650
    // lead directors could call `stop`, which ended the run with no check and no second chance.
    ...(deliverable
      ? []
      : [
          {
            name: 'stop',
            description: 'Declare the run complete.',
            inputSchema: {
              type: 'object',
              properties: { reason: { type: 'string', description: 'Why you are stopping.' } },
            },
            handler: (raw) => {
              const blocking = blockingQuestionsForStop()
              if (blocking.length) {
                // Name the exit as well as the block. A question this manager escalated to nobody
                // (`no-parent`) will never be answered from above, so "wait for an answer" is not a
                // strategy — the manager is the last decider and must answer or defer it itself.
                const unheard = blocking.filter((question) =>
                  escalations.some(
                    (record) => record.questionId === question.id && record.delivered === false,
                  ),
                )
                return Promise.resolve({
                  stopped: false,
                  error: 'unresolved-blocking-questions' as const,
                  reason:
                    `${blocking.length} blocking question${blocking.length === 1 ? '' : 's'} ${blocking.length === 1 ? 'is' : 'are'} still undecided` +
                    (unheard.length > 0
                      ? `, and ${unheard.length} of them reached no parent — nothing above this manager will answer ${unheard.length === 1 ? 'it' : 'them'}. Decide ${unheard.length === 1 ? 'it' : 'them'} with answer_question (answer, or deferReason to record that it stays open) and stop again.`
                      : '. Decide each with answer_question (answer, deferReason, or escalateTo) and stop again.'),
                  questions: blocking,
                  ...(unheard.length > 0 ? { unheardQuestionIds: unheard.map((q) => q.id) } : {}),
                })
              }
              const open = openWorkRefusal('stop')
              if (open !== undefined) return Promise.resolve({ stopped: false, ...open })
              stopped = true
              const r = obj(raw).reason
              reason = typeof r === 'string' ? r : undefined
              notifyStop()
              return Promise.resolve({ stopped: true })
            },
          } satisfies McpToolDescriptor,
        ]),

    ...(opts.readContinuation
      ? [
          {
            name: 'read_continuation',
            description: [
              "Read a continuation note in full: the note, every line of the check's verdict, and",
              "the question panel's answers. Omit continuation for the latest.",
            ].join(' '),
            inputSchema: {
              type: 'object',
              properties: {
                continuation: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Which continuation, 1-based. Omit for the latest.',
                },
              },
              additionalProperties: false,
            },
            handler: async (raw: unknown) => {
              const value = obj(raw).continuation
              if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
                throw new Error('read_continuation: "continuation" must be an integer >= 1')
              }
              return opts.readContinuation?.(value as number | undefined)
            },
          } satisfies McpToolDescriptor,
        ]
      : []),
    ...createAuditTools({
      opts: opts,
      tools: () => tools,
      blockedReports: blockedReports,
      readJournal: readJournal,
    }),
  ]

  if (opts.peerAudit) {
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
  mountGraphsTools({ opts, tools, admitSpawn })
  mountAnalystsTools({
    opts,
    tools,
    ledger,
    nodeForWorker,
    analystMenu,
    analystRunContext,
    defineAnalyst,
  })

  return {
    tools,
    ready,
    history: () => bus.history(),
    raiseFinding: (finding) =>
      bus
        .publish({ type: 'finding', finding: canonicalFindingEvent(finding) })
        .then(() => undefined),
    steerWorker,
    stats: () =>
      opts.preflightSpawn === undefined
        ? bus.stats()
        : { ...bus.stats(), preflight: { ...preflightCounts } },
    isStopped: () => stopped,
    stopReason: () => reason,
    submittedResult: () => submitted,
    settled: () => ledger,
    questions: () => questions,
    escalations: () => escalations,
    definedAnalysts: () => definedAnalysts,
    drainResolved,
    finishAnalysis,
    abortWorker,
    beginDriverAttempt: (attempt) => {
      driverAttempt = attempt
    },
    endDriverAttempt: async (outcome) => {
      const attempt = driverAttempt
      if (outcome === 'completed') {
        await acknowledge(
          deliveries.filter((delivery) => delivery.attempt === attempt),
          'turn-completed',
        )
      }
    },
    hasOpenWork,
    awaitWake,
    awaitSettlement: async (workerIds, signal) => {
      const wanted = new Set(workerIds)
      const settledIds = () => ledger.filter((worker) => wanted.has(worker.id)).map((w) => w.id)
      await ready()
      for (;;) {
        await settledWithoutDrain()
        const hit = settledIds()
        if (hit.length > 0) return hit
        signal?.throwIfAborted()
        const live = ((opts.scope as Partial<Scope<unknown>>).view?.nodes ?? []).some(
          (node) => wanted.has(node.id) && isLiveNodeStatus(node.status),
        )
        if (!live) return []
        const drained = await (signal === undefined
          ? ensureDrain()
          : Promise.race([
              ensureDrain(),
              new Promise<never>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true })
              }),
            ]))
        if (!drained && settledIds().length === 0) return []
      }
    },
    receiveLeadMessage: (message) => {
      const parsed = leadMessageOf(message)
      if (parsed === undefined) return false
      const receipt = (message as Record<string, unknown>)[INBOX_RECEIPT_KEY]
      if (parsed.messageId !== undefined && typeof receipt === 'function') {
        leadReceipts.set(parsed.messageId, receipt as (receipt: InboxReceipt) => void)
      }
      leadPublishing += 1
      bus
        .publish({ type: 'lead-message', message: parsed })
        .catch((error: unknown) => {
          console.error('Runtime could not queue a lead message for its manager', {
            manager: opts.scope.view.root,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          leadPublishing -= 1
        })
      return true
    },
    openToolReceipt: (tool) => {
      receiptSeq += 1
      const receipt = `${tool}#${receiptSeq}`
      openReceipts.set(receipt, { tool, startedAt: Date.now() })
      return receipt
    },
    settleToolReceipt: async (receipt, outcome) => {
      const open = openReceipts.get(receipt)
      if (open === undefined) return
      openReceipts.delete(receipt)
      await bus.publish({
        type: 'tool-outcome',
        outcome: detachedFrozen<ToolOutcomeEvent>({
          receipt,
          tool: open.tool,
          ...(outcome.ok
            ? { ok: true, value: outcome.value }
            : {
                ok: false,
                error:
                  outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
              }),
          elapsedMs: Date.now() - open.startedAt,
        }),
      })
    },
    reentryState: () =>
      managerReentryState({
        opts,
        ledger,
        deliveries,
        priorJournal,
        bus,
        journal,
        openWork,
        driverAttempt,
        lastRejection,
      }),
    blocked: () => [...blockedReports],
    checkReads: () => checkReads,
    recordCheckRead,
    ...(peerMail ? { peerMail } : {}),
  }
}

import type { LeadMessage } from './coordination-events'

function leadMessageOf(message: unknown): LeadMessage | undefined {
  if (message === null || typeof message !== 'object') return undefined
  const m = message as Record<string, unknown>
  const interrupt = m.interrupt === true
  const id =
    typeof m.messageId === 'string' && m.messageId.length > 0 ? { messageId: m.messageId } : {}
  if (typeof m.steer === 'string') return { ...id, kind: 'steer', text: m.steer, interrupt }
  if (typeof m.answer === 'string') {
    return {
      ...id,
      kind: 'answer',
      text: m.answer,
      ...(typeof m.questionId === 'string' ? { questionId: m.questionId } : {}),
      interrupt,
    }
  }
  return undefined
}
