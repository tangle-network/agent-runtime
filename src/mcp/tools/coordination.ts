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
  Budget,
  ResultBlobStore,
  Scope,
  Settled,
  Agent as SuperviseAgent,
} from '../../runtime'
import type { DeliverableSpec } from '../../runtime/supervise/completion-gate'
import { type WatchTraceOptions, watchTrace } from '../../runtime/supervise/detector-monitor'
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

export type QuestionLevel = 'worker' | 'driver' | 'loop'
export type QuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run'

export interface QuestionOption {
  readonly label: string
  readonly tradeoff: string
}

export interface Question {
  readonly id: string
  readonly from: string
  readonly level: QuestionLevel
  readonly question: string
  readonly reason: string
  readonly urgency: QuestionUrgency
  readonly options?: ReadonlyArray<QuestionOption>
}

export type QuestionDecision =
  | { readonly kind: 'answer'; readonly answer: string; readonly by: string }
  | { readonly kind: 'defer'; readonly reason: string }
  | { readonly kind: 'escalate'; readonly to: 'parent' | 'user' | string; readonly reason: string }

export interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated'
  readonly decision?: QuestionDecision
  readonly openedAt: number
}

type QuestionInput = Omit<Question, 'id'> & { readonly id?: string }
export type QuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<{ id: string; description: string; area: string }>
  readonly run: (kindId: string, trace: unknown) => Promise<unknown>
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
  readonly toWorker: string
  readonly instruction: string
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
  | { readonly type: 'answer'; readonly down: DownMessageEvent; readonly questionId: string }

export type MakeWorkerAgent = (profile: unknown) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  /**
   * The same independent completion check used for workers. When present, the driver receives a
   * `submit_result` tool and may finish work itself instead of being forced to delegate it. The
   * first passing submission is retained; a false or throwing check fails closed.
   */
  readonly deliverable?: DeliverableSpec<unknown>
  readonly analysts?: AnalystRegistry
  readonly onEvent?: (event: CoordinationEvent) => void | Promise<void>
  readonly questionPolicy?: QuestionPolicy
  /** Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
   *  hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
   *  and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
   *  the driver can still run lenses on demand via `run_analyst`). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /** Hard cap on how many workers may be LIVE (spawned but not yet settled) at once. `spawn_agent`
   *  counts the scope's non-terminal nodes and fails closed (`error: 'max-live-workers'`) BEFORE
   *  reserving from the pool when the cap is already met — a concurrency fence on top of the
   *  conserved-budget fence (the pool bounds total work; this bounds simultaneous work, e.g. live
   *  sandboxes/boxes). Omit or `<= 0` = no cap (the prior behavior; the pool stays the only fence). */
  readonly maxLiveWorkers?: number
  /** Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
   *  before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
   *  The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
   *  transport that block outlives the client's per-request timeout, so an unbounded await surfaces
   *  to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
   *  blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
   *  drain keeps running, so a settlement that lands after the bound is published to the bus and
   *  pulled by the next call — nothing is lost. Omit = {@link DEFAULT_AWAIT_EVENT_TIMEOUT_MS}; `<= 0`
   *  restores the prior UNBOUNDED block (only safe for in-process drivers with no transport timeout). */
  readonly awaitTimeoutMs?: number
  /**
   * OPT-IN: run the ONLINE detector panel over each spawned worker's live tool trace and raise a
   * `finding` on the bus the moment a detector fires — so the driver learns "this worker is
   * looping" mid-run, from `await_event`, instead of at settle.
   *
   * This closes the `watchTrace` → `raiseFinding` wire whose own docstring already described it
   * ("the seam an ONLINE detector uses to tell the driver 'this worker is looping/erroring' the
   * moment it happens") but which nothing connected. Workers whose executor exposes no
   * `traceSource` are simply not watched; nothing fails.
   *
   * Omit = no online watching (the settle-time analysts are unaffected).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /**
   * How long a worker may go without metered activity before `observe_agent` reports it as
   * `stalled`. A derived read at observation time, never a background watchdog — nothing is
   * killed or retried. Omit = the runtime default.
   */
  readonly stallAfterMs?: number
  /**
   * Questions carried over from a prior process of the SAME run (a durable coordination log a
   * resuming caller replays). Seeded into the question ledger verbatim — `list_questions` shows
   * them, the stop policy counts the still-blocking ones, and `answer_question` can decide them.
   * Omit/empty = fresh ledger (every run that is not a resume).
   */
  readonly priorQuestions?: ReadonlyArray<QuestionRecord>
}

/** Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). */
export interface WorkerWatchOptions {
  /** Detector panel; omit for the default stuck-loop + error-streak pair. */
  readonly detectors?: WatchTraceOptions['detectors']
  /** Raise at most this many findings per worker, so one pathological worker cannot flood the
   *  driver's inbox with the same signal every span. Default 3; `<= 0` = unlimited. */
  readonly maxFindingsPerWorker?: number
}

/** Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote
 *  MCP client request timeout so the call returns a `pending` liveness snapshot instead of erroring;
 *  the supervisor re-polls until the worker settles. */
export const DEFAULT_AWAIT_EVENT_TIMEOUT_MS = 15_000

/**
 * The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool
 * descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
 * over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
 * `raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
 * choice, steerable counterpart to the one-shot own-sandbox delegation MCP.
 */
export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  isStopped(): boolean
  stopReason(): string | undefined
  /** The first result whose injected independent check passed, if the driver submitted one. */
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
  'stop',
  'list_analysts',
  'run_analyst',
] as const

const idArg = { type: 'string', description: 'The workerId returned by spawn_agent.' } as const

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  const deliverable = opts.deliverable
  let stopped = false
  let reason: string | undefined
  let submitted: { readonly result: unknown } | undefined
  let questionSeq = 0
  const ledger: SettledWorker[] = []
  const questions: QuestionRecord[] = [...(opts.priorQuestions ?? [])]
  const questionPolicy = opts.questionPolicy ?? 'auto'

  // Keyed-assignment bookkeeping for the live-worker fence. `completedKeys` is every key this run
  // can already answer from committed work — seeded from the prior journal on a resume, extended as
  // keyed workers deliver in THIS process. A spawn under such a key starts nothing and occupies no
  // slot, so the fence must not hold it back. `keyByWorker` is what lets a settlement find its key.
  const completedKeys = new Set<string>()
  const keyByWorker = new Map<string, string>()
  for (const [key, prior] of opts.scope.resume?.keys ?? []) {
    if (prior.state === 'completed') completedKeys.add(key)
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
            score: s.verdict?.score ?? 0,
            valid: s.verdict?.valid ?? false,
            outRef: s.outRef,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason },
    )
  }

  // The one child→parent pipe. `onEvent` (back-compat) becomes a pass-through subscriber receiving
  // the bare event, so every kind — question, settled, finding — reaches it immediately, and the
  // driver pulls queued findings / questions via `await_event`.
  const bus = createEventBus<CoordinationEvent>()
  if (opts.onEvent) {
    const cb = opts.onEvent
    bus.subscribe((rec) => cb(rec.event))
  }

  // Urgency → bus priority: a blocking question is bumped ahead of queued settles/findings so the
  // driver sees it FIRST when it drains the inbox (and pass-through already delivered it the instant
  // it was raised). Non-blocking messages share priority 0 and resolve FIFO.
  const urgencyPriority = (u: QuestionUrgency): number =>
    u === 'blocks-run' ? 20 : u === 'blocks-step' ? 10 : 0

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
  // Parse a per-spawn `budget` override and merge it over the per-worker default (per field).
  // Fails loud on a non-object or a non-finite numeric field — a malformed budget must never
  // silently fall back to the default and run a sub-task on a ceiling nobody chose.
  const mergeBudget = (base: Budget, raw: unknown): Budget => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('coordination tools: "budget" must be an object')
    const o = raw as Record<string, unknown>
    const field = (name: keyof Budget): number | undefined => {
      const v = o[name]
      if (v === undefined) return undefined
      if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error(`coordination tools: "budget.${name}" must be a finite number`)
      return v
    }
    const maxIterations = field('maxIterations')
    const maxTokens = field('maxTokens')
    const maxUsd = field('maxUsd')
    const deadlineMs = field('deadlineMs')
    return {
      maxIterations: maxIterations ?? base.maxIterations,
      maxTokens: maxTokens ?? base.maxTokens,
      ...((maxUsd ?? base.maxUsd) === undefined ? {} : { maxUsd: maxUsd ?? base.maxUsd }),
      ...((deadlineMs ?? base.deadlineMs) === undefined
        ? {}
        : { deadlineMs: deadlineMs ?? base.deadlineMs }),
    }
  }
  const level = (v: unknown): Question['level'] => {
    if (v === 'worker' || v === 'driver' || v === 'loop') return v
    throw new Error('coordination tools: "level" must be worker, driver, or loop')
  }
  const urgency = (v: unknown): Question['urgency'] => {
    if (v === 'continue-without' || v === 'blocks-step' || v === 'blocks-run') return v
    throw new Error(
      'coordination tools: "urgency" must be continue-without, blocks-step, or blocks-run',
    )
  }

  const recordSettled = (s: Settled<unknown>): SettledWorker => {
    const settledAt = Date.now()
    // A keyed assignment that just delivered is complete for the rest of this run, so a later
    // spawn under the same key resolves for free instead of being held behind the live-worker
    // fence (it starts no worker, so it occupies no slot).
    const settledKey = keyByWorker.get(s.handle.id)
    if (settledKey !== undefined && s.kind === 'done') completedKeys.add(settledKey)
    const w: SettledWorker =
      s.kind === 'done'
        ? {
            id: s.handle.id,
            status: 'done',
            score: s.verdict?.score ?? 0,
            valid: s.verdict?.valid ?? false,
            outRef: s.outRef,
            settledAt,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason, settledAt }
    ledger.push(w)
    // A settled worker's trace source is finished; drop the online subscription with it.
    unwatchWorker(w.id)
    return w
  }

  // Producer: drain exactly one settlement from the scope cursor onto the bus (a `settled` event),
  // then fire the analyst-on-settle hook — auto-run each configured lens over the worker's trace and
  // publish its result as a `finding`. Returns false when the cursor is idle (no live workers). The
  // cursor is a once-per-child source, so a settlement is produced at most once.
  const drainSettlement = async (): Promise<boolean> => {
    const s = await opts.scope.next()
    if (!s) return false
    const w = recordSettled(s)
    await bus.publish({ type: 'settled', worker: w })
    if (w.status === 'done' && w.outRef && opts.analysts && opts.analyzeOnSettle?.length) {
      const trace = await opts.blobs.get(w.outRef)
      for (const analyst of opts.analyzeOnSettle) {
        const findings = await opts.analysts.run(analyst, trace)
        await bus.publish({ type: 'finding', finding: { fromWorker: w.id, analyst, findings } })
      }
    }
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
      await bus.publish({ type: 'settled', worker: w })
      drained += 1
    }
  }

  // The down-leg: record a parent→child message on the bus for the audit trail (history +
  // subscribers) WITHOUT enqueuing it — the parent must never pull its own outbound message back.
  // Overloaded so the `answer` kind REQUIRES a questionId (no silent `?? ''` fallback to mask a bug).
  function sendDown(type: 'steer', down: DownMessageEvent): Promise<void>
  function sendDown(type: 'answer', down: DownMessageEvent, questionId: string): Promise<void>
  async function sendDown(
    type: 'steer' | 'answer',
    down: DownMessageEvent,
    questionId?: string,
  ): Promise<void> {
    await bus.publish(
      type === 'answer'
        ? { type, down, questionId: str(questionId, 'questionId') }
        : { type, down },
      { queue: false },
    )
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
    if (ev.type === 'answer') return { type: 'answer', ...ev.down, questionId: ev.questionId }
    // Down-leg `steer` is record-only (never queued), so the driver never pulls it; project
    // defensively for completeness.
    return { type: ev.type, ...ev.down }
  }

  const nextQuestionId = (from: string): string => `${from}:q${questionSeq++}`
  const normalizeQuestion = (q: QuestionInput, fallbackFrom: string): Question => {
    const from = str(q.from ?? fallbackFrom, 'from')
    return {
      id: typeof q.id === 'string' && q.id.length > 0 ? q.id : nextQuestionId(from),
      from,
      level: level(q.level),
      question: str(q.question, 'question'),
      reason: str(q.reason, 'reason'),
      ...(q.options ? { options: q.options } : {}),
      urgency: urgency(q.urgency),
    }
  }
  const addQuestion = (
    raw: QuestionInput,
    fallbackFrom: string,
    decision?: QuestionDecision,
  ): { question: QuestionRecord; added: boolean } => {
    const q = normalizeQuestion(raw, fallbackFrom)
    const existing = questions.find((x) => x.id === q.id)
    if (existing) return { question: existing, added: false }
    const effectiveDecision =
      decision ??
      (questionPolicy === 'bubble'
        ? ({
            kind: 'escalate',
            to: 'parent',
            reason: 'question policy bubbled to parent',
          } as const)
        : undefined)
    const status: QuestionRecord['status'] =
      effectiveDecision?.kind === 'answer'
        ? 'answered'
        : effectiveDecision?.kind === 'defer'
          ? 'deferred'
          : effectiveDecision?.kind === 'escalate'
            ? 'escalated'
            : 'open'
    const record: QuestionRecord = {
      ...q,
      status,
      openedAt: Date.now(),
      ...(effectiveDecision ? { decision: effectiveDecision } : {}),
    }
    questions.push(record)
    return { question: record, added: true }
  }
  const emitNewQuestion = async (record: {
    question: QuestionRecord
    added: boolean
  }): Promise<QuestionRecord> => {
    if (record.added)
      await bus.publish(
        { type: 'question', question: record.question },
        { priority: urgencyPriority(record.question.urgency) },
      )
    return record.question
  }
  const decideQuestion = (questionId: string, decision: QuestionDecision): QuestionRecord => {
    const idx = questions.findIndex((q) => q.id === questionId)
    if (idx < 0) throw new Error(`unknown questionId ${JSON.stringify(questionId)}`)
    const prior = questions[idx] as QuestionRecord
    const status: QuestionRecord['status'] =
      decision.kind === 'answer' ? 'answered' : decision.kind === 'defer' ? 'deferred' : 'escalated'
    const next: QuestionRecord = { ...prior, status, decision }
    questions[idx] = next
    return next
  }
  const blockingQuestionsForStop = (): QuestionRecord[] => {
    if (questionPolicy === 'auto' || questionPolicy === 'bubble') return []
    return questions.filter((q) => {
      const blocking = q.urgency === 'blocks-step' || q.urgency === 'blocks-run'
      if (!blocking) return false
      if (questionPolicy === 'mustDecide') return q.status === 'open'
      return q.status !== 'answered' && q.status !== 'deferred'
    })
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
  const freeWorkerSlots = (): number | null => freeSlots(liveWorkerCount(), maxLiveWorkers)

  // The LIVE read of one worker. Guarded because `createCoordinationTools` is bound to a `Scope`
  // it did not construct — an older or hand-rolled scope may not implement `progress` at all, and
  // an observation must degrade to "no progress available", never throw at the driver.
  const readProgress = (id: string): WorkerProgress | undefined => {
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.progress !== 'function') return undefined
    try {
      return scope.progress(
        id,
        opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {},
      )
    } catch {
      return undefined
    }
  }

  // ONLINE detection: subscribe the streaming detector panel to a freshly-spawned worker's live
  // tool trace, and turn each signal into a `finding` the driver pulls from `await_event`. The
  // unsubscribe fires on the worker's settle (its trace source is dead from then on) and the
  // per-worker cap stops one looping worker from flooding the bus.
  const watchers = new Map<string, () => void>()
  const watchWorker = (id: string): void => {
    const watch = opts.watchWorkers
    if (!watch) return
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.traceSource !== 'function') return
    let source: ReturnType<NonNullable<Scope<unknown>['traceSource']>>
    try {
      source = scope.traceSource(id)
    } catch {
      return
    }
    if (!source) return
    const cap = watch.maxFindingsPerWorker ?? 3
    let raised = 0
    const unsub = watchTrace(source, {
      ...(watch.detectors ? { detectors: watch.detectors } : {}),
      onSignal: async (signal, span) => {
        if (cap > 0 && raised >= cap) return
        raised += 1
        await bus.publish({
          type: 'finding',
          finding: {
            fromWorker: id,
            analyst: `online:${signal.detector}`,
            findings: {
              detector: signal.detector,
              severity: signal.severity,
              reason: signal.reason,
              streak: signal.streak,
              ...(signal.failureClass ? { failureClass: signal.failureClass } : {}),
              toolName: span.toolName,
              at: span.endedAt,
              progress: readProgress(id),
            },
          },
        })
      },
    })
    watchers.set(id, unsub)
  }
  const unwatchWorker = (id: string): void => {
    const unsub = watchers.get(id)
    if (!unsub) return
    watchers.delete(id)
    try {
      unsub()
    } catch {
      // an unsubscribe that throws must never break the settle path
    }
  }

  // The blocking `scope.next()` (via `drainSettlement`) waits on a LIVE worker for its whole run.
  // Keep at most ONE such drain in flight and let every concurrent `await_event` race THAT single
  // promise against a timeout — so a bounded call never starts a second unbounded block, and the
  // one drain still delivers the settlement (exactly-once via the scope cursor) whenever it lands.
  const awaitTimeoutMs = opts.awaitTimeoutMs ?? DEFAULT_AWAIT_EVENT_TIMEOUT_MS
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
        'Start a worker the driver will drive. `profile` is the worker or another driver; ' +
        '`task` is what it should do. Reserves budget from the conserved pool and fails closed. ' +
        'Pass an optional `budget` (per-field) to give a hard sub-task more than the default — it ' +
        'merges over the per-worker default; the conserved pool is still the hard fence. When a ' +
        'max-live-workers cap is set it also fails closed (`error: "max-live-workers"`) while that ' +
        'many workers are still in flight — settle or steer one before spawning another. ' +
        'Pass a `key` naming the assignment to make it run-once ACROSS restarts: a key that ' +
        'already completed returns the finished result (`resumed: "completed"` — no work re-runs, ' +
        'nothing is spent), a key whose prior attempt failed or was lost with a dead process ' +
        'spawns fresh and says so (`resumed: "retried" | "lost"`), and a key still running is ' +
        'refused (`error: "duplicate-key"`). ' +
        'Returns `freeSlots`: how many MORE workers you can start right now (`null` = uncapped). ' +
        'While `freeSlots > 0` there is idle capacity — call this again to fill it rather than ' +
        'waiting; parallel workers finish the run sooner than one at a time.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { description: 'The worker/driver profile to run.' },
          task: { description: 'The task the worker should perform.' },
          label: { type: 'string', description: 'Optional trace label.' },
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
              'Optional per-spawn budget that merges over the per-worker default (per field). ' +
              'Only set the ceilings this sub-task needs raised; the conserved pool still fences.',
            properties: {
              maxIterations: { type: 'number' },
              maxTokens: { type: 'number' },
              maxUsd: { type: 'number' },
              deadlineMs: { type: 'number' },
            },
          },
        },
        required: ['profile', 'task'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const key = a.key === undefined ? undefined : str(a.key, 'key')
        // A key already proven complete — by the resumed journal or by a delivery earlier in this
        // run — resolves to committed work and starts no live worker, so the concurrency fence
        // does not apply to it.
        const keyCompleted = key !== undefined && completedKeys.has(key)
        // Concurrency fence FIRST — fail closed before reserving budget, so a rejected spawn never
        // touches the pool. The conserved pool bounds TOTAL work; this bounds SIMULTANEOUS work.
        if (
          !keyCompleted &&
          maxLiveWorkers !== undefined &&
          maxLiveWorkers > 0 &&
          liveWorkerCount() >= maxLiveWorkers
        )
          return Promise.resolve({
            error: 'max-live-workers' as const,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        const agent = opts.makeWorkerAgent(a.profile)
        const budget =
          a.budget === undefined ? opts.perWorker : mergeBudget(opts.perWorker, a.budget)
        const res = opts.scope.spawn(agent, a.task, {
          budget,
          label: typeof a.label === 'string' ? a.label : 'worker',
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
            score: s.verdict?.score ?? 0,
            valid: s.verdict?.valid ?? false,
            outRef: s.outRef,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        }
        if (res.ok) {
          watchWorker(res.handle.id)
          // Bind the new worker to its key so its settlement can mark the key complete.
          if (key !== undefined) keyByWorker.set(res.handle.id, key)
        }
        // A `completed` key returned above, so any prior still attached here is a real re-run:
        // `retried` (the prior attempt failed) or `lost` (it died in flight with its process).
        const priorHistory =
          res.ok && res.prior !== undefined && res.prior.state !== 'completed'
            ? {
                resumed: res.prior.state,
                priorWorkerId: res.prior.priorId,
                ...(res.prior.state === 'retried' ? { priorReason: res.prior.reason } : {}),
              }
            : {}
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
                ...priorHistory,
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
        'once it exists. Use this BEFORE steer_agent: a steer is only worth sending when the ' +
        'progress says the worker is on the wrong path or has stopped making any.',
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
      description:
        'Send a message DOWN to a still-LIVE worker (parent→child): a new instruction, a course ' +
        'correction, or a continuation. The worker drains it at its next step boundary — and before ' +
        'it may settle, so it cannot finish while a message it never read is pending. A worker that ' +
        'already settled is gone (returns delivered:false) — spawn a fresh one instead.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
          interrupt: {
            type: 'boolean',
            description:
              'true = forceful: abort the worker’s in-flight inference so it re-plans on the NEXT ' +
              'turn (a tool already mid-execution finishes first; only the owned tool-loop honors this). ' +
              'false/omitted = queued: it flushes at the next step boundary (and before it may settle).',
          },
        },
        required: ['workerId', 'instruction'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const instruction = str(a.instruction, 'instruction')
        const interrupt = a.interrupt === true
        const delivered = opts.scope.send(workerId, { steer: instruction, interrupt })
        await sendDown('steer', { toWorker: workerId, instruction, delivered })
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
        'blocking indefinitely — call await_event again to keep waiting; the settlement is not lost. ' +
        'Every reply carries `freeSlots`: how many more workers you can start right now (`null` = ' +
        'uncapped). A settled worker frees its slot, so `freeSlots > 0` means capacity is sitting ' +
        'idle — spawn into it before waiting again.',
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
      description:
        'List questions raised by workers, drivers, or analysts. Blocking stop behavior follows questionPolicy.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ questions }),
    },
    {
      name: 'answer_question',
      description: 'Record an answer, deferral, or escalation for a loop question.',
      inputSchema: {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          answer: { type: 'string' },
          by: { type: 'string', description: 'Node id or "user".' },
          deferReason: { type: 'string' },
          escalateTo: { type: 'string', enum: ['parent', 'user'] },
          escalateReason: { type: 'string' },
        },
        required: ['questionId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const questionId = str(a.questionId, 'questionId')
        if (typeof a.answer === 'string' && a.answer.length > 0) {
          const answer = a.answer
          const question = decideQuestion(questionId, {
            kind: 'answer',
            answer,
            by: typeof a.by === 'string' && a.by.length > 0 ? a.by : 'user',
          })
          // Route the answer DOWN to the worker that asked, unparking it, and record the down-leg.
          // A blocking question parked the worker, so deliver forcefully — it should resume on the
          // answer immediately, not wait for its next step boundary.
          const interrupt = question.urgency === 'blocks-run' || question.urgency === 'blocks-step'
          const delivered = opts.scope.send(question.from, { answer, questionId, interrupt })
          await sendDown(
            'answer',
            { toWorker: question.from, instruction: answer, delivered },
            questionId,
          )
          // Surface `delivered` like steer_agent — the caller must see whether the answer actually
          // reached a live worker (false when it already settled or has no inbox).
          return { question, delivered }
        }
        if (typeof a.deferReason === 'string' && a.deferReason.length > 0) {
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'defer',
              reason: a.deferReason,
            }),
          })
        }
        if (a.escalateTo === 'parent' || a.escalateTo === 'user') {
          const escalateReason =
            typeof a.escalateReason === 'string' && a.escalateReason.length > 0
              ? a.escalateReason
              : 'driver escalated'
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'escalate',
              to: a.escalateTo,
              reason: escalateReason,
            }),
          })
        }
        throw new Error('answer_question: provide answer, deferReason, or escalateTo')
      },
    },
    {
      name: 'ask_parent',
      description: 'Raise a question to the parent driver/Pi/user when this driver cannot decide.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          level: { type: 'string', enum: ['worker', 'driver', 'loop'] },
          question: { type: 'string' },
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['continue-without', 'blocks-step', 'blocks-run'] },
        },
        required: ['from', 'level', 'question', 'reason', 'urgency'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const from = str(a.from, 'from')
        const q = await emitNewQuestion(
          addQuestion(
            {
              from,
              level: level(a.level),
              question: str(a.question, 'question'),
              reason: str(a.reason, 'reason'),
              urgency: urgency(a.urgency),
            },
            from,
            { kind: 'escalate', to: 'parent', reason: 'asked parent' },
          ),
        )
        return { question: q }
      },
    },
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

              // Copy once at intake so the value checked below is the exact value retained after
              // acceptance, even when this handler is called directly rather than through JSON-RPC.
              const result = structuredClone(a.result)
              let accepted = false
              try {
                accepted = (await deliverable.check(result)) === true
              } catch {
                accepted = false
              }
              if (!accepted) return { accepted: false, stop: false }
              // Two remote callers may submit concurrently. Whichever passing check completes
              // first owns the retained result; a later completion must never overwrite it.
              if (submitted) {
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }

              submitted = Object.freeze({ result })
              stopped = true
              reason = 'result-accepted'
              return { accepted: true, retained: 'this-result', stop: true }
            },
          } satisfies McpToolDescriptor,
        ]
      : []),
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
          return Promise.resolve({
            stopped: false,
            error: 'unresolved-blocking-questions',
            questions: blocking,
          })
        }
        stopped = true
        const r = obj(raw).reason
        reason = typeof r === 'string' ? r : undefined
        return Promise.resolve({ stopped: true })
      },
    },
  ]

  if (opts.analysts) {
    tools.push({
      name: 'list_analysts',
      description: 'List trace-analyst lenses available to run over a settled worker.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: opts.analysts?.kinds }),
    })
    tools.push({
      name: 'run_analyst',
      description: 'Apply an analyst lens to a settled worker trace.',
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
        if (!node.outRef)
          return { error: `worker ${JSON.stringify(id)} has not settled — no trace to analyze yet` }
        const trace = await opts.blobs.get(node.outRef)
        return { findings: await opts.analysts?.run(str(a.kind, 'kind'), trace) }
      },
    })
  }

  return {
    tools,
    history: () => bus.history(),
    raiseFinding: (finding) => bus.publish({ type: 'finding', finding }).then(() => undefined),
    stats: () => bus.stats(),
    isStopped: () => stopped,
    stopReason: () => reason,
    submittedResult: () => submitted,
    settled: () => ledger,
    questions: () => questions,
    drainResolved,
  }
}
