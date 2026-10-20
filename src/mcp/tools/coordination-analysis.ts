import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import type { Settled } from '../../runtime'
import type { EventBus } from '../../runtime/supervise/event-bus'
import type { InboxReceipt } from '../../runtime/supervise/inbox'
import { meterRuntimeOwnedAccounting } from '../../runtime/supervise/scope'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import { parseWorkerToolTraceArtifact } from '../../runtime/supervise/trace-evidence'
import {
  ANALYST_DEFINITION_BOUNDS,
  type AnalystAssignmentRecord,
  type AnalystKind,
  type AnalystLensOutput,
  type AnalystRunContext,
  type AnalystRunInFlight,
  type AnalyzeOnSettleRoute,
  canonicalFindingEvent,
  type DefinedAnalystRecord,
  normalizeAnalyzeOnSettle,
  parseAuthoredAnalystDefinition,
} from './coordination-analysts'
import type {
  CoordinationTools,
  CoordinationToolsOptions,
  SettledWorker,
  WorkerSpawnContext,
} from './coordination-contracts'
import type { createDownMessages } from './coordination-down-messages'
import type { CoordinationEvent } from './coordination-events'
import { safeJsonText } from './coordination-json'
import type { ContinuationInstruction } from './coordination-messages'

export function createCoordinationAnalysis({
  leadReceipts,
  opts,
  ledger,
  bus,
  profileNameByWorker,
  watchWorker,
  liveWorkerIdNamed,
  messages,
  ready,
  ensureDrain,
}: {
  readonly leadReceipts: Map<string, (receipt: InboxReceipt) => void>
  readonly opts: CoordinationToolsOptions
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly bus: EventBus<CoordinationEvent>
  readonly profileNameByWorker: Map<string, string>
  readonly watchWorker: (id: string) => void
  readonly liveWorkerIdNamed: (destination: string) => string | undefined
  readonly messages: () => ReturnType<typeof createDownMessages>
  readonly ready: () => Promise<void>
  readonly ensureDrain: () => Promise<boolean>
}) {
  const analysisRoutes = (opts.analyzeOnSettle ?? []).map(normalizeAnalyzeOnSettle)
  let finishingAnalysis = false
  const analystAssignments = new Map<string, AnalystAssignmentRecord>()
  for (const record of opts.priorJournal ?? []) {
    if (record.event.type !== 'analyst-assignment') continue
    const assignment = record.event.assignment
    const prior = analystAssignments.get(assignment.assignmentId)
    if (prior && canonicalCandidateDigest(prior) !== canonicalCandidateDigest(assignment)) {
      throw new Error(`coordination: conflicting analyst assignment '${assignment.assignmentId}'`)
    }
    analystAssignments.set(assignment.assignmentId, detachedFrozen(assignment))
  }
  const analystRuns = new Map<string, AnalystRunInFlight>()
  const flushedAnalystRuns = new Set<string>()
  let analystRunOrdinal = 0
  for (const assignment of analystAssignments.values()) {
    const ordinal = Number(/:o(\d+)$/.exec(assignment.assignmentId)?.[1])
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal === Number.MAX_SAFE_INTEGER) {
      throw new Error(`coordination: invalid analyst assignment '${assignment.assignmentId}'`)
    }
    analystRunOrdinal = Math.max(analystRunOrdinal, ordinal + 1)
  }
  for (const node of [...(opts.scope.resume?.view.nodes ?? []), ...opts.scope.view.nodes]) {
    if (node.parent !== opts.scope.view.root || !node.assignmentId?.startsWith('analyst:')) continue
    const assignment = analystAssignments.get(node.assignmentId)
    if (!assignment) {
      throw new Error(
        `coordination: analyst assignment '${node.assignmentId}' has no durable source record; refusing to treat its review as a worker result`,
      )
    }
    if (
      node.identity &&
      (node.identity.profileDigest !== assignment.profileDigest ||
        node.identity.taskDigest !== assignment.taskDigest)
    ) {
      throw new Error(
        `coordination: analyst assignment '${node.assignmentId}' conflicts with its journaled execution identity`,
      )
    }
    analystRuns.set(node.id, {
      route: {
        kind: assignment.kind,
        ...(assignment.to === undefined ? {} : { to: assignment.to }),
      },
      sourceWorker: assignment.sourceWorker,
      assignmentId: assignment.assignmentId,
    })
  }
  const analystRunFinding = (
    run: AnalystRunInFlight,
    settled: Settled<unknown>,
  ): CoordinationEvent =>
    detachedFrozen<CoordinationEvent>({
      type: 'finding',
      finding: canonicalFindingEvent({
        fromWorker: run.sourceWorker,
        analyst: run.route.kind,
        analystWorkerId: settled.handle.id,
        assignmentId: run.assignmentId,
        findings: settled.kind === 'done' ? settled.out : { analystRunFailed: settled.reason },
      }),
    })

  /**
   * Spawn one analyst-AGENT run over a settled worker's evidence, through the SAME spawn
   * machinery a driver spawn uses (`scope.spawn` + `makeWorkerAgent`): the analyst's spend
   * reserves from the conserved pool, its node is journaled/traced like any worker, and a
   * node-pinning seam sees `context.analyst`. Its task is the route directive plus the settled
   * worker's persisted tool-trace spans. A refused spawn publishes a finding RECORDING the
   * refusal — observable, never silent — and must never take down the settlement path.
   */
  const spawnAnalystRun = async (
    route: AnalyzeOnSettleRoute,
    worker: SettledWorker,
  ): Promise<void> => {
    let spansText = ''
    let spanCount = 0
    if (worker.trace.status === 'available') {
      try {
        const raw = await opts.blobs.get(worker.trace.traceRef)
        const artifact = parseWorkerToolTraceArtifact(raw, worker.trace.traceRef)
        spanCount = artifact.spans.length
        spansText = safeJsonText(artifact.spans)
      } catch {
        spansText = '' // degraded evidence is stated below, never a thrown settle path
      }
    }
    let output: unknown = null
    let outputError: string | undefined
    if (worker.outRef !== undefined) {
      try {
        output = await opts.blobs.get(worker.outRef)
      } catch (error) {
        outputError = error instanceof Error ? error.message : String(error)
      }
    }
    if (worker.outRef !== undefined && output === undefined && outputError === undefined) {
      outputError = 'referenced output blob unavailable'
    }
    const sourceEvidence = JSON.parse(
      safeJsonText({
        worker,
        output: output ?? null,
        ...(outputError ? { outputError } : {}),
        ...(route.at === 'manager-end'
          ? {
              managerCheckpoint: {
                managerId: opts.scope.view.root,
                nodes: opts.scope.view.nodes
                  .filter((node) => !node.assignmentId?.startsWith('analyst:'))
                  .map((node) => ({
                    id: node.id,
                    parent: node.parent,
                    assignmentId: node.assignmentId,
                    status: node.status,
                  })),
                settled: ledger.map(({ resumed: _resumed, ...row }) => row),
              },
            }
          : {}),
      }),
    ) as unknown
    const sourceEvidenceRef = contentAddress(sourceEvidence)
    await opts.blobs.put(sourceEvidenceRef, sourceEvidence)
    const excerpt = (text: string, limit: number) => ({
      text: text.slice(0, limit),
      totalChars: text.length,
      omittedChars: Math.max(0, text.length - limit),
    })
    const task = [
      ...(route.directive === undefined || route.directive.length === 0 ? [] : [route.directive]),
      `Complete source envelope: ${sourceEvidenceRef}. Source output: ${worker.outRef ?? '(unavailable)'}.`,
      'When your profile grants observe_agent, fetch authorized source refs with {outRef}, following outputPage.nextOffset to read all pages. Without that tool or before fetching all pages, coverage is excerpt-only: leave claims requiring omitted evidence unassessed.',
      `Bounded source excerpt (omitted evidence is not inspected): ${safeJsonText(excerpt(safeJsonText(sourceEvidence), 12000))}`,
      `Source tool trace: ${safeJsonText(worker.trace)} (${spanCount} spans).`,
      spansText.length === 0 ? '(no tool spans available)' : safeJsonText(excerpt(spansText, 8000)),
    ].join('\n\n')
    // Reuse an exact durable assignment after a coordinator restart or repeated finalization.
    // A changed checkpoint is a different investigation and retains its own identity.
    const taskDigest = canonicalCandidateDigest(task)
    if (
      route.at === 'manager-end' &&
      [...analystAssignments.values()].some(
        (assignment) =>
          assignment.sourceWorker === worker.id &&
          assignment.kind === route.kind &&
          assignment.taskDigest === taskDigest &&
          assignment.profileDigest === canonicalAgentProfileDigest(route.agent as AgentProfile),
      )
    )
      return
    const assignmentId = `analyst:${route.kind}:o${analystRunOrdinal++}`
    const label = `analyst:${route.kind}`
    const assignment: AnalystAssignmentRecord = detachedFrozen({
      assignmentId,
      kind: route.kind,
      sourceWorker: worker.id,
      sourceTrace: worker.trace,
      sourceEvidenceRef,
      ...(worker.outRef === undefined ? {} : { sourceOutRef: worker.outRef }),
      profileDigest: canonicalAgentProfileDigest(route.agent as AgentProfile),
      taskDigest,
      ...(route.directive === undefined ? {} : { directive: route.directive }),
      ...(route.to === undefined ? {} : { to: route.to }),
    })
    // Persist before spawn: a crash after admission must not leave an unclassified child.
    await bus.publish({ type: 'analyst-assignment', assignment }, { queue: false })
    analystAssignments.set(assignmentId, assignment)
    const context: WorkerSpawnContext = Object.freeze({
      assignmentId,
      parentNodeId: opts.scope.view.root,
      budget: opts.perWorker,
      task,
      label,
      analyst: route.kind,
      sourceEvidenceRefs: Object.freeze([
        sourceEvidenceRef,
        ...(worker.outRef === undefined ? [] : [worker.outRef]),
        ...(worker.trace.status === 'available' ? [worker.trace.traceRef] : []),
      ]),
      // An analyst run is always a brand-new session over settled evidence — never a resume.
      continuity: 'fresh' as const,
    })
    let refusal: string | undefined
    let spawnedId: string | undefined
    try {
      const res = opts.scope.spawn(
        () => opts.makeWorkerAgent(route.agent as AgentProfile, context),
        task,
        { budget: opts.perWorker, label, assignmentId },
      )
      if (res.ok) spawnedId = res.handle.id
      else refusal = String(res.reason)
    } catch (cause) {
      refusal = cause instanceof Error ? cause.message : String(cause)
    }
    if (spawnedId === undefined) {
      await bus.publish({
        type: 'finding',
        finding: canonicalFindingEvent({
          fromWorker: worker.id,
          analyst: route.kind,
          findings: { analystSpawnRefused: refusal ?? 'unknown' },
        }),
      })
      return
    }
    analystRuns.set(spawnedId, { route, sourceWorker: worker.id, assignmentId })
    if (route.agent?.name) profileNameByWorker.set(spawnedId, route.agent.name)
    watchWorker(spawnedId)
  }

  /**
   * Deliver one routed analyst finding to its destination worker through the SAME authorized
   * steer machinery a driver steer uses, so the delivery is recorded (`steer` event carrying
   * `analyst`) and its outcome is a fact. No live destination ⇒ a record-only failed steer —
   * observable, never a silent drop. A throw here must not kill the settle path: failures are
   * recorded on the bus (a `steer` with `delivered: false`) before being swallowed, with ONE
   * narrow exception — a bus that refuses the `delivery-attempt` record itself leaves only the
   * `instruction` receipt (an attempt with no outcome = explicitly unknown, per
   * recordDeliveryAttempt's own contract).
   */
  const deliverRoutedFinding = async (
    route: AnalyzeOnSettleRoute,
    findings: AnalystLensOutput | unknown,
  ): Promise<void> => {
    const destination = route.to as string
    const text =
      route.directive === undefined || route.directive.length === 0
        ? safeJsonText(findings)
        : `${route.directive}\n\n${safeJsonText(findings)}`
    const targetId = liveWorkerIdNamed(destination)
    if (targetId === undefined) {
      await bus.publish(
        {
          type: 'steer',
          down: detachedFrozen({
            receiptId: randomUUID(),
            toWorker: destination,
            instruction: text,
            instructionDigest: canonicalCandidateDigest(text),
            delivered: false,
            outcome: 'unknown-worker' as const,
          }),
          analyst: route.kind,
        },
        { queue: false },
      )
      return
    }
    let instruction: ContinuationInstruction
    try {
      instruction = messages().authorizeInstruction('steer', targetId, text, false)
      await messages().recordInstruction(instruction)
    } catch (cause) {
      // NOTHING reached the bus for this failure (an authorization refusal, a target without
      // durable identity, a durable subscriber rejecting the instruction record) — record the
      // failed delivery now, in the same `steer` shape a failed attempt publishes, so a routed
      // finding is observable on EVERY failure path, never a silent drop.
      try {
        await messages().sendDown(
          'steer',
          detachedFrozen({
            receiptId: randomUUID(),
            toWorker: targetId,
            instruction: text,
            instructionDigest: canonicalCandidateDigest(text),
            delivered: false,
            outcome: 'runtime-error' as const,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
          route.kind,
        )
      } catch {
        // The bus itself refused the failure record — there is nothing left to record ON, and a
        // routed finding must never take down the settlement path.
      }
      return
    }
    try {
      await messages().attemptDelivery(
        instruction,
        { steer: instruction.instruction, interrupt: false },
        {
          analyst: route.kind,
        },
      )
    } catch {
      // `attemptDelivery` publishes the failed `steer` (delivered:false + outcome) BEFORE
      // rethrowing, so the failure is already on the bus — except when the bus refused the
      // `delivery-attempt` record itself, where only the `instruction` receipt lands (see the
      // docstring). A routed finding must never take down the settlement path.
    }
  }

  // A registry lens spends from the same conserved pool an agent analyst reserves from. Its spend
  // is Runtime-owned accounting on this manager's node: journaled as `metered`, never an owner turn.
  // The lens already ran, so an unknown dollar cost closes dollar admission rather than being
  // refused: a refusal would replace the findings it paid for with `analystRunFailed`.
  const analystRunContext = (kind: string, sourceWorker: string): AnalystRunContext => ({
    charge: (spend) =>
      meterRuntimeOwnedAccounting(
        opts.scope,
        spend,
        { role: 'analyst', analyst: kind, sourceWorker },
        { alreadySpent: true },
      ),
  })

  // ── define_analyst ────────────────────────────────────────────────────────────
  //
  // A manager writes a lens; this layer bounds it, refuses a name already taken, hands it to the
  // registry, journals what was admitted, and adds it to the menu. Refusals are tool RESULTS with a
  // named cause, the same vocabulary `spawn_worker` uses, because a manager that cannot read WHY a
  // definition was refused re-submits the same one.
  const definedAnalysts: DefinedAnalystRecord[] = [...(opts.priorAnalystDefinitions ?? [])]
  const analystMenu = (): ReadonlyArray<AnalystKind> => [
    ...(opts.analysts?.kinds ?? []),
    ...definedAnalysts.map((record) => record.kind),
  ]
  const maxDefinedAnalysts =
    opts.maxDefinedAnalysts ?? ANALYST_DEFINITION_BOUNDS.maxDefinitionsPerManager
  const defineAnalyst = async (raw: unknown): Promise<unknown> => {
    const register = opts.analysts?.register
    if (register === undefined) {
      return {
        error: 'authoring-unavailable' as const,
        reason: "this run's analyst registry admits no authored lens",
      }
    }
    if (maxDefinedAnalysts > 0 && definedAnalysts.length >= maxDefinedAnalysts) {
      return {
        error: 'max-defined-analysts' as const,
        reason: `you have defined ${definedAnalysts.length} lenses, the cap for this manager; run the ones you have instead of defining more`,
        defined: definedAnalysts.map((record) => record.kind.id),
      }
    }
    const parsed = parseAuthoredAnalystDefinition(raw)
    if ('issues' in parsed) {
      return {
        error: 'invalid-definition' as const,
        reason: parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
        issues: parsed.issues,
      }
    }
    const { definition } = parsed
    const taken = analystMenu().find((kind) => kind.id === definition.id)
    if (taken !== undefined) {
      return {
        error: 'duplicate-analyst' as const,
        reason: `the lens id ${JSON.stringify(definition.id)} is already on the menu (${taken.description}); choose a different id or run the existing lens`,
      }
    }
    let kind: AnalystKind
    try {
      kind = await register(definition)
    } catch (error) {
      // The registry is the authority on the model seat and on whether an authored lens is allowed
      // at all. Its message is the manager's re-authoring instruction, so it is passed through.
      return {
        error: 'register-refused' as const,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
    const record: DefinedAnalystRecord = Object.freeze({
      definition,
      kind: Object.freeze({ id: kind.id, description: kind.description, area: kind.area }),
      digest: canonicalCandidateDigest(definition),
      definedAt: Date.now(),
    })
    definedAnalysts.push(record)
    // Record-only: the manager already holds this result, and its own action does not belong in the
    // inbox it pulls from. The event is the durable artifact — the log stamps the owner beside it.
    await bus.publish({ type: 'analyst-defined', analyst: record }, { queue: false })
    return { analyst: record.kind, digest: record.digest, defined: definedAnalysts.length }
  }
  let managerAnalysis: Promise<void> | undefined
  const finishAnalysis: CoordinationTools['finishAnalysis'] = (input) => {
    // This manager takes no further turn: a queued lead message no turn acknowledged is unread.
    for (const [messageId, receipt] of leadReceipts) {
      try {
        receipt({
          status: 'failed',
          messageId,
          cause: 'closed',
          reason: 'the manager finished before a turn read the message',
        })
      } catch {
        // A sender's receipt handler cannot change how this manager ended.
      }
    }
    leadReceipts.clear()

    if (managerAnalysis) return managerAnalysis
    managerAnalysis = (async () => {
      const routes = analysisRoutes.filter(
        (route) =>
          route.at === 'manager-end' && (route.statuses ?? ['done', 'down']).includes(input.status),
      )
      if (routes.length === 0) return
      finishingAnalysis = true
      await ready()
      const outRef = input.output === undefined ? undefined : contentAddress(input.output)
      if (outRef !== undefined) await opts.blobs.put(outRef, input.output)
      const worker: SettledWorker = detachedFrozen({
        id: opts.scope.view.root,
        status: input.status,
        trace: { status: 'unavailable', reason: 'trace-source-unavailable' },
        ...(outRef === undefined ? {} : { outRef }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      for (const route of routes) await spawnAnalystRun(route, worker)
      // The original Scope bounds every review, including deadline and cancellation.
      // Existing research settlements can arrive first; they are retained without spawning
      // more reviews. Analyst output never enters the candidate ledger.
      while (analystRuns.size > 0) {
        if (!(await ensureDrain())) break
      }
    })().catch(async (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      try {
        await bus.publish({
          type: 'finding',
          finding: canonicalFindingEvent({
            fromWorker: opts.scope.view.root,
            analyst: 'manager-end',
            findings: { analystRunFailed: detail },
          }),
        })
      } catch (recordError) {
        // A failed evidence store cannot certify its own receipt. Preserve the research
        // outcome and surface the unavailable analysis record to the controller log.
        console.error('Runtime terminal analysis evidence unavailable', {
          managerId: opts.scope.view.root,
          analysisError: detail,
          recordError: recordError instanceof Error ? recordError.message : String(recordError),
        })
      }
    })
    return managerAnalysis
  }

  return {
    analysisRoutes,
    analystRuns,
    flushedAnalystRuns,
    analystRunFinding,
    spawnAnalystRun,
    deliverRoutedFinding,
    analystRunContext,
    finishAnalysis,
    definedAnalysts,
    analystMenu,
    defineAnalyst,
    isFinishing: () => finishingAnalysis,
  }
}
