/**
 * @experimental
 *
 * Thin loop authoring facade. It owns the result envelope and composes the
 * existing runtime primitives a loop body chooses to use: Scope, runLoop,
 * conversations, MCP coordination tools, analyst loops, or direct async code.
 */

import { randomUUID } from 'node:crypto'

import { selectLoopTrace } from './loop-trace'
import type {
  DefinedLoop,
  DefineLoopOptions,
  LoopAnalysisInput,
  LoopArtifact,
  LoopArtifactInput,
  LoopControlPlane,
  LoopControlSnapshot,
  LoopEvaluatorInput,
  LoopEvent,
  LoopFinding,
  LoopFindingInput,
  LoopMessageDelivery,
  LoopMessageInput,
  LoopMessageRecord,
  LoopQuestion,
  LoopQuestionDecision,
  LoopQuestionInput,
  LoopQuestionPolicy,
  LoopRunContext,
  LoopRunHandle,
  LoopRunOptions,
  LoopRunResult,
  LoopStatus,
  LoopTraceSlice,
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
  LoopArtifact,
  LoopArtifactInput,
  LoopArtifactStatus,
  LoopControlPlane,
  LoopControlSnapshot,
  LoopEvaluatorInput,
  LoopEvent,
  LoopFinding,
  LoopFindingInput,
  LoopJudge,
  LoopMessageDelivery,
  LoopMessageDeliveryMode,
  LoopMessageDeliveryStatus,
  LoopMessageInput,
  LoopMessageKind,
  LoopMessageRecord,
  LoopMessageRouter,
  LoopMessageRouterInput,
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
  LoopStatus,
  LoopTraceSelector,
  LoopTraceSlice,
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
  let eventSeq = 0
  let artifactSeq = 0
  let questionSeq = 0
  let messageSeq = 0
  let findingSeq = 0
  const events: LoopEvent[] = []
  const artifacts: LoopArtifact[] = []
  const questions: LoopQuestion[] = []
  const messages: LoopMessageRecord[] = []
  const findings: LoopFinding[] = []

  const trace = (): LoopTraceSlice => ({
    runId,
    artifacts: [...artifacts],
    events: [...events],
  })

  const emit = async (input: Omit<LoopEvent, 'id' | 'runId' | 'timestamp'>): Promise<LoopEvent> => {
    const event: LoopEvent = {
      id: `${runId}:e${eventSeq++}`,
      runId,
      kind: input.kind,
      timestamp: now(),
      ...(input.source ? { source: input.source } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    }
    events.push(event)
    await options.onEvent?.(event)
    return event
  }

  const normalizeFinding = (input: LoopFindingInput, source: string): LoopFinding => ({
    id: input.id ?? `${runId}:finding:${findingSeq++}`,
    source: input.source ?? source,
    claim: input.claim,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.recommendedAction ? { recommendedAction: input.recommendedAction } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })

  const recordQuestion = async (input: LoopQuestionInput): Promise<LoopQuestion> => {
    const decision: LoopQuestionDecision | undefined =
      questionPolicy === 'bubble'
        ? {
            kind: 'escalate',
            value: 'question policy bubbled to parent',
            to: 'parent',
            reason: 'question policy bubbled to parent',
          }
        : undefined
    const question: LoopQuestion = {
      id: input.id ?? `${runId}:q${questionSeq++}`,
      from: input.from,
      level: input.level,
      question: input.question,
      reason: input.reason,
      urgency: input.urgency,
      ...(input.options ? { options: input.options } : {}),
      status: decision ? 'escalated' : 'open',
      ...(decision ? { decision } : {}),
      openedAt: now(),
    }
    questions.push(question)
    await emit({
      kind: 'question.opened',
      source: question.from,
      payload: { question },
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
      kind: 'question.decided',
      source: decision.by ?? 'parent',
      target: prior.from,
      payload: { question: next },
    })
    return next
  }

  const send = async (input: LoopMessageInput): Promise<LoopMessageRecord> => {
    const base: Omit<LoopMessageRecord, 'delivery'> = {
      id: `${runId}:msg:${messageSeq++}`,
      from: input.from ?? 'parent',
      to: input.to,
      kind: input.kind ?? 'steer',
      body: input.body,
      ...(input.reason ? { reason: input.reason } : {}),
      mode: input.mode ?? 'immediate',
      ...(input.metadata ? { metadata: input.metadata } : {}),
      sentAt: now(),
    }
    const delivery =
      (await options.messageRouter?.({ ...base, signal })) ??
      ({ status: 'queued', reason: 'no messageRouter configured' } satisfies LoopMessageDelivery)
    const record: LoopMessageRecord = { ...base, delivery }
    messages.push(record)
    await emit({
      kind: 'message.sent',
      source: record.from,
      target: record.to,
      payload: { message: record },
    })
    return record
  }

  const runAnalysts = async (
    timing: 'record' | 'final',
    artifact?: LoopArtifact,
  ): Promise<AppliedLoopAnalysis> => {
    const combined: {
      findings: LoopFinding[]
      questions: LoopQuestion[]
      messages: LoopMessageRecord[]
      blockers: string[]
    } = { findings: [], questions: [], messages: [], blockers: [] }

    for (const analyst of definition.analysts ?? []) {
      if ((analyst.timing ?? 'record') !== timing) continue
      const baseInput: LoopAnalysisInput = {
        runId,
        timing,
        ...(artifact ? { artifact } : {}),
        trace: trace(),
        artifacts: [...artifacts],
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
      const nextFindings = (analysis.findings ?? []).map((finding) =>
        normalizeFinding(finding, analyst.id),
      )
      findings.push(...nextFindings)
      combined.findings.push(...nextFindings)
      for (const question of analysis.questions ?? []) {
        combined.questions.push(await recordQuestion(question))
      }
      for (const message of analysis.messages ?? []) {
        combined.messages.push(await send({ from: analyst.id, ...message }))
      }
      combined.blockers.push(...(analysis.blockers ?? []))
      await emit({
        kind: 'analyst.completed',
        source: analyst.id,
        target: artifact?.source,
        ...(artifact ? { artifactId: artifact.id } : {}),
        payload: {
          timing,
          findings: nextFindings.length,
          questions: analysis.questions?.length ?? 0,
          messages: analysis.messages?.length ?? 0,
          blockers: analysis.blockers?.length ?? 0,
        },
      })
    }

    return combined
  }

  const record = async (input: LoopArtifactInput): Promise<LoopArtifact> => {
    const id = input.id ?? `${runId}:artifact:${artifactSeq++}`
    const source = input.source ?? id
    const startedAt = input.startedAt ?? now()
    const endedAt = input.endedAt ?? (input.status === 'running' ? undefined : now())
    let artifact: LoopArtifact = {
      id,
      source,
      ...(input.label ? { label: input.label } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      status: input.status ?? 'done',
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.trace !== undefined ? { trace: input.trace } : {}),
      ...(input.verdict ? { verdict: input.verdict } : {}),
      ...(input.spent ? { spent: input.spent } : {}),
      blockers: input.blockers ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
      startedAt,
      ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - startedAt) } : {}),
    }
    artifacts.push(artifact)
    await emit({
      kind: `artifact.${artifact.status}`,
      source: artifact.source,
      artifactId: artifact.id,
      ...(artifact.durationMs !== undefined ? { durationMs: artifact.durationMs } : {}),
      payload: { artifact },
    })
    const analysis = await runAnalysts('record', artifact)
    if (analysis.blockers.length) {
      artifact = { ...artifact, blockers: [...artifact.blockers, ...analysis.blockers] }
      artifacts[artifacts.length - 1] = artifact
    }
    return artifact
  }

  const snapshot = (): LoopControlSnapshot => ({
    runId,
    name: definition.name,
    trace: trace(),
    events: [...events],
    artifacts: [...artifacts],
    questions: [...questions],
    messages: [...messages],
    findings: [...findings],
  })

  const control: LoopControlPlane = {
    runId,
    send,
    answerQuestion,
    trace: (selector = {}) => selectLoopTrace(trace(), selector),
    artifacts: () => [...artifacts],
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
    record,
    question: recordQuestion,
  }

  const result = (async (): Promise<LoopRunResult<Output>> => {
    let output: Output | undefined
    let hasOutput = false
    let error: string | undefined
    await emit({ kind: 'loop.started', source: definition.name, payload: { task } })

    try {
      output = await definition.run(task, ctx)
      hasOutput = true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      await emit({ kind: 'loop.failed', source: definition.name, payload: { error } })
    }

    const finalAnalysis = await runAnalysts('final')
    let verifier: LoopRunResult<Output>['verifier']
    let judge: LoopRunResult<Output>['judge']
    if (hasOutput && definition.verifier) {
      verifier = await definition.verifier(
        evaluatorInput(runId, output as Output, trace(), artifacts, questions, messages, events),
      )
      await emit({ kind: 'verifier.completed', source: 'verifier', payload: { verdict: verifier } })
    }
    if (hasOutput && definition.judge) {
      judge = await definition.judge(
        evaluatorInput(runId, output as Output, trace(), artifacts, questions, messages, events),
      )
      await emit({ kind: 'judge.completed', source: 'judge', payload: { verdict: judge } })
    }

    const artifactBlockers = artifacts.flatMap((artifact) =>
      artifact.blockers.map((blocker) => `${artifact.label ?? artifact.source}: ${blocker}`),
    )
    const questionBlockers = blockingQuestions(questions, questionPolicy).map(
      (question) => `unresolved ${question.urgency} question ${question.id}: ${question.question}`,
    )
    const verifierBlockers =
      verifier && !verifier.valid ? [verifier.notes ?? 'verifier rejected output'] : []
    const blockers = [
      ...(error ? [error] : []),
      ...artifactBlockers,
      ...questionBlockers,
      ...finalAnalysis.blockers,
      ...verifierBlockers,
    ]
    const endedAt = now()
    const status: LoopStatus = error ? 'failed' : blockers.length ? 'blocked' : 'completed'
    const ok = status === 'completed'
    await emit({
      kind: 'loop.completed',
      source: definition.name,
      durationMs: Math.max(0, endedAt - startedAt),
      payload: { ok, status, blockers },
    })
    const fullTrace = trace()
    return {
      runId,
      name: definition.name,
      status,
      ok,
      ...(hasOutput ? { output } : {}),
      ...(error ? { error } : {}),
      ...(verifier ? { verifier } : {}),
      ...(judge ? { judge } : {}),
      artifacts: [...artifacts],
      trace: fullTrace,
      events: [...events],
      findings: [...findings],
      questions: [...questions],
      messages: [...messages],
      blockers,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
    }
  })()

  return { runId, result, control }
}

function evaluatorInput<Output>(
  runId: string,
  output: Output,
  trace: LoopTraceSlice,
  artifacts: ReadonlyArray<LoopArtifact>,
  questions: ReadonlyArray<LoopQuestion>,
  messages: ReadonlyArray<LoopMessageRecord>,
  events: ReadonlyArray<LoopEvent>,
): LoopEvaluatorInput<Output> {
  return {
    runId,
    output,
    trace,
    artifacts: [...artifacts],
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
