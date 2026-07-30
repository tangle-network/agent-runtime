/**
 *
 * MCP binding for a live `Scope`. A sandbox driver gets the same small verbs
 * the in-process driver has: spawn, observe, await, steer, ask/answer, analyze,
 * and stop. Settled outputs remain Scope artifacts; product code can project
 * them into any UI/report envelope it needs.
 *
 * @experimental
 */

import type {
  AnalystRunInputs,
  AnalystRunResult,
  RegistryRunOpts,
} from '@tangle-network/agent-eval/analyst'
import { toolSpansToTraceAnalysisStore } from '@tangle-network/agent-eval/traces'
import type {
  Budget,
  ResultBlobStore,
  Scope,
  Settled,
  Agent as SuperviseAgent,
} from '../../runtime'
import { freeSlots } from '../../runtime/supervise/dispatch'
import { type BusRecord, type BusStats, createEventBus } from '../../runtime/supervise/event-bus'
import type { WorkerProgress } from '../../runtime/supervise/progress'
import type { McpToolDescriptor } from '../server'

/** A worker the driver has drained via `await_event`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
  /** Epoch ms the ledger recorded this settlement — the resolution a progress-based stop rule
   *  needs to answer "how long since anything landed?" without inventing a timestamp at read
   *  time. Stamped when the cursor yields the settlement, not when a reader first looks. */
  readonly settledAt?: number
}

export interface QuestionOption {
  readonly label: string
  readonly tradeoff: string
}

export interface Question {
  readonly id: string
  readonly from: string
  readonly question: string
  readonly reason?: string
  readonly options?: ReadonlyArray<QuestionOption>
}

export interface QuestionAnswer {
  readonly text: string
  /** Null only when migrating a legacy record that never captured attribution. */
  readonly by: string | null
}

export interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered'
  readonly answer?: QuestionAnswer
  readonly openedAt: number
}

export type ParentQuestion = Omit<Question, 'id' | 'from'>

export interface ParentQuestionRequest extends ParentQuestion {
  /** Caller-stable request identity used to deduplicate transport retries. */
  readonly requestId: string
}

/** Explicit upward question route. The runtime supplies the trusted source node. */
export interface ParentQuestionPort {
  ask(sourceNodeId: string, question: ParentQuestionRequest): Promise<QuestionRecord>
}

export interface AnalystRegistry {
  list(): ReadonlyArray<{ id: string }>
  run(runId: string, inputs: AnalystRunInputs, opts?: RegistryRunOpts): Promise<AnalystRunResult>
}

/** A trace-analyst result re-entered as a message on the bus (the `finding` event kind). */
export interface AnalystFindingEvent {
  readonly fromWorker: string
  readonly analyst: string
  readonly findings: unknown
}

/** A parent→child message (the down-leg): recorded for observability, delivered via the child inbox,
 *  never pulled back by the parent. `delivered` mirrors whether the live child accepted it. */
export interface DownMessageEvent {
  readonly messageId: string
  readonly toWorker: string
  readonly instruction: string
  readonly deliveryMode: 'queued' | 'interrupt'
}

export interface DeliveryReceiptEvent {
  readonly messageId: string
  readonly delivered: boolean
}

/** Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 *  the driver to `pull`. DOWN (parent→child): steer / answer — record-only (history + subscribers),
 *  routed to the child inbox. New kinds are additive. */
export type CoordinationEvent =
  | { readonly type: 'question'; readonly question: QuestionRecord }
  | { readonly type: 'settled'; readonly worker: SettledWorker }
  | { readonly type: 'finding'; readonly finding: AnalystFindingEvent }
  | { readonly type: 'steer'; readonly down: DownMessageEvent }
  | { readonly type: 'delivery'; readonly receipt: DeliveryReceiptEvent }
  | {
      readonly type: 'answer'
      readonly questionId: string
      readonly answer: QuestionAnswer
    }

export type MakeWorkerAgent = (
  profile: unknown,
  parentQuestionPort: ParentQuestionPort,
) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly workerShutdown: number | 'brutalKill' | 'infinity'
  /**
   * The same independent completion check used for workers. When present, the driver receives a
   * `submit_result` tool and may finish work itself instead of being forced to delegate it. The
   * first passing submission is retained; a false or throwing check fails closed.
   */
  readonly analysts: AnalystRegistry | null
  readonly onEvent: ((record: BusRecord<CoordinationEvent>) => void | Promise<void>) | null
  /** Explicit route to this coordinator's parent. Null means this is the root. */
  readonly parentQuestionPort: ParentQuestionPort | null
  /** Hard cap on how many workers may be LIVE (spawned but not yet settled) at once. `spawn_agent`
   *  counts the scope's non-terminal nodes and fails closed (`error: 'max-live-workers'`) BEFORE
   *  reserving from the pool when the cap is already met — a concurrency fence on top of the
   *  conserved-budget fence (the pool bounds total work; this bounds simultaneous work, e.g. live
   *  sandboxes/boxes). Omit or `<= 0` = no cap (the prior behavior; the pool stays the only fence). */
  readonly maxLiveWorkers: number | null
  /** Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
   *  before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
   *  The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
   *  transport that block outlives the client's per-request timeout, so an unbounded await surfaces
   *  to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
   *  blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
   *  drain keeps running, so a settlement that lands after the bound is published to the bus and
   *  pulled by the next call — nothing is lost. `<= 0` selects an unbounded wait. */
  readonly awaitTimeoutMs: number
  /**
   * How long a worker may go without metered activity before `observe_agent` reports it as
   * `stalled`. A derived read at observation time, never a background watchdog — nothing is
   * killed or retried. Omit = the runtime default.
   */
  /** Explicit null disables stalled classification; undefined retains the legacy default. */
  readonly stallAfterMs: number | null
  /**
   * Questions carried over from a prior process of the SAME run (a durable coordination log a
   * resuming caller replays). Seeded into the question ledger verbatim — `list_questions` shows
   * them and `answer_question` can answer them.
   * Omit/empty = fresh ledger (every run that is not a resume).
   */
  readonly priorRecords: ReadonlyArray<BusRecord<CoordinationEvent>>
  /** The run's single clock, shared with the scope and coordination log. */
  readonly now: () => number
}

/**
 * The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool
 * descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
 * over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
 * `raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
 * choice, steerable counterpart to the one-shot own-sandbox delegation MCP.
 */
export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  /** The first result the agent explicitly submitted. */
  submittedResult(): { readonly result: unknown } | undefined
  settled(): ReadonlyArray<SettledWorker>
  questions(): ReadonlyArray<QuestionRecord>
  /** The full ordered log of every bus event — UP (settled / question / finding) and DOWN
   *  (steer / answer) — the observability audit + replay trail. Each record carries seq,
   *  timestamp, and priority. */
  history(): ReadonlyArray<BusRecord<CoordinationEvent>>
  /** Bus throughput counters (published / pulled / by-kind) for live dashboards. */
  stats(): BusStats
  /** Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
   *  (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
   *  moment it happens, instead of only at settle. Queued for `await_event` + pass-through. */
  raiseFinding(finding: AnalystFindingEvent): Promise<void>
  /**
   * Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
   * as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
   * calls this once its brain loop ends, so a delivered child the brain never awaited still
   * reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
   * driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
   * nobody is left to read a finding, and analysts spend real compute). Returns the count.
   */
  drainResolved(): Promise<number>
}

/** The reserved coordination verb names — the complete set `createCoordinationTools` can emit
 *  (the analyst pair is conditional but still reserved). A driver's extra WORK tools must not
 *  collide with any of these, or it could no longer coordinate; callers validate eagerly against
 *  this set so the conflict fails loud at construction, not buried in a swallowed `act()` throw. */
export const coordinationVerbNames = [
  'spawn_agent',
  'observe_agent',
  'steer_agent',
  'await_event',
  'list_questions',
  'answer_question',
  'ask_parent',
  'submit_result',
  'list_analysts',
  'run_analyst',
] as const

const idArg = { type: 'string', description: 'The workerId returned by spawn_agent.' } as const

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  assertExplicitCoordinationOptions(opts)
  const now = opts.now
  let submitted: { readonly result: unknown } | undefined
  const ledger: SettledWorker[] = []
  const questions: QuestionRecord[] = foldQuestions(opts.priorRecords)
  const questionWaiters = new Map<
    string,
    Set<{
      resolve: (question: QuestionRecord) => void
      reject: (error: unknown) => void
    }>
  >()

  // Keyed-assignment bookkeeping for the live-worker fence. `completedKeys` is every key this run
  // can already answer from committed work — seeded from the prior journal on a resume, extended as
  // keyed workers deliver in THIS process. A spawn under such a key starts nothing and occupies no
  // slot, so the fence must not hold it back. `keyByWorker` is what lets a settlement find its key.
  const completedKeys = new Set<string>()
  const keyByWorker = new Map<string, string>()
  const blockedKeys = new Map<
    string,
    { readonly priorWorkerId: string; readonly priorState: 'down' | 'in-doubt' }
  >()
  for (const [key, prior] of opts.scope.resume?.keys ?? []) {
    if (prior.state === 'completed') completedKeys.add(key)
    else {
      blockedKeys.set(key, {
        priorWorkerId: prior.id,
        priorState: prior.state,
      })
    }
  }

  // A resumed scope's replayed settlements enter the ledger AT CONSTRUCTION, so `settled()` — and
  // therefore the finalize that reads it — spans processes exactly as the journal does. They are
  // NOT re-published on the bus: the driver's resume brief already lists them, and the scope
  // cursor only yields THIS process's children, so nothing double-counts.
  for (const s of opts.scope.resume?.settled ?? []) {
    ledger.push(
      s.kind === 'done'
        ? {
            id: s.handle.id,
            status: 'done',
            ...(s.verdict?.score === undefined ? {} : { score: s.verdict.score }),
            ...(s.verdict?.valid === undefined ? {} : { valid: s.verdict.valid }),
            outRef: s.outRef,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason },
    )
  }

  // The one child→parent pipe. `onEvent` (back-compat) becomes a pass-through subscriber receiving
  // the bare event, so every kind — question, settled, finding — reaches it immediately, and the
  // driver pulls queued findings / questions via `await_event`.
  const openQuestionIds = new Set(
    questions.filter((question) => question.status === 'open').map((question) => question.id),
  )
  const queuedPriorSeqs = opts.priorRecords
    .filter(
      (record) =>
        record.event.type === 'finding' ||
        (record.event.type === 'question' && openQuestionIds.has(record.event.question.id)),
    )
    .map((record) => record.seq)
  const bus = createEventBus<CoordinationEvent>({
    now,
    priorRecords: opts.priorRecords,
    queuedPriorSeqs,
  })
  if (opts.onEvent) {
    const cb = opts.onEvent
    bus.subscribe(cb)
  }

  const str = (v: unknown, field: string): string => {
    if (typeof v !== 'string' || v.length === 0)
      throw new Error(`coordination tools: "${field}" must be a non-empty string`)
    return v
  }
  const obj = (raw: unknown): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object')
      throw new Error('coordination tools: arguments must be an object')
    return raw as Record<string, unknown>
  }
  const parseBudget = (raw: unknown): Budget => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('coordination tools: "budget" must be an object')
    const o = raw as Record<string, unknown>
    const requiredNumber = (name: keyof Budget): number => {
      const v = o[name]
      if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error(`coordination tools: "budget.${name}" must be a finite number`)
      return v
    }
    const nullableNumber = (name: 'maxUsd' | 'deadlineMs'): number | null => {
      const v = o[name]
      if (v === null) return null
      if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error(`coordination tools: "budget.${name}" must be a finite number or null`)
      return v
    }
    const maxIterations = requiredNumber('maxIterations')
    const maxTokens = requiredNumber('maxTokens')
    const maxUsd = nullableNumber('maxUsd')
    const deadlineMs = nullableNumber('deadlineMs')
    return {
      maxIterations,
      maxTokens,
      ...(maxUsd === null ? {} : { maxUsd }),
      ...(deadlineMs === null ? {} : { deadlineMs }),
    }
  }
  const recordSettled = (s: Settled<unknown>): SettledWorker => {
    const settledAt = now()
    // A keyed assignment that just delivered is complete for the rest of this run, so a later
    // spawn under the same key resolves for free instead of being held behind the live-worker
    // fence (it starts no worker, so it occupies no slot).
    const settledKey = keyByWorker.get(s.handle.id)
    if (settledKey !== undefined && s.kind === 'done') completedKeys.add(settledKey)
    if (settledKey !== undefined && s.kind === 'down') {
      blockedKeys.set(settledKey, {
        priorWorkerId: s.handle.id,
        priorState: 'down',
      })
    }
    const w: SettledWorker =
      s.kind === 'done'
        ? {
            id: s.handle.id,
            status: 'done',
            ...(s.verdict?.score === undefined ? {} : { score: s.verdict.score }),
            ...(s.verdict?.valid === undefined ? {} : { valid: s.verdict.valid }),
            outRef: s.outRef,
            settledAt,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason, settledAt }
    ledger.push(w)
    return w
  }

  // Producer: drain exactly one settlement from the scope cursor onto the bus. The cursor is a
  // once-per-child source, so a settlement is produced at most once.
  const drainSettlement = async (): Promise<boolean> => {
    const s = await opts.scope.next()
    if (!s) return false
    const w = recordSettled(s)
    await bus.publish({ type: 'settled', worker: w }, { priority: 0, queue: true })
    return true
  }

  // Post-loop drain: every ALREADY-settled, unpulled child enters the ledger + audit trail. No
  // analyst-on-settle here — the driver has stopped, so a finding has no reader and an analyst
  // spawn would spend real compute for nothing.
  const drainResolved = async (): Promise<number> => {
    let drained = 0
    for (;;) {
      const s = await opts.scope.nextResolved()
      if (!s) return drained
      const w = recordSettled(s)
      await bus.publish({ type: 'settled', worker: w }, { priority: 0, queue: true })
      drained += 1
    }
  }

  const sendSteer = async (down: DownMessageEvent): Promise<boolean | null> => {
    const priorIntent = bus
      .history()
      .find(
        (record) => record.event.type === 'steer' && record.event.down.messageId === down.messageId,
      )
    if (priorIntent?.event.type === 'steer') {
      if (
        priorIntent.event.down.toWorker !== down.toWorker ||
        priorIntent.event.down.instruction !== down.instruction ||
        priorIntent.event.down.deliveryMode !== down.deliveryMode
      ) {
        throw new Error(
          `steer messageId ${JSON.stringify(down.messageId)} was reused with different content`,
        )
      }
      const receipt = bus
        .history()
        .find(
          (record) =>
            record.event.type === 'delivery' && record.event.receipt.messageId === down.messageId,
        )
      return receipt?.event.type === 'delivery' ? receipt.event.receipt.delivered : null
    }
    await bus.publish({ type: 'steer', down }, { priority: 0, queue: false })
    const delivered = opts.scope.send(down.toWorker, {
      messageId: down.messageId,
      steer: down.instruction,
      deliveryMode: down.deliveryMode,
    })
    await bus.publish(
      { type: 'delivery', receipt: { messageId: down.messageId, delivered } },
      { priority: 0, queue: false },
    )
    return delivered
  }

  // Consumer projection: the wire shape the driver sees for a pulled bus event.
  const projectEvent = (ev: CoordinationEvent): Record<string, unknown> => {
    if (ev.type === 'settled') {
      const w = ev.worker
      return w.status === 'done'
        ? {
            type: 'settled',
            settled: w.id,
            status: 'done',
            score: w.score,
            valid: w.valid,
            outRef: w.outRef,
          }
        : { type: 'settled', settled: w.id, status: 'down', reason: w.reason }
    }
    if (ev.type === 'question') return { type: 'question', question: ev.question }
    if (ev.type === 'finding') return { type: 'finding', ...ev.finding }
    if (ev.type === 'answer')
      return { type: 'answer', questionId: ev.questionId, answer: ev.answer }
    if (ev.type === 'delivery') return { type: 'delivery', ...ev.receipt }
    // Down-leg `steer` is record-only (never queued), so the driver never pulls it; project
    // defensively for completeness.
    return { type: ev.type, ...ev.down }
  }

  const normalizeQuestion = (from: string, q: ParentQuestionRequest): Question => {
    const trustedFrom = str(from, 'from')
    return {
      id: `${trustedFrom}:q:${encodeURIComponent(str(q.requestId, 'requestId'))}`,
      from: trustedFrom,
      question: str(q.question, 'question'),
      ...(typeof q.reason === 'string' && q.reason.length > 0 ? { reason: q.reason } : {}),
      ...(q.options ? { options: q.options } : {}),
    }
  }
  const addQuestion = (from: string, raw: ParentQuestionRequest): QuestionRecord => {
    const q = normalizeQuestion(from, raw)
    const record: QuestionRecord = {
      ...q,
      status: 'open',
      openedAt: now(),
    }
    questions.push(record)
    return record
  }
  const sameQuestion = (a: QuestionRecord, b: Question): boolean =>
    a.id === b.id &&
    a.from === b.from &&
    a.question === b.question &&
    a.reason === b.reason &&
    JSON.stringify(a.options) === JSON.stringify(b.options)
  const waitForQuestionAnswer = (question: QuestionRecord): Promise<QuestionRecord> =>
    new Promise<QuestionRecord>((resolve, reject) => {
      const waiters = questionWaiters.get(question.id) ?? new Set()
      waiters.add({ resolve, reject })
      questionWaiters.set(question.id, waiters)
    })
  const askQuestion = async (from: string, raw: ParentQuestionRequest): Promise<QuestionRecord> => {
    const normalized = normalizeQuestion(from, raw)
    const existing = questions.find((question) => question.id === normalized.id)
    if (existing) {
      if (!sameQuestion(existing, normalized)) {
        throw new Error(
          `question requestId ${JSON.stringify(raw.requestId)} was reused with different content`,
        )
      }
      return existing.status === 'answered' ? existing : waitForQuestionAnswer(existing)
    }
    const question = addQuestion(from, raw)
    const awaited = waitForQuestionAnswer(question)
    try {
      await bus.publish({ type: 'question', question }, { priority: 0, queue: true })
    } catch (error) {
      for (const waiter of questionWaiters.get(question.id) ?? []) waiter.reject(error)
      questionWaiters.delete(question.id)
      throw error
    }
    return awaited
  }
  const answerQuestion = async (
    questionId: string,
    answer: { readonly text: string; readonly by: string },
  ): Promise<QuestionRecord> => {
    const idx = questions.findIndex((q) => q.id === questionId)
    if (idx < 0) throw new Error(`unknown questionId ${JSON.stringify(questionId)}`)
    const prior = questions[idx] as QuestionRecord
    if (prior.status === 'answered') {
      if (prior.answer?.text === answer.text && prior.answer.by === answer.by) return prior
      throw new Error(`question ${JSON.stringify(questionId)} already has a different answer`)
    }
    await bus.publish({ type: 'answer', questionId, answer }, { priority: 0, queue: false })
    const next: QuestionRecord = { ...prior, status: 'answered', answer }
    questions[idx] = next
    for (const waiter of questionWaiters.get(questionId) ?? []) waiter.resolve(next)
    questionWaiters.delete(questionId)
    return next
  }

  // Count workers that are LIVE — spawned but not yet settled — off the scope's in-memory live set
  // (O(live), synchronous). The terminal statuses are done/failed/cancelled; everything else
  // (pending/acquiring/running) is still in flight. This is the concurrency fence's input.
  const maxLiveWorkers = opts.maxLiveWorkers
  const isLive = (status: string): boolean =>
    status !== 'done' && status !== 'failed' && status !== 'cancelled'
  const liveWorkerCount = (): number => opts.scope.view.nodes.filter((n) => isLive(n.status)).length

  // A snapshot of every still-in-flight worker — the liveness signal a bounded `await_event`
  // returns when its wait elapses, so the supervisor can tell "worker still running, keep waiting"
  // apart from "nothing is happening" (the distinction it lost when the unbounded await erred out).
  const liveSnapshot = (): Array<{ id: string; status: string; spent: unknown }> =>
    opts.scope.view.nodes
      .filter((n) => isLive(n.status))
      .map((n) => ({ id: n.id, status: n.status, spent: n.spent }))

  // How many workers the driver could open RIGHT NOW without hitting the simultaneity fence, or
  // `null` when no cap is set (the conserved pool is then the only fence, so there is no finite
  // slot count). Without this the brain could see WHO is running but never that capacity was idle,
  // so filling N slots meant emitting N blind tool calls with no feedback telling it to — the
  // mechanical reason a 5-worker run peaked at 2 live workers. Policy (whether to fill) stays with
  // the driver; this is only the reading.
  const freeWorkerSlots = (): number | null =>
    freeSlots(liveWorkerCount(), maxLiveWorkers ?? undefined)

  // The LIVE read of one worker. Guarded because `createCoordinationTools` is bound to a `Scope`
  // it did not construct — an older or hand-rolled scope may not implement `progress` at all, and
  // an observation must degrade to "no progress available", never throw at the driver.
  const readProgress = (id: string): WorkerProgress | undefined => {
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.progress !== 'function') return undefined
    try {
      return scope.progress(id, {
        stallAfterMs: opts.stallAfterMs === null ? Number.POSITIVE_INFINITY : opts.stallAfterMs,
      })
    } catch {
      return undefined
    }
  }

  // The blocking `scope.next()` (via `drainSettlement`) waits on a LIVE worker for its whole run.
  // Keep at most ONE such drain in flight and let every concurrent `await_event` race THAT single
  // promise against a timeout — so a bounded call never starts a second unbounded block, and the
  // one drain still delivers the settlement (exactly-once via the scope cursor) whenever it lands.
  const awaitTimeoutMs = opts.awaitTimeoutMs
  let inFlightDrain: Promise<boolean> | null = null
  const ensureDrain = (): Promise<boolean> => {
    if (!inFlightDrain)
      inFlightDrain = drainSettlement().finally(() => {
        inFlightDrain = null
      })
    return inFlightDrain
  }
  // Resolve `{ drained }` if the drain wins, or `undefined` if the bound elapses first. A `<= 0`
  // bound restores the prior unbounded block (no timer): the caller opted out of the fence.
  const raceDrainWithTimeout = async (
    drain: Promise<boolean>,
  ): Promise<{ drained: boolean } | undefined> => {
    if (awaitTimeoutMs <= 0) return { drained: await drain }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), awaitTimeoutMs)
      // Never let this fence-timer alone keep the process alive (e.g. at teardown).
      if (typeof timer?.unref === 'function') timer.unref()
    })
    try {
      return await Promise.race([drain.then((drained) => ({ drained })), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const tools: McpToolDescriptor[] = [
    {
      name: 'spawn_agent',
      description:
        'Spawn one child with an exact profile, task, label, and budget ceiling. A completed key ' +
        'returns its committed result. A live, failed, or interrupted prior key is refused.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { description: 'The worker/driver profile to run.' },
          task: { description: 'The task the worker should perform.' },
          label: { type: 'string', description: 'Trace label.' },
          key: {
            type: 'string',
            description:
              'Optional semantic name for this assignment (e.g. "summarize-ch3"). The same key ' +
              'never runs twice: completed keys return their committed result, even after a ' +
              'coordinator restart.',
          },
          budget: {
            type: 'object',
            description:
              'This child’s complete requested ceiling. Use null for an uncapped optional channel.',
            properties: {
              maxIterations: { type: 'number' },
              maxTokens: { type: 'number' },
              maxUsd: { type: ['number', 'null'] },
              deadlineMs: { type: ['number', 'null'] },
            },
            required: ['maxIterations', 'maxTokens', 'maxUsd', 'deadlineMs'],
          },
        },
        required: ['profile', 'task', 'label', 'budget'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const key = a.key === undefined ? undefined : str(a.key, 'key')
        const priorKey = key === undefined ? undefined : blockedKeys.get(key)
        if (priorKey) {
          return Promise.resolve({
            error: 'prior-key-in-doubt' as const,
            priorWorkerId: priorKey.priorWorkerId,
            priorState: priorKey.priorState,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        }
        // A key already proven complete — by the resumed journal or by a delivery earlier in this
        // run — resolves to committed work and starts no live worker, so the concurrency fence
        // does not apply to it.
        const keyCompleted = key !== undefined && completedKeys.has(key)
        // Concurrency fence FIRST — fail closed before reserving budget, so a rejected spawn never
        // touches the pool. The conserved pool bounds TOTAL work; this bounds SIMULTANEOUS work.
        if (
          !keyCompleted &&
          maxLiveWorkers !== null &&
          maxLiveWorkers > 0 &&
          liveWorkerCount() >= maxLiveWorkers
        )
          return Promise.resolve({
            error: 'max-live-workers' as const,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        let bindChildId: ((id: string) => void) | undefined
        const childId = new Promise<string>((resolve) => {
          bindChildId = resolve
        })
        const parentQuestionPort: ParentQuestionPort = {
          async ask(sourceNodeId, question) {
            const exactChildId = await childId
            if (sourceNodeId !== exactChildId) {
              throw new Error(
                `ask_parent source mismatch: expected ${JSON.stringify(exactChildId)}, received ${JSON.stringify(sourceNodeId)}`,
              )
            }
            return askQuestion(exactChildId, question)
          },
        }
        const agent = opts.makeWorkerAgent(a.profile, parentQuestionPort)
        const budget = parseBudget(a.budget)
        const res = opts.scope.spawn(agent, a.task, {
          budget,
          label: str(a.label, 'label'),
          shutdown: opts.workerShutdown,
          ...(key !== undefined ? { key } : {}),
        })
        // A keyed spawn that resolved to committed work: NOTHING ran — return the finished result
        // (it is already in the settled ledger, seeded from the resumed scope or recorded when the
        // cursor yielded it), so the driver folds it in without an await_event round-trip.
        if (res.ok && res.prior?.state === 'completed') {
          const s = res.prior.settled
          if (key !== undefined) completedKeys.add(key)
          return Promise.resolve({
            workerId: s.handle.id,
            resumed: 'completed' as const,
            status: 'done' as const,
            ...(s.verdict?.score === undefined ? {} : { score: s.verdict.score }),
            ...(s.verdict?.valid === undefined ? {} : { valid: s.verdict.valid }),
            outRef: s.outRef,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        }
        if (res.ok) {
          bindChildId?.(res.handle.id)
          // Bind the new worker to its key so its settlement can mark the key complete.
          if (key !== undefined) keyByWorker.set(res.handle.id, key)
        }
        // Report the REMAINING capacity alongside the spawn, so one tool call tells the driver
        // both "it started" and "you can still open N more" — the feedback that lets it fill
        // slots instead of opening one worker per turn. `null` = uncapped. A fresh spawn under a
        // key with a failed/lost prior attempt carries that history (`resumed`/`priorWorkerId`),
        // so a re-run is always explicit, never a silent duplicate.
        return Promise.resolve(
          res.ok
            ? {
                workerId: res.handle.id,
                live: liveWorkerCount(),
                freeSlots: freeWorkerSlots(),
              }
            : { error: res.reason, live: liveWorkerCount(), freeSlots: freeWorkerSlots() },
        )
      },
    },
    {
      name: 'observe_agent',
      description:
        'Inspect a worker WHILE IT RUNS, not only after it finishes: status, spend so far, and ' +
        '`progress` — how long since it last did anything (`idleMs`), whether that counts as ' +
        'stalled, how many turns it has taken, the last tools/files it touched ' +
        '(`recentActivity`), whether a steer can even reach it (`steerable`), and how many ' +
        'steers it has not yet read (`pendingMessages`). Returns the settled output artifact ' +
        'once it exists.',
      inputSchema: { type: 'object', properties: { workerId: idArg }, required: ['workerId'] },
      handler: async (raw) => {
        const id = str(obj(raw).workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) {
          // A worker from a PRIOR process of this run: not in the live nursery, but its committed
          // record is on the resumed view — observable like any settled worker, marked `resumed`.
          const resumed = opts.scope.resume?.view.nodes.find((n) => n.id === id)
          if (!resumed) return { error: `unknown workerId ${JSON.stringify(id)}` }
          const output = resumed.outRef ? await opts.blobs.get(resumed.outRef) : undefined
          return {
            status: resumed.status,
            spent: resumed.spent,
            outRef: resumed.outRef ?? null,
            output: output ?? null,
            progress: null,
            resumed: true,
          }
        }
        const output = node.outRef ? await opts.blobs.get(node.outRef) : undefined
        const progress = readProgress(id)
        return {
          status: node.status,
          spent: node.spent,
          outRef: node.outRef ?? null,
          output: output ?? null,
          progress: progress ?? null,
        }
      },
    },
    {
      name: 'steer_agent',
      description: 'Deliver one identified message to a live child.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          messageId: {
            type: 'string',
            description: 'Caller-stable idempotency identity for this message.',
          },
          instruction: { type: 'string', description: 'What the worker should do next.' },
          deliveryMode: {
            type: 'string',
            enum: ['queued', 'interrupt'],
          },
        },
        required: ['workerId', 'messageId', 'instruction', 'deliveryMode'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const messageId = str(a.messageId, 'messageId')
        const instruction = str(a.instruction, 'instruction')
        const deliveryMode = parseDeliveryMode(a.deliveryMode)
        const delivered = await sendSteer({
          messageId,
          toWorker: workerId,
          instruction,
          deliveryMode,
        })
        if (delivered === null) {
          return {
            delivered,
            reason: 'delivery-in-doubt',
            progress: readProgress(workerId) ?? null,
          }
        }
        if (delivered) return { delivered, progress: readProgress(workerId) ?? null }
        // Say WHY nothing landed. A silent `delivered:false` is how steering became a no-op:
        // the driver could not tell "already finished" from "this runtime has no inbox at all".
        const progress = readProgress(workerId)
        const reason = !progress
          ? 'unknown-worker'
          : !progress.live
            ? 'already-settled'
            : 'runtime-has-no-inbox'
        return { delivered, reason, progress: progress ?? null }
      },
    },
    {
      name: 'await_event',
      description:
        'Wait for and pull the next message a worker, sub-driver, or analyst sent up — the unified ' +
        "inbox. An event is one of: a settled worker output ('settled'), a question needing your " +
        "answer ('question', from ask_parent / the worker's ask-user), or a trace-analyst finding " +
        "('finding', from analyze-on-settle). Pass kinds:['settled'] for just the next finished " +
        'worker; omit `kinds` to also receive questions and findings. Returns { idle: true } when ' +
        'nothing is queued and no workers are live. If a worker is still running when the wait ' +
        'elapses, returns { pending: true, live: [...] } (the workers still in flight) instead of ' +
        'blocking indefinitely; the settlement remains available to a later call. ' +
        'Every reply carries `freeSlots`: how many more workers you can start right now (`null` = ' +
        'uncapped).',
      inputSchema: {
        type: 'object',
        properties: {
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['settled', 'question', 'finding'] },
            description: 'Restrict to these event kinds (any if omitted).',
          },
        },
      },
      handler: async (raw) => {
        const k = obj(raw).kinds
        const kinds = Array.isArray(k)
          ? (k.filter((x) => x === 'settled' || x === 'question' || x === 'finding') as Array<
              CoordinationEvent['type']
            >)
          : undefined
        // Already-queued async messages (findings, questions) first — a fast, non-blocking pull.
        let ev = bus.pull(kinds)
        // Every return from this verb carries `freeSlots` — a settlement is exactly the moment
        // capacity frees up, so the answer travels with the event that freed it.
        if (ev) return { ...projectEvent(ev), freeSlots: freeWorkerSlots() }
        // Else drive the cursor to produce the next settlement — but BOUND the block. `scope.next()`
        // waits on a live worker for its entire (multi-minute) run; unbounded, that outlives a remote
        // MCP client's request timeout and surfaces as a hard tool error, leaving the supervisor with
        // no working "wait for the worker" primitive. Race the single in-flight drain against the
        // fence: if it settles in time, re-pull and return the event (or idle when the cursor is dry);
        // if the fence wins, return a non-error liveness snapshot the supervisor can re-poll on.
        const raced = await raceDrainWithTimeout(ensureDrain())
        if (raced === undefined)
          return { pending: true, live: liveSnapshot(), freeSlots: freeWorkerSlots() }
        ev = bus.pull(kinds)
        if (!ev) return { idle: !raced.drained, freeSlots: freeWorkerSlots() }
        return { ...projectEvent(ev), freeSlots: freeWorkerSlots() }
      },
    },
    {
      name: 'list_questions',
      description: 'List questions raised by direct children and their recorded answers.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ questions }),
    },
    {
      name: 'answer_question',
      description: 'Answer a child question and deliver the exact answer back to that child.',
      inputSchema: {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['questionId', 'answer'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const questionId = str(a.questionId, 'questionId')
        const answer = str(a.answer, 'answer')
        const by = opts.scope.view.root
        const question = await answerQuestion(questionId, { text: answer, by })
        return { question }
      },
    },
    ...(opts.parentQuestionPort
      ? [
          {
            name: 'ask_parent',
            description: 'Send a question to this coordinator’s direct parent.',
            inputSchema: {
              type: 'object',
              properties: {
                requestId: {
                  type: 'string',
                  description: 'Caller-stable identity for transport retry deduplication.',
                },
                question: { type: 'string' },
                reason: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      tradeoff: { type: 'string' },
                    },
                    required: ['label', 'tradeoff'],
                  },
                },
              },
              required: ['requestId', 'question'],
            },
            handler: async (raw: unknown) => {
              const a = obj(raw)
              const options = Array.isArray(a.options)
                ? a.options.map((rawOption) => {
                    const option = obj(rawOption)
                    return {
                      label: str(option.label, 'options.label'),
                      tradeoff: str(option.tradeoff, 'options.tradeoff'),
                    }
                  })
                : undefined
              const question = await opts.parentQuestionPort?.ask(opts.scope.view.root, {
                requestId: str(a.requestId, 'requestId'),
                question: str(a.question, 'question'),
                ...(typeof a.reason === 'string' && a.reason.length > 0
                  ? { reason: a.reason }
                  : {}),
                ...(options ? { options } : {}),
              })
              return { question }
            },
          } satisfies McpToolDescriptor,
        ]
      : []),
    {
      name: 'submit_result',
      description: 'Commit this agent’s result. The first submission is retained.',
      inputSchema: {
        type: 'object',
        properties: {
          result: {
            description: 'The result to retain.',
          },
        },
        required: ['result'],
        additionalProperties: false,
      },
      handler: async (raw: unknown) => {
        if (submitted) {
          return {
            accepted: true,
            retained: 'earlier-submission',
          }
        }
        const a = obj(raw)
        if (!Object.hasOwn(a, 'result')) {
          throw new Error('submit_result: "result" is required')
        }

        const result = structuredClone(a.result)
        if (submitted) {
          return {
            accepted: true,
            retained: 'earlier-submission',
          }
        }

        submitted = Object.freeze({ result })
        return { accepted: true, retained: 'this-submission' }
      },
    },
  ]

  if (opts.analysts) {
    tools.push({
      name: 'list_analysts',
      description: 'List registered trace analysts.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: opts.analysts?.list() }),
    })
    tools.push({
      name: 'run_analyst',
      description: 'Run one registered analyst against a child tool trace.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'The analyst kind id.' },
          workerId: idArg,
        },
        required: ['kind', 'workerId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const id = str(a.workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) return { error: `unknown workerId ${JSON.stringify(id)}` }
        const source = opts.scope.traceSource(id)
        if (!source) {
          throw new Error(`worker ${JSON.stringify(id)} exposes no tool trace`)
        }
        const spans = await source.collect()
        const traceStore = toolSpansToTraceAnalysisStore(spans)
        const kind = str(a.kind, 'kind')
        const result = await opts.analysts?.run(id, { traceStore }, { only: [kind] })
        return { result }
      },
    })
  }

  return {
    tools,
    history: () => bus.history(),
    raiseFinding: (finding) =>
      bus.publish({ type: 'finding', finding }, { priority: 0, queue: true }).then(() => undefined),
    stats: () => bus.stats(),
    submittedResult: () => submitted,
    settled: () => ledger,
    questions: () => questions,
    drainResolved,
  }
}

function assertExplicitCoordinationOptions(opts: CoordinationToolsOptions): void {
  const required = [
    'scope',
    'blobs',
    'makeWorkerAgent',
    'workerShutdown',
    'analysts',
    'onEvent',
    'parentQuestionPort',
    'maxLiveWorkers',
    'awaitTimeoutMs',
    'stallAfterMs',
    'priorRecords',
    'now',
  ] as const
  for (const field of required) {
    if (!Object.hasOwn(opts, field)) {
      throw new Error(`coordination tools: "${field}" must be supplied explicitly`)
    }
  }
  if (typeof opts.now !== 'function') {
    throw new Error('coordination tools: "now" must be a function')
  }
  if (!Array.isArray(opts.priorRecords)) {
    throw new Error('coordination tools: priorRecords must be an explicit array')
  }
}

function parseDeliveryMode(value: unknown): DownMessageEvent['deliveryMode'] {
  if (value === 'queued' || value === 'interrupt') return value
  throw new Error('coordination tools: "deliveryMode" must be queued or interrupt')
}

function foldQuestions(records: ReadonlyArray<BusRecord<CoordinationEvent>>): QuestionRecord[] {
  const questions = new Map<string, QuestionRecord>()
  for (const record of records) {
    const event = record.event
    if (event.type === 'question') {
      questions.set(event.question.id, event.question)
      continue
    }
    if (event.type !== 'answer') continue
    const question = questions.get(event.questionId)
    if (!question) continue
    questions.set(event.questionId, {
      ...question,
      status: 'answered',
      answer: event.answer,
    })
  }
  return [...questions.values()]
}
