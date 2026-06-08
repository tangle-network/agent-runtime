/**
 * @experimental
 *
 * MCP binding for a live `Scope`. A sandbox driver gets the same small verbs
 * the in-process driver has: spawn, observe, await, steer, ask/answer, analyze,
 * and stop. Settled outputs remain Scope artifacts; loop facades may record
 * them separately when they need a product-facing result envelope.
 */

import type {
  Budget,
  NodeId,
  ResultBlobStore,
  LoopQuestion as RuntimeLoopQuestion,
  LoopQuestionDecision as RuntimeQuestionDecision,
  Scope,
  Settled,
  Agent as SuperviseAgent,
} from '../../runtime'
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

export type LoopQuestion = Omit<RuntimeLoopQuestion, 'openedAt' | 'status' | 'decision'>
export type QuestionDecision = RuntimeQuestionDecision
export type QuestionRecord = RuntimeLoopQuestion
export type LoopQuestionInput = Omit<LoopQuestion, 'id'> & { readonly id?: string }
export type QuestionPolicyMode = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<{ id: string; description: string; area: string }>
  readonly run: (kindId: string, trace: unknown) => Promise<unknown>
}

export type LoopEvent = { readonly type: 'question'; readonly question: QuestionRecord }

export type MakeWorkerAgent = (profile: unknown) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  readonly analysts?: AnalystRegistry
  readonly onEvent?: (event: LoopEvent) => void | Promise<void>
  readonly questionPolicy?: QuestionPolicyMode
}

export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  isStopped(): boolean
  stopReason(): string | undefined
  settled(): ReadonlyArray<SettledWorker>
  questions(): ReadonlyArray<QuestionRecord>
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
  const level = (v: unknown): LoopQuestion['level'] => {
    if (v === 'worker' || v === 'driver' || v === 'loop') return v
    throw new Error('coordination tools: "level" must be worker, driver, or loop')
  }
  const urgency = (v: unknown): LoopQuestion['urgency'] => {
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

  const nextQuestionId = (from: NodeId): string => `${from}:q${questionSeq++}`
  const normalizeQuestion = (
    q: Omit<LoopQuestion, 'id'> & { id?: string },
    fallbackFrom: NodeId,
  ): LoopQuestion => {
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
    raw: Omit<LoopQuestion, 'id'> & { id?: string },
    fallbackFrom: NodeId,
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
            value: 'question policy bubbled to parent',
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
    if (record.added) await opts.onEvent?.({ type: 'question', question: record.question })
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
      description: 'Deliver an out-of-band instruction to a running worker inbox.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
        },
        required: ['workerId', 'instruction'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const delivered = opts.scope.send(str(a.workerId, 'workerId'), {
          steer: str(a.instruction, 'instruction'),
        })
        return Promise.resolve({ delivered })
      },
    },
    {
      name: 'await_next',
      description:
        'Wait for the next spawned worker to settle. Returns { idle: true } when none are live.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const s = await opts.scope.next()
        if (!s) return { idle: true }
        const w = recordSettled(s)
        return w.status === 'done'
          ? {
              settled: w.id,
              status: 'done',
              score: w.score,
              valid: w.valid,
              outRef: w.outRef,
            }
          : { settled: w.id, status: 'down', reason: w.reason }
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
      handler: (raw) => {
        const a = obj(raw)
        const questionId = str(a.questionId, 'questionId')
        if (typeof a.answer === 'string' && a.answer.length > 0) {
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'answer',
              value: a.answer,
              answer: a.answer,
              by: typeof a.by === 'string' && a.by.length > 0 ? a.by : 'user',
            }),
          })
        }
        if (typeof a.deferReason === 'string' && a.deferReason.length > 0) {
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'defer',
              value: a.deferReason,
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
              value: escalateReason,
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
            { kind: 'escalate', value: 'asked parent', to: 'parent', reason: 'asked parent' },
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
    isStopped: () => stopped,
    stopReason: () => reason,
    settled: () => ledger,
    questions: () => questions,
  }
}
