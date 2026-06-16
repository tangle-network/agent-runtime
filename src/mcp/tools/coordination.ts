/**
 * @experimental
 *
 * MCP binding for a live `Scope`. A sandbox driver gets the same small verbs
 * the in-process driver has: spawn, observe, await, steer, ask/answer, analyze,
 * and stop. Settled outputs remain Scope artifacts; product code can project
 * them into any UI/report envelope it needs.
 */

import type {
  Budget,
  ResultBlobStore,
  Scope,
  Settled,
  Agent as SuperviseAgent,
} from '../../runtime'
import { type BusRecord, type BusStats, createEventBus } from '../../runtime/supervise/event-bus'
import type { McpToolDescriptor } from '../server'

/** A worker the driver has drained via `await_next`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
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
 *  the driver to `pull`. DOWN (parent→child): steer / answer / resume — record-only (history +
 *  subscribers), routed to the child inbox. New kinds are additive. */
export type CoordinationEvent =
  | { readonly type: 'question'; readonly question: QuestionRecord }
  | { readonly type: 'settled'; readonly worker: SettledWorker }
  | { readonly type: 'finding'; readonly finding: AnalystFindingEvent }
  | { readonly type: 'steer'; readonly down: DownMessageEvent }
  | { readonly type: 'answer'; readonly down: DownMessageEvent; readonly questionId: string }
  | { readonly type: 'resume'; readonly down: DownMessageEvent }

export type MakeWorkerAgent = (profile: unknown) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  readonly analysts?: AnalystRegistry
  readonly onEvent?: (event: CoordinationEvent) => void | Promise<void>
  readonly questionPolicy?: QuestionPolicy
  /** Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
   *  hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
   *  and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
   *  the driver can still run lenses on demand via `run_analyst`). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
}

export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  isStopped(): boolean
  stopReason(): string | undefined
  settled(): ReadonlyArray<SettledWorker>
  questions(): ReadonlyArray<QuestionRecord>
  /** The full ordered log of every bus event — UP (settled / question / finding) and DOWN
   *  (steer / answer / resume) — the observability audit + replay trail. Each record carries seq,
   *  timestamp, and priority. */
  history(): ReadonlyArray<BusRecord<CoordinationEvent>>
  /** Bus throughput counters (published / pulled / by-kind) for live dashboards. */
  stats(): BusStats
}

const idArg = { type: 'string', description: 'The workerId returned by spawn_worker.' } as const

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  let stopped = false
  let reason: string | undefined
  let questionSeq = 0
  const ledger: SettledWorker[] = []
  const questions: QuestionRecord[] = []
  const questionPolicy = opts.questionPolicy ?? 'auto'

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
    const w: SettledWorker =
      s.kind === 'done'
        ? {
            id: s.handle.id,
            status: 'done',
            score: s.verdict?.score ?? 0,
            valid: s.verdict?.valid ?? false,
            outRef: s.outRef,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason }
    ledger.push(w)
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

  // The down-leg: record a parent→child message on the bus for the audit trail (history +
  // subscribers) WITHOUT enqueuing it — the parent must never pull its own outbound message back.
  const sendDown = async (
    type: 'steer' | 'resume' | 'answer',
    down: DownMessageEvent,
    questionId?: string,
  ): Promise<void> => {
    await bus.publish(
      type === 'answer' ? { type, down, questionId: questionId ?? '' } : { type, down },
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
    // Down-leg kinds are record-only (never queued), so the driver never pulls them; project
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

  const tools: McpToolDescriptor[] = [
    {
      name: 'spawn_worker',
      description:
        'Start a worker the driver will drive. `profile` is the worker or another driver; ' +
        '`task` is what it should do. Reserves budget from the conserved pool and fails closed.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { description: 'The worker/driver profile to run.' },
          task: { description: 'The task the worker should perform.' },
          label: { type: 'string', description: 'Optional trace label.' },
        },
        required: ['profile', 'task'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const agent = opts.makeWorkerAgent(a.profile)
        const res = opts.scope.spawn(agent, a.task, {
          budget: opts.perWorker,
          label: typeof a.label === 'string' ? a.label : 'worker',
        })
        return Promise.resolve(res.ok ? { workerId: res.handle.id } : { error: res.reason })
      },
    },
    {
      name: 'observe_worker',
      description: 'Inspect a worker status, spend, and settled output artifact when available.',
      inputSchema: { type: 'object', properties: { workerId: idArg }, required: ['workerId'] },
      handler: async (raw) => {
        const id = str(obj(raw).workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) return { error: `unknown workerId ${JSON.stringify(id)}` }
        const output = node.outRef ? await opts.blobs.get(node.outRef) : undefined
        return {
          status: node.status,
          spent: node.spent,
          outRef: node.outRef ?? null,
          output: output ?? null,
        }
      },
    },
    {
      name: 'steer_worker',
      description: 'Deliver an out-of-band instruction to a running worker inbox (parent→child).',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
          interrupt: {
            type: 'boolean',
            description:
              'true = forceful: break the worker out of its current step NOW to handle this. ' +
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
        return { delivered }
      },
    },
    {
      name: 'resume_worker',
      description:
        'Deliver a follow-up message to a still-LIVE worker, continuing its run (parent→child). ' +
        'A worker that already settled (drained via await_next/await_event) is gone from the live ' +
        'set and cannot be resumed — that returns delivered:false; spawn a fresh worker instead.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          message: { type: 'string', description: 'The follow-up to continue the worker with.' },
        },
        required: ['workerId', 'message'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const message = str(a.message, 'message')
        const delivered = opts.scope.send(workerId, { resume: message })
        await sendDown('resume', { toWorker: workerId, instruction: message, delivered })
        return { delivered }
      },
    },
    {
      name: 'await_next',
      description:
        'Wait for the next spawned worker to settle. Returns { idle: true } when none are live. ' +
        '(A settle also fires any analyze-on-settle lenses, whose findings queue for await_event.)',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        if (bus.pending(['settled']) === 0 && !(await drainSettlement())) return { idle: true }
        const ev = bus.pull(['settled'])
        if (!ev || ev.type !== 'settled') return { idle: true }
        const w = ev.worker
        return w.status === 'done'
          ? { settled: w.id, status: 'done', score: w.score, valid: w.valid, outRef: w.outRef }
          : { settled: w.id, status: 'down', reason: w.reason }
      },
    },
    {
      name: 'await_event',
      description:
        'Pull the next message a worker, sub-driver, or analyst sent up — the unified inbox. An ' +
        "event is one of: a settled worker output ('settled'), a question needing your answer " +
        "('question', from ask_parent / the worker's ask-user), or a trace-analyst finding " +
        "('finding', from analyze-on-settle). Optional `kinds` filters which to wait for. Returns " +
        '{ idle: true } when nothing is queued and no workers are live. Prefer this over await_next ' +
        'when you also want questions and findings, not just settlements.',
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
        // Already-queued async messages (findings, questions) first; else drive the cursor to
        // produce the next settlement (and its findings), then re-pull.
        let ev = bus.pull(kinds)
        if (!ev) {
          const drained = await drainSettlement()
          ev = bus.pull(kinds)
          if (!ev) return { idle: !drained }
        }
        return projectEvent(ev)
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
          const delivered = opts.scope.send(question.from, { answer, questionId })
          await sendDown(
            'answer',
            { toWorker: question.from, instruction: answer, delivered },
            questionId,
          )
          // Surface `delivered` like steer_worker/resume_worker — the caller must see whether the
          // answer actually reached a live worker (false when it parked/settled or has no inbox).
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
    stats: () => bus.stats(),
    isStopped: () => stopped,
    stopReason: () => reason,
    settled: () => ledger,
    questions: () => questions,
  }
}
