/**
 * @experimental
 *
 * MCP binding for a live `Scope`.
 *
 * A sandbox driver gets a small verb set over child agents:
 * spawn, observe, await settlement, steer, raise/answer questions, run analysts,
 * and stop. Transport is outside this file: in-process steering is `Scope.send`,
 * sandbox steering can ride session messages, and cross-org steering can ride the
 * agent-bus protocol.
 *
 * Settled workers become loop packets. Packet analyzers attach findings,
 * questions, and messages to those packets so parent drivers and Pi can inspect
 * and steer without hidden side channels.
 */

import type {
  DefaultVerdict,
  LoopFinding,
  LoopFindingInput,
  LoopMessageRecord,
  LoopPacket,
  LoopVerdict,
  NodeId,
  Settled,
  Spend,
} from '../../runtime'
import type { McpToolDescriptor } from '../server'
import { composeLoopPacketAnalyzers } from './coordination-analysis'
import type {
  CoordinationTools,
  CoordinationToolsOptions,
  LoopEvent,
  LoopPacketAnalysisInput,
  LoopPacketAnalyzer,
  LoopPacketMessage,
  LoopQuestion,
  QuestionDecision,
  QuestionRecord,
  SettledWorker,
} from './coordination-types'

export { composeLoopPacketAnalyzers } from './coordination-analysis'
export type {
  AnalystRegistry,
  CoordinationTools,
  CoordinationToolsOptions,
  LoopEvent,
  LoopPacketAnalysis,
  LoopPacketAnalysisInput,
  LoopPacketAnalyzer,
  LoopPacketMessage,
  LoopQuestion,
  LoopQuestionInput,
  MakeWorkerAgent,
  QuestionDecision,
  QuestionPolicyMode,
  QuestionRecord,
  SettledWorker,
} from './coordination-types'

const idArg = { type: 'string', description: 'The workerId returned by spawn_worker.' } as const
const severities = new Set(['critical', 'high', 'medium', 'low', 'info'])

function isSeverity(value: unknown): value is LoopFinding['severity'] {
  return typeof value === 'string' && severities.has(value)
}

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  let stopped = false
  let reason: string | undefined
  const ledger: SettledWorker[] = []
  const packets: LoopPacket[] = []
  const questions: QuestionRecord[] = []
  let questionSeq = 0
  let findingSeq = 0
  let messageSeq = 0

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
  const questionPolicy = opts.questionPolicy ?? 'auto'
  const emitEvent = async (event: LoopEvent): Promise<void> => {
    await opts.onEvent?.(event)
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
    if (record.added) await emitEvent({ type: 'question', question: record.question })
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
  const isBlockingQuestion = (q: QuestionRecord): boolean =>
    q.urgency === 'blocks-step' || q.urgency === 'blocks-run'
  const blockingQuestionsForStop = (): QuestionRecord[] => {
    if (questionPolicy === 'mustDecide') {
      return questions.filter((q) => isBlockingQuestion(q) && q.status === 'open')
    }
    if (questionPolicy === 'failClosed') {
      return questions.filter(
        (q) => isBlockingQuestion(q) && q.status !== 'answered' && q.status !== 'deferred',
      )
    }
    return []
  }
  const outputForNode = async (nodeId: NodeId): Promise<{ outRef?: string; output?: unknown }> => {
    const node = opts.scope.view.nodes.find((n) => n.id === nodeId)
    if (!node?.outRef) return {}
    const output = await opts.blobs.get(node.outRef)
    return { outRef: node.outRef, ...(output !== undefined ? { output } : {}) }
  }
  const packetTiming = (
    spent: Spend,
  ): { startedAt: number; endedAt: number; durationMs: number } => {
    const endedAt = Date.now()
    const durationMs = Math.max(0, spent.ms)
    return { startedAt: endedAt - durationMs, endedAt, durationMs }
  }
  const verdictFromDefault = (verdict: DefaultVerdict | undefined): LoopVerdict | undefined => {
    if (!verdict) return undefined
    return {
      valid: verdict.valid,
      score: verdict.score,
      ...(verdict.notes ? { notes: verdict.notes, reason: verdict.notes } : {}),
    }
  }
  const normalizeFinding = (raw: LoopFindingInput, source: string): LoopFinding => {
    return {
      id: raw.id ?? `coord:f${findingSeq++}`,
      source: raw.source ?? source,
      claim: raw.claim,
      ...(isSeverity(raw.severity) ? { severity: raw.severity } : {}),
      ...(raw.evidence ? { evidence: raw.evidence } : {}),
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
      ...(raw.recommendedAction ? { recommendedAction: raw.recommendedAction } : {}),
      ...(raw.metadata ? { metadata: raw.metadata } : {}),
    }
  }
  const deliverPacketMessage = (
    packet: LoopPacket,
    draft: LoopPacketMessage,
  ): LoopMessageRecord => {
    const kind = draft.kind ?? 'steer'
    const delivered = opts.scope.send(
      draft.to,
      kind === 'steer'
        ? {
            steer: draft.body,
            reason: draft.reason,
          }
        : {
            message: draft.body,
            kind,
            reason: draft.reason,
          },
    )
    return {
      id: `${packet.id}:msg:${messageSeq++}`,
      from: draft.from ?? packet.nodeId,
      to: draft.to,
      kind,
      body: draft.body,
      ...(draft.reason ? { reason: draft.reason } : {}),
      mode: draft.mode ?? 'immediate',
      delivery: delivered
        ? { status: 'delivered' }
        : { status: 'rejected', reason: 'scope.send returned false' },
      sentAt: Date.now(),
      ...(draft.metadata ? { metadata: draft.metadata } : {}),
    }
  }
  const autoTraceAnalysis: LoopPacketAnalyzer = async ({ packet }) => {
    const autoKinds = opts.analysts?.auto ?? []
    if (packet.status !== 'done' || !opts.analysts || autoKinds.length === 0) return undefined
    const findings: LoopFindingInput[] = []
    for (const kind of autoKinds) {
      findings.push({
        source: kind,
        claim: `trace analyst ${kind} produced findings`,
        metadata: { kind, findings: await opts.analysts.run(kind, packet.trace) },
      })
    }
    return { findings }
  }
  const analyzePacket = composeLoopPacketAnalyzers(autoTraceAnalysis, opts.analyzePacket)

  const applyPacketAnalysis = async (packet: LoopPacket): Promise<LoopPacket> => {
    const input: LoopPacketAnalysisInput = {
      packet,
      packets: [...packets, packet],
      questions,
      budget: opts.scope.budget,
    }
    const analysis = await analyzePacket(input)
    if (!analysis) return packet
    const packetQuestions: QuestionRecord[] = []
    for (const q of analysis.questions ?? []) {
      packetQuestions.push(await emitNewQuestion(addQuestion(q, packet.nodeId)))
    }
    const messages = (analysis.messages ?? []).map((message) =>
      deliverPacketMessage(packet, message),
    )
    const findings = (analysis.findings ?? []).map((finding) =>
      normalizeFinding(finding, 'packet-analysis'),
    )
    if (!findings.length && !packetQuestions.length && !messages.length) return packet
    return {
      ...packet,
      findings: [...packet.findings, ...findings],
      questions: [...packet.questions, ...packetQuestions],
      messages: [...packet.messages, ...messages],
    }
  }

  const packetFromSettlement = async (s: Settled<unknown>): Promise<LoopPacket> => {
    if (s.kind === 'down') {
      const spent: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
      const timing = packetTiming(spent)
      return {
        id: `${s.handle.id}:packet`,
        nodeId: s.handle.id,
        label: s.handle.label,
        status: 'down',
        ...timing,
        spent,
        reason: s.reason,
        findings: [],
        questions: [],
        messages: [],
        blockers: [s.reason],
      }
    }
    const artifact = await outputForNode(s.handle.id)
    const trace = artifact.output ?? s.out
    const timing = packetTiming(s.spent)
    const verdict = verdictFromDefault(s.verdict)
    return {
      id: `${s.handle.id}:packet`,
      nodeId: s.handle.id,
      label: s.handle.label,
      status: 'done',
      ...timing,
      spent: s.spent,
      ...artifact,
      trace,
      output: artifact.output ?? s.out,
      ...(verdict ? { verdict } : {}),
      findings: [],
      questions: [],
      messages: [],
      blockers: s.verdict && !s.verdict.valid ? [s.verdict.notes ?? 'worker verdict invalid'] : [],
    }
  }

  const tools: McpToolDescriptor[] = [
    {
      name: 'spawn_worker',
      description:
        'Start a worker the operator will drive. `profile` is the worker (or another DRIVER — ' +
        'drivers-of-drivers are allowed); `task` is what it should do. Reserves the worker’s budget ' +
        'from the conserved pool and fails closed when the pool is dry — so spawning "at will" is ' +
        'bounded by the budget. Returns { workerId } or { error: "budget-exhausted" | "depth-exceeded" }.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { description: 'The worker/driver profile to run (passed to makeWorkerAgent).' },
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
      description:
        'Inspect a worker you are driving: its live status + conserved spend, and — once it has ' +
        'settled — its output artifact (rehydrated from the result blob). Use this to review work ' +
        'before deciding your next move. (In-flight token-level trace is surfaced via the analyst, ' +
        'not here.)',
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
      description:
        'Steer a RUNNING worker out-of-band — deliver your next instruction / a course-correction / ' +
        'an interrupt to its inbox. Returns { delivered } — false if the worker has finished or its ' +
        'harness cannot be steered mid-flight (then spawn a fresh one or wait and re-observe).',
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
        'Wait for the next worker you spawned to FINISH, then read its deployable verdict. This is ' +
        'how you advance: spawn one or more workers, then call await_next to block until the next ' +
        'one settles. Returns { settled: workerId, status: "done"|"down", score, valid } for a ' +
        'finished worker, or { idle: true } when no worker is still running (then spawn more or stop). ' +
        'Workers run concurrently — spawn a batch, then await_next repeatedly to collect them.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const s = await opts.scope.next()
        if (!s) return { idle: true }
        const w = recordSettled(s)
        const packet = await applyPacketAnalysis(await packetFromSettlement(s))
        packets.push(packet)
        await emitEvent({ type: 'packet', packet })
        return w.status === 'done'
          ? {
              settled: w.id,
              status: 'done',
              score: w.score,
              valid: w.valid,
              packet,
            }
          : {
              settled: w.id,
              status: 'down',
              reason: w.reason,
              packet,
            }
      },
    },
    {
      name: 'list_questions',
      description:
        'List questions raised by workers, drivers, or loop analysts. Stop behavior depends on questionPolicy: mustDecide blocks open blocking questions; failClosed blocks blocking questions until answered or deferred.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ questions }),
    },
    {
      name: 'answer_question',
      description:
        'Record an answer/deferral/escalation for a loop question. Parent drivers and Pi use this to push decisions back down the chain.',
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
          const reason =
            typeof a.escalateReason === 'string' && a.escalateReason.length > 0
              ? a.escalateReason
              : 'driver escalated'
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'escalate',
              to: a.escalateTo,
              value: reason,
              reason,
            }),
          })
        }
        throw new Error('answer_question: provide answer, deferReason, or escalateTo')
      },
    },
    {
      name: 'ask_parent',
      description:
        'Raise a new question to the parent driver/Pi/user when the current driver cannot decide safely. This records the question and marks it escalated.',
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
        const q = await emitNewQuestion(
          addQuestion(
            {
              from: str(a.from, 'from'),
              level: level(a.level),
              question: str(a.question, 'question'),
              reason: str(a.reason, 'reason'),
              urgency: urgency(a.urgency),
            },
            str(a.from, 'from'),
            { kind: 'escalate', value: 'asked parent', to: 'parent', reason: 'asked parent' },
          ),
        )
        return { question: q }
      },
    },
    {
      name: 'stop',
      description:
        'Declare the run complete — every required change is made and verified. The terminal move.',
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

  // list_analysts / run_analyst — present only when the analyst seam is wired. The driver picks a
  // kind from the menu and applies it to a worker it is driving; findings are trace-derived (the
  // firewall lives in the runner). (define_analyst — authoring a NEW kind at runtime — is deferred.)
  if (opts.analysts) {
    tools.push({
      name: 'list_analysts',
      description:
        'List the trace-analyst lenses available to run over a worker — id, what each looks for, and its area.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: opts.analysts?.kinds }),
    })
  }
  if (opts.analysts) {
    tools.push({
      name: 'run_analyst',
      description:
        'Apply an analyst LENS to a worker you are driving — run `kind` over the worker’s trace and ' +
        'return its findings (trace-derived, never score-derived). Use `list_analysts` for the menu; ' +
        'run several lenses to triangulate. The worker must have settled (its trace is read from its output).',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'The analyst kind id (see list_analysts).' },
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
    packets: () => packets,
    questions: () => questions,
  }
}
