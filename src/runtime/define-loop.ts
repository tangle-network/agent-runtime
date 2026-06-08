/**
 * @experimental
 *
 * `defineLoop` is the developer-facing facade over the recursive runtime.
 * It does not replace `Scope`, `runConversation`, `runAnalystLoop`, or the MCP
 * coordination tools. It standardizes the authoring contract:
 *
 *   defineLoop({ run, analysts, verifier, judge }).run(task)
 *
 * The loop body owns strategy. The facade owns the complete result envelope:
 * packets, trace events, trace graph, questions, messages, verifier verdict,
 * held-out judge verdict, blockers, timings, and live root-to-agent messages.
 */

import { randomUUID } from 'node:crypto'

import { selectLoopTrace } from './loop-trace'
import type {
  DefinedLoop,
  DefineLoopOptions,
  LoopAnalysisInput,
  LoopControlPlane,
  LoopControlSnapshot,
  LoopEvaluatorInput,
  LoopFinding,
  LoopFindingInput,
  LoopGraphEvent,
  LoopMessageDelivery,
  LoopMessageInput,
  LoopMessageRecord,
  LoopPacket,
  LoopPacketInput,
  LoopQuestion,
  LoopQuestionDecision,
  LoopQuestionInput,
  LoopQuestionPolicy,
  LoopRunContext,
  LoopRunHandle,
  LoopRunOptions,
  LoopRunResult,
  LoopStatus,
  LoopTraceEdge,
  LoopTraceGraph,
  LoopTraceNode,
  LoopVerdict,
} from './loop-types'

interface AppliedLoopAnalysis {
  readonly findings: ReadonlyArray<LoopFinding>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly blockers: ReadonlyArray<string>
}

export { selectLoopTrace } from './loop-trace'
export type {
  DefinedLoop,
  DefineLoopOptions,
  LoopAnalysis,
  LoopAnalysisInput,
  LoopAnalyst,
  LoopControlPlane,
  LoopControlSnapshot,
  LoopEvaluatorInput,
  LoopFinding,
  LoopFindingInput,
  LoopGraphEvent,
  LoopJudge,
  LoopMessageDelivery,
  LoopMessageDeliveryMode,
  LoopMessageDeliveryStatus,
  LoopMessageInput,
  LoopMessageKind,
  LoopMessageRecord,
  LoopMessageRouter,
  LoopMessageRouterInput,
  LoopPacket,
  LoopPacketInput,
  LoopPacketStatus,
  LoopQuestion,
  LoopQuestionDecision,
  LoopQuestionInput,
  LoopQuestionLevel,
  LoopQuestionPolicy,
  LoopQuestionUrgency,
  LoopRunContext,
  LoopRunHandle,
  LoopRunOptions,
  LoopRunResult,
  LoopSpend,
  LoopStatus,
  LoopTraceEdge,
  LoopTraceEdgeKind,
  LoopTraceGraph,
  LoopTraceNode,
  LoopTraceSelector,
  LoopVerdict,
  LoopVerifier,
} from './loop-types'

export function defineLoop<Task, Output>(
  definition: DefineLoopOptions<Task, Output>,
): DefinedLoop<Task, Output> {
  return {
    name: definition.name,
    start(task, options = {}) {
      return startDefinedLoop(definition, task, options)
    },
    run(task, options = {}) {
      return startDefinedLoop(definition, task, options).result
    },
  }
}

export function runDefinedLoop<Task, Output>(
  definition: DefineLoopOptions<Task, Output>,
  task: Task,
  options?: LoopRunOptions,
): Promise<LoopRunResult<Output>> {
  return defineLoop(definition).run(task, options)
}

function startDefinedLoop<Task, Output>(
  definition: DefineLoopOptions<Task, Output>,
  task: Task,
  options: LoopRunOptions,
): LoopRunHandle<Output> {
  const runId = options.runId ?? `loop_${randomUUID()}`
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const questionPolicy = definition.questionPolicy ?? 'auto'
  const startedAt = now()
  const rootId = `${runId}:loop`
  let eventSeq = 0
  let packetSeq = 0
  let questionSeq = 0
  let messageSeq = 0
  let findingSeq = 0
  let edgeSeq = 0
  let endedAt: number | undefined
  const nodes = new Map<string, LoopTraceNode>()
  const edges: LoopTraceEdge[] = []
  const events: LoopGraphEvent[] = []
  const packets: LoopPacket[] = []
  const questions: LoopQuestion[] = []
  const messages: LoopMessageRecord[] = []
  const findings: LoopFinding[] = []
  const rootNode: LoopTraceNode = {
    id: rootId,
    label: definition.name,
    kind: 'loop',
    startedAt,
  }
  nodes.set(rootId, rootNode)

  const graph = (): LoopTraceGraph => ({
    runId,
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    nodes: [...nodes.values()],
    edges: [...edges],
    events: [...events],
  })

  const emit = async (
    input: Omit<LoopGraphEvent, 'id' | 'runId' | 'timestamp'>,
  ): Promise<LoopGraphEvent> => {
    const event: LoopGraphEvent = {
      id: `${runId}:e${eventSeq++}`,
      runId,
      type: input.type,
      timestamp: now(),
      ...(input.source ? { source: input.source } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.packetId ? { packetId: input.packetId } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    }
    events.push(event)
    await options.onEvent?.(event)
    return event
  }

  const upsertNode = (node: LoopTraceNode): void => {
    const prior = nodes.get(node.id)
    nodes.set(node.id, { ...prior, ...node })
  }

  const addEdge = (
    edge: Omit<LoopTraceEdge, 'id' | 'timestamp'> & { readonly timestamp?: number },
  ): void => {
    edges.push({
      id: `${runId}:edge:${edgeSeq++}`,
      timestamp: edge.timestamp ?? now(),
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(edge.eventId ? { eventId: edge.eventId } : {}),
      ...(edge.status ? { status: edge.status } : {}),
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
    })
  }

  const normalizeFinding = (draft: LoopFindingInput, source: string): LoopFinding => ({
    id: draft.id ?? `${runId}:finding:${findingSeq++}`,
    source: draft.source ?? source,
    claim: draft.claim,
    ...(draft.severity ? { severity: draft.severity } : {}),
    ...(draft.evidence ? { evidence: draft.evidence } : {}),
    ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
    ...(draft.recommendedAction ? { recommendedAction: draft.recommendedAction } : {}),
    ...(draft.metadata ? { metadata: draft.metadata } : {}),
  })

  const recordQuestion = async (draft: LoopQuestionInput): Promise<LoopQuestion> => {
    const effectiveDecision: LoopQuestionDecision | undefined =
      questionPolicy === 'bubble'
        ? { kind: 'escalate', value: 'question policy bubbled to parent' }
        : undefined
    const question: LoopQuestion = {
      id: draft.id ?? `${runId}:q${questionSeq++}`,
      from: draft.from,
      level: draft.level,
      question: draft.question,
      reason: draft.reason,
      urgency: draft.urgency,
      ...(draft.options ? { options: draft.options } : {}),
      status: effectiveDecision ? 'escalated' : 'open',
      ...(effectiveDecision ? { decision: effectiveDecision } : {}),
      openedAt: now(),
    }
    questions.push(question)
    await emit({
      type: 'question.opened',
      source: question.from,
      target: rootId,
      data: { question },
    })
    return question
  }

  const answerQuestion = async (
    questionId: string,
    decision: LoopQuestionDecision,
  ): Promise<LoopQuestion> => {
    const index = questions.findIndex((question) => question.id === questionId)
    if (index < 0) throw new Error(`defineLoop: unknown question ${JSON.stringify(questionId)}`)
    const prior = questions[index]!
    const next: LoopQuestion = {
      ...prior,
      status:
        decision.kind === 'answer'
          ? 'answered'
          : decision.kind === 'defer'
            ? 'deferred'
            : 'escalated',
      decision,
    }
    questions[index] = next
    await emit({
      type: 'question.decided',
      source: decision.by ?? rootId,
      target: prior.from,
      data: { question: next },
    })
    return next
  }

  const send = async (draft: LoopMessageInput): Promise<LoopMessageRecord> => {
    const base: Omit<LoopMessageRecord, 'delivery'> = {
      id: `${runId}:msg:${messageSeq++}`,
      from: draft.from ?? rootId,
      to: draft.to,
      kind: draft.kind ?? 'steer',
      body: draft.body,
      ...(draft.reason ? { reason: draft.reason } : {}),
      mode: draft.mode ?? 'immediate',
      ...(draft.metadata ? { metadata: draft.metadata } : {}),
      sentAt: now(),
    }
    const delivery =
      (await options.messageRouter?.({ ...base, signal })) ??
      ({ status: 'queued', reason: 'no messageRouter configured' } satisfies LoopMessageDelivery)
    const record: LoopMessageRecord = { ...base, delivery }
    messages.push(record)
    const event = await emit({
      type: 'message.sent',
      source: record.from,
      target: record.to,
      data: { message: record },
    })
    addEdge({
      from: record.from,
      to: record.to,
      kind: record.kind === 'steer' ? 'steer' : 'message',
      eventId: event.id,
      status: delivery.status,
    })
    return record
  }

  const runAnalysts = async (
    timing: 'packet' | 'final',
    packet?: LoopPacket,
  ): Promise<AppliedLoopAnalysis> => {
    const combined: {
      findings: LoopFinding[]
      questions: LoopQuestion[]
      messages: LoopMessageRecord[]
      blockers: string[]
    } = { findings: [], questions: [], messages: [], blockers: [] }
    for (const analyst of definition.analysts ?? []) {
      if ((analyst.timing ?? 'packet') !== timing) continue
      const baseInput: LoopAnalysisInput = {
        runId,
        timing,
        ...(packet ? { packet } : {}),
        trace: graph(),
        packets: [...packets],
        questions: [...questions],
        messages: [...messages],
        events: [...events],
      }
      const selector =
        typeof analyst.select === 'function' ? analyst.select(baseInput) : analyst.select
      const input: LoopAnalysisInput = {
        ...baseInput,
        trace: selector ? selectLoopTrace(baseInput.trace, selector) : baseInput.trace,
      }
      const analysis = await analyst.analyze(input)
      if (!analysis) continue
      const analystFindings = (analysis.findings ?? []).map((finding) =>
        normalizeFinding(finding, analyst.id),
      )
      findings.push(...analystFindings)
      combined.findings.push(...analystFindings)
      for (const question of analysis.questions ?? []) {
        combined.questions.push(await recordQuestion(question))
      }
      for (const message of analysis.messages ?? []) {
        combined.messages.push(await send({ from: analyst.id, ...message }))
      }
      combined.blockers.push(...(analysis.blockers ?? []))
      await emit({
        type: 'analyst.completed',
        source: analyst.id,
        target: packet?.nodeId ?? rootId,
        ...(packet ? { packetId: packet.id } : {}),
        data: {
          timing,
          findings: analystFindings.length,
          questions: analysis.questions?.length ?? 0,
          messages: analysis.messages?.length ?? 0,
          blockers: analysis.blockers?.length ?? 0,
        },
      })
    }
    return combined
  }

  const recordPacket = async (input: LoopPacketInput): Promise<LoopPacket> => {
    const index = packetSeq++
    const id = input.id ?? `${runId}:packet:${index}`
    const nodeId = input.nodeId ?? `${runId}:node:${index}`
    const started = input.startedAt ?? now()
    const ended = input.endedAt ?? (input.status === 'running' ? undefined : now())
    let packet: LoopPacket = {
      id,
      nodeId,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      label: input.label,
      ...(input.kind ? { kind: input.kind } : {}),
      status: input.status,
      startedAt: started,
      ...(ended !== undefined ? { endedAt: ended, durationMs: Math.max(0, ended - started) } : {}),
      ...(input.spent ? { spent: input.spent } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.trace !== undefined ? { trace: input.trace } : {}),
      ...(input.verdict ? { verdict: input.verdict } : {}),
      findings: input.findings ?? [],
      questions: input.questions ?? [],
      messages: input.messages ?? [],
      blockers: input.blockers ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }
    packets.push(packet)
    upsertNode({
      id: nodeId,
      label: input.label,
      ...(input.kind ? { kind: input.kind } : {}),
      parentId: input.parentId ?? rootId,
      startedAt: started,
      ...(ended !== undefined ? { endedAt: ended } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    })
    const event = await emit({
      type: input.status === 'running' ? 'packet.started' : 'packet.completed',
      source: nodeId,
      target: input.parentId ?? rootId,
      packetId: id,
      ...(packet.durationMs !== undefined ? { durationMs: packet.durationMs } : {}),
      data: { packet },
    })
    addEdge({
      from: input.parentId ?? rootId,
      to: nodeId,
      kind: 'spawn',
      eventId: event.id,
      status: input.status,
    })
    const analysis = await runAnalysts('packet', packet)
    if (
      analysis.findings?.length ||
      analysis.questions?.length ||
      analysis.messages?.length ||
      analysis.blockers?.length
    ) {
      packet = {
        ...packet,
        findings: [...packet.findings, ...(analysis.findings ?? [])],
        questions: [...packet.questions, ...(analysis.questions ?? [])],
        messages: [...packet.messages, ...(analysis.messages ?? [])],
        blockers: [...packet.blockers, ...(analysis.blockers ?? [])],
      }
      packets[packets.length - 1] = packet
    }
    return packet
  }

  const snapshot = (): LoopControlSnapshot => ({
    runId,
    name: definition.name,
    trace: graph(),
    events: [...events],
    packets: [...packets],
    questions: [...questions],
    messages: [...messages],
    findings: [...findings],
  })

  const control: LoopControlPlane = {
    runId,
    send,
    answerQuestion,
    trace: (selector = {}) => selectLoopTrace(graph(), selector),
    packets: () => [...packets],
    questions: () => [...questions],
    messages: () => [...messages],
    events: () => [...events],
    snapshot,
  }

  const ctx: LoopRunContext = {
    ...control,
    loopName: definition.name,
    signal,
    control,
    now,
    event: emit,
    packet: recordPacket,
    question: recordQuestion,
  }

  const result = (async (): Promise<LoopRunResult<Output>> => {
    let output: Output | undefined
    let hasOutput = false
    let error: string | undefined
    let verifier: LoopVerdict | undefined
    let judge: LoopVerdict | undefined
    await emit({ type: 'loop.started', source: rootId, data: { task } })
    try {
      output = await definition.run(task, ctx)
      hasOutput = true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      await emit({ type: 'loop.failed', source: rootId, data: { error } })
    }

    const finalAnalysis = await runAnalysts('final')
    const analysisBlockers = finalAnalysis.blockers ?? []
    if (hasOutput && definition.verifier) {
      verifier = await definition.verifier(
        evaluatorInput(runId, output as Output, graph(), packets, questions, messages, events),
      )
      const event = await emit({
        type: 'verifier.completed',
        source: 'verifier',
        target: rootId,
        data: { verdict: verifier },
      })
      addEdge({ from: rootId, to: 'verifier', kind: 'verification', eventId: event.id })
      upsertNode({
        id: 'verifier',
        label: 'verifier',
        kind: 'verifier',
        startedAt: event.timestamp,
      })
      if (verifier.findings?.length) findings.push(...verifier.findings)
    }
    if (hasOutput && definition.judge) {
      judge = await definition.judge(
        evaluatorInput(runId, output as Output, graph(), packets, questions, messages, events),
      )
      const event = await emit({
        type: 'judge.completed',
        source: 'judge',
        target: rootId,
        data: { verdict: judge },
      })
      addEdge({ from: rootId, to: 'judge', kind: 'judgement', eventId: event.id })
      upsertNode({ id: 'judge', label: 'judge', kind: 'judge', startedAt: event.timestamp })
      if (judge.findings?.length) findings.push(...judge.findings)
    }

    const questionBlockers = blockingQuestions(questions, questionPolicy).map(
      (question) => `unresolved ${question.urgency} question ${question.id}: ${question.question}`,
    )
    const packetBlockers = packets.flatMap((packet) =>
      packet.blockers.map((blocker) => `${packet.label}: ${blocker}`),
    )
    const verifierBlockers =
      verifier && !verifier.valid ? [verifier.reason ?? 'verifier rejected output'] : []
    const blockers = [
      ...(error ? [error] : []),
      ...packetBlockers,
      ...questionBlockers,
      ...analysisBlockers,
      ...verifierBlockers,
    ]
    endedAt = now()
    const status: LoopStatus = error ? 'failed' : blockers.length ? 'blocked' : 'completed'
    const ok = status === 'completed'
    nodes.set(rootId, { ...rootNode, endedAt })
    await emit({
      type: 'loop.completed',
      source: rootId,
      durationMs: Math.max(0, endedAt - startedAt),
      data: { ok, status, blockers },
    })
    return {
      runId,
      name: definition.name,
      status,
      ok,
      ...(hasOutput ? { output } : {}),
      ...(error ? { error } : {}),
      ...(verifier ? { verifier } : {}),
      ...(judge ? { judge } : {}),
      packets: [...packets],
      questions: [...questions],
      messages: [...messages],
      findings: [...findings],
      blockers,
      trace: graph(),
      events: [...events],
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
    }
  })()

  return {
    runId,
    result,
    control,
  }
}

function evaluatorInput<Output>(
  runId: string,
  output: Output,
  trace: LoopTraceGraph,
  packets: ReadonlyArray<LoopPacket>,
  questions: ReadonlyArray<LoopQuestion>,
  messages: ReadonlyArray<LoopMessageRecord>,
  events: ReadonlyArray<LoopGraphEvent>,
): LoopEvaluatorInput<Output> {
  return {
    runId,
    output,
    trace,
    packets: [...packets],
    questions: [...questions],
    messages: [...messages],
    events: [...events],
  }
}

function blockingQuestions(
  questions: ReadonlyArray<LoopQuestion>,
  policy: LoopQuestionPolicy,
): LoopQuestion[] {
  if (policy === 'auto' || policy === 'bubble') return []
  return questions.filter((question) => {
    const blocking = question.urgency === 'blocks-step' || question.urgency === 'blocks-run'
    if (!blocking) return false
    if (policy === 'mustDecide') return question.status === 'open'
    return question.status !== 'answered' && question.status !== 'deferred'
  })
}
